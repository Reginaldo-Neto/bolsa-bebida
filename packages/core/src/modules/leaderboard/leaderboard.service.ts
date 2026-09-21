import {
  LEADERBOARD_TOP_SIZE,
  expandUnits,
  rankEntries,
  scoreParticipant,
  type LeaderboardEntry,
} from '@bolsa/shared';
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma.service';

export interface RankedEntry extends LeaderboardEntry {
  position: number;
}

export interface LeaderboardView {
  entries: RankedEntry[];
  /** The caller's own row, even when it falls outside the top. */
  me: (RankedEntry & { optedIn: boolean }) | null;
  /** Ranked by the same metric, averaged over the team's members. */
  teams: { teamCode: string; points: number; members: number; position: number }[];
}

/**
 * Spec 4.6, "Melhor Trader".
 *
 * Measures how well someone bought, never how much they drank (L4). Only the
 * first ten units count, so another round can never raise a score.
 *
 * Spec 4.6 suggests a materialised view refreshed each tick. It is computed
 * here instead: a party is a few hundred participants, the query is a single
 * indexed scan, and the "first ten units" rule is far clearer in the shared
 * scoring function — which is unit-tested — than in SQL.
 */
@Injectable()
export class LeaderboardService {
  constructor(private readonly prisma: PrismaService) {}

  async view(eventId: string, participantId?: string): Promise<LeaderboardView> {
    const participants = await this.prisma.client.participant.findMany({
      where: {
        eventId,
        // L7: appearing here is opt-in, and reading it is not.
        OR: [{ leaderboardOptIn: true }, ...(participantId ? [{ id: participantId }] : [])],
      },
      select: {
        id: true,
        nickname: true,
        teamCode: true,
        leaderboardOptIn: true,
        orders: {
          where: { status: { in: ['PAID', 'PARTIALLY_REDEEMED', 'REDEEMED'] } },
          orderBy: { createdAt: 'asc' },
          select: {
            items: {
              select: { qty: true, unitPriceCents: true, basePriceCentsAtPurchase: true },
            },
          },
        },
      },
    });

    const scored = participants.map((participant) => {
      const units = expandUnits(
        participant.orders.flatMap((order) =>
          order.items.map((item) => ({
            qty: item.qty,
            unitPrice: item.unitPriceCents,
            basePrice: item.basePriceCentsAtPurchase,
          })),
        ),
      );

      return {
        participantId: participant.id,
        nickname: participant.nickname,
        teamCode: participant.teamCode,
        optedIn: participant.leaderboardOptIn,
        score: scoreParticipant(units),
      };
    });

    // Only ranked participants who opted in make the public board.
    const publicEntries: LeaderboardEntry[] = scored
      .filter((entry) => entry.optedIn && entry.score.ranked)
      .map((entry) => ({
        participantId: entry.participantId,
        nickname: entry.nickname,
        teamCode: entry.teamCode,
        points: entry.score.points,
      }));

    const ranked = rankEntries(publicEntries);
    const mine = scored.find((entry) => entry.participantId === participantId);

    return {
      entries: ranked.slice(0, LEADERBOARD_TOP_SIZE),
      me: mine
        ? {
            participantId: mine.participantId,
            nickname: mine.nickname,
            teamCode: mine.teamCode,
            points: mine.score.points,
            position: ranked.find((entry) => entry.participantId === participantId)?.position ?? 0,
            optedIn: mine.optedIn,
          }
        : null,
      teams: this.rankTeams(ranked),
    };
  }

  /** Spec 4.6: the optional team board, on the same metric. */
  private rankTeams(ranked: RankedEntry[]): LeaderboardView['teams'] {
    const byTeam = new Map<string, number[]>();

    for (const entry of ranked) {
      if (!entry.teamCode) {
        continue;
      }
      const points = byTeam.get(entry.teamCode) ?? [];
      points.push(entry.points);
      byTeam.set(entry.teamCode, points);
    }

    return [...byTeam]
      .map(([teamCode, points]) => ({
        teamCode,
        // An average, not a sum: a big team must not win by being big (L4).
        points: Math.round(points.reduce((sum, value) => sum + value, 0) / points.length),
        members: points.length,
      }))
      .sort((a, b) => b.points - a.points || a.teamCode.localeCompare(b.teamCode))
      .map((team, index) => ({ ...team, position: index + 1 }));
  }

  /** Spec 4.6: the participant can leave the ranking at any time. */
  async setOptIn(participantId: string, optIn: boolean): Promise<{ optedIn: boolean }> {
    await this.prisma.client.participant.update({
      where: { id: participantId },
      data: { leaderboardOptIn: optIn },
    });

    return { optedIn: optIn };
  }
}
