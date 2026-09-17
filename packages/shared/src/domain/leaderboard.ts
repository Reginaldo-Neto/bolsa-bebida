import {
  LEADERBOARD_MAX_SCORED_UNITS,
  LEADERBOARD_MIN_UNITS,
  LEADERBOARD_SCORE_MULTIPLIER,
} from '../constants';
import { type Cents, MoneyError } from '../money';

/**
 * Spec 4.6 "Melhor Trader": measures buying quality, never quantity (L4).
 * Only the first N units count, so buying more can never raise the score.
 */
export interface PurchasedUnit {
  /** Price actually paid for one unit. */
  paidPrice: Cents;
  /** Base price of the product at the moment of purchase. */
  basePrice: Cents;
}

export interface LeaderboardScore {
  /** Mean relative saving over the scored units. */
  meanSaving: number;
  /** Rounded points shown in the UI (meanSaving * 1000). */
  points: number;
  /** Units that entered the calculation, capped at LEADERBOARD_MAX_SCORED_UNITS. */
  scoredUnits: number;
  /** False when the participant has fewer than LEADERBOARD_MIN_UNITS units. */
  ranked: boolean;
}

/** Relative saving of a single unit: (base - paid) / base. */
export function unitSaving(unit: PurchasedUnit): number {
  if (unit.basePrice <= 0) {
    throw new MoneyError('basePrice must be positive to score a unit');
  }
  return (unit.basePrice - unit.paidPrice) / unit.basePrice;
}

/**
 * `units` must be ordered by purchase time: spec 4.6 counts "as primeiras"
 * units, so a later cheap purchase cannot displace an earlier expensive one.
 */
export function scoreParticipant(units: readonly PurchasedUnit[]): LeaderboardScore {
  const scored = units.slice(0, LEADERBOARD_MAX_SCORED_UNITS);
  if (scored.length === 0) {
    return { meanSaving: 0, points: 0, scoredUnits: 0, ranked: false };
  }

  let total = 0;
  for (const unit of scored) {
    total += unitSaving(unit);
  }
  const meanSaving = total / scored.length;

  return {
    meanSaving,
    points: Math.round(meanSaving * LEADERBOARD_SCORE_MULTIPLIER),
    scoredUnits: scored.length,
    ranked: scored.length >= LEADERBOARD_MIN_UNITS,
  };
}

/** Expands order items into one unit per purchased drink, preserving order. */
export function expandUnits(
  items: readonly { qty: number; unitPrice: Cents; basePrice: Cents }[],
): PurchasedUnit[] {
  const units: PurchasedUnit[] = [];
  for (const item of items) {
    for (let i = 0; i < item.qty; i += 1) {
      units.push({ paidPrice: item.unitPrice, basePrice: item.basePrice });
    }
  }
  return units;
}

export interface LeaderboardEntry {
  participantId: string;
  nickname: string;
  teamCode: string | null;
  points: number;
}

/** Deterministic ordering: points desc, then nickname, then id. */
export function compareLeaderboardEntries(a: LeaderboardEntry, b: LeaderboardEntry): number {
  if (a.points !== b.points) {
    return b.points - a.points;
  }
  const byNickname = a.nickname.localeCompare(b.nickname, 'pt-PT');
  if (byNickname !== 0) {
    return byNickname;
  }
  return a.participantId.localeCompare(b.participantId);
}

export function rankEntries(entries: readonly LeaderboardEntry[]): (LeaderboardEntry & {
  position: number;
})[] {
  const sorted = [...entries].sort(compareLeaderboardEntries);
  const ranked: (LeaderboardEntry & { position: number })[] = [];
  let lastPoints: number | null = null;
  let lastPosition = 0;

  sorted.forEach((entry, index) => {
    const position = entry.points === lastPoints ? lastPosition : index + 1;
    lastPoints = entry.points;
    lastPosition = position;
    ranked.push({ ...entry, position });
  });

  return ranked;
}
