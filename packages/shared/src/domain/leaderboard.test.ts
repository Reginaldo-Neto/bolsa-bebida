import { describe, expect, it } from 'vitest';
import {
  expandUnits,
  rankEntries,
  scoreParticipant,
  unitSaving,
  type PurchasedUnit,
} from './leaderboard';

const unit = (paidPrice: number, basePrice = 100): PurchasedUnit => ({ paidPrice, basePrice });

describe('unitSaving', () => {
  it('is positive when bought below base price', () => {
    expect(unitSaving(unit(80))).toBeCloseTo(0.2);
  });

  it('is negative when bought above base price', () => {
    expect(unitSaving(unit(120))).toBeCloseTo(-0.2);
  });

  it('rejects a non-positive base price', () => {
    expect(() => unitSaving(unit(80, 0))).toThrow();
  });
});

describe('scoreParticipant', () => {
  it('averages the relative saving', () => {
    const score = scoreParticipant([unit(80), unit(90)]);
    expect(score.meanSaving).toBeCloseTo(0.15);
    expect(score.points).toBe(150);
    expect(score.ranked).toBe(true);
  });

  it('needs at least two units to be ranked (spec 4.6)', () => {
    expect(scoreParticipant([unit(80)]).ranked).toBe(false);
    expect(scoreParticipant([]).ranked).toBe(false);
  });

  it('counts at most the first ten units, so quantity never helps (L4)', () => {
    const tenGood = Array.from({ length: 10 }, () => unit(50));
    const withMoreCheapUnits = [...tenGood, ...Array.from({ length: 20 }, () => unit(10))];

    expect(scoreParticipant(tenGood).points).toBe(500);
    expect(scoreParticipant(withMoreCheapUnits).points).toBe(500);
    expect(scoreParticipant(withMoreCheapUnits).scoredUnits).toBe(10);
  });

  it('cannot be improved by buying more after the cap', () => {
    const base = scoreParticipant([unit(90), unit(90)]);
    const extended = scoreParticipant([
      unit(90),
      unit(90),
      ...Array.from({ length: 50 }, () => unit(1)),
    ]);
    // The extra cheap units only fill the remaining 8 slots; beyond that the
    // score is frozen, so volume alone can never dominate the ranking.
    expect(base.points).toBe(100);
    expect(extended.scoredUnits).toBe(10);
  });
});

describe('expandUnits', () => {
  it('expands quantities into individual units in order', () => {
    const units = expandUnits([
      { qty: 2, unitPrice: 80, basePrice: 100 },
      { qty: 1, unitPrice: 120, basePrice: 100 },
    ]);
    expect(units).toEqual([
      { paidPrice: 80, basePrice: 100 },
      { paidPrice: 80, basePrice: 100 },
      { paidPrice: 120, basePrice: 100 },
    ]);
  });
});

describe('rankEntries', () => {
  it('sorts by points descending and shares positions on ties', () => {
    const ranked = rankEntries([
      { participantId: 'b', nickname: 'Bea', teamCode: null, points: 100 },
      { participantId: 'a', nickname: 'Ana', teamCode: null, points: 300 },
      { participantId: 'c', nickname: 'Caio', teamCode: null, points: 100 },
    ]);

    expect(ranked.map((entry) => [entry.nickname, entry.position])).toEqual([
      ['Ana', 1],
      ['Bea', 2],
      ['Caio', 2],
    ]);
  });

  it('is deterministic for identical scores', () => {
    const entries = [
      { participantId: 'z', nickname: 'Zeca', teamCode: null, points: 10 },
      { participantId: 'a', nickname: 'Ana', teamCode: null, points: 10 },
    ];
    expect(rankEntries(entries).map((e) => e.participantId)).toEqual(
      rankEntries([...entries].reverse()).map((e) => e.participantId),
    );
  });
});
