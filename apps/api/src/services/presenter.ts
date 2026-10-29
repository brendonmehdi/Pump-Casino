import type { Commitment, PublicRound, VerificationData } from '@pump/contracts';
import { formatHundredths } from '@pump/contracts';
import { PUMP_V1, formatRatioFloor, viewRound, type Round } from '@pump/engine';
import type { RoundRow, SeedCommitmentRow } from '../db/schema';

/**
 * The only place database rows become API payloads. The pop point is never mapped, and the
 * server seed is mapped only once the round has ended.
 */

export function toEngineRound(row: RoundRow): Round {
  if (row.rulesVersion !== PUMP_V1.rules.version) {
    throw new Error(`Unsupported rules version ${row.rulesVersion}`);
  }
  const fields = {
    betCents: row.betCents,
    pumpCount: row.pumpCount,
    autoCashoutHundredths:
      row.autoCashoutHundredths === null ? null : BigInt(row.autoCashoutHundredths),
    popPoint: row.popPoint,
  };
  switch (row.status) {
    case 'ACTIVE':
    case 'POPPED':
    case 'EXPIRED':
      return { ...fields, status: row.status };
    case 'CASHED_OUT':
      if (row.settlementReason === null || row.payoutCents === null) {
        throw new Error('Cashed-out round is missing its settlement');
      }
      return {
        ...fields,
        status: 'CASHED_OUT',
        settlementReason: row.settlementReason,
        payoutCents: row.payoutCents,
      };
  }
}

export function toPublicRound(row: RoundRow, commitment: SeedCommitmentRow): PublicRound {
  const view = viewRound(PUMP_V1, toEngineRound(row));
  const ended = row.status !== 'ACTIVE';
  return {
    id: row.id,
    status: row.status,
    settlementReason: view.settlementReason,
    version: row.version,
    betCents: row.betCents.toString(),
    pumpCount: row.pumpCount,
    maxPumps: view.maxPumps,
    multiplier: view.multiplier && formatRatioFloor(view.multiplier, 2),
    cashoutCents: view.cashoutCents?.toString() ?? null,
    nextPopChanceBasisPoints: view.nextPopBasisPoints,
    nextMultiplier: view.nextMultiplier && formatRatioFloor(view.nextMultiplier, 2),
    autoCashoutMultiplier:
      row.autoCashoutHundredths === null
        ? null
        : formatHundredths(BigInt(row.autoCashoutHundredths)),
    payoutCents: view.payoutCents?.toString() ?? null,
    startedAt: row.startedAt.toISOString(),
    endedAt: row.endedAt?.toISOString() ?? null,
    expiresAt: row.expiresAt.toISOString(),
    fairness: {
      rulesVersion: PUMP_V1.rules.version,
      commitment: commitment.commitment,
      clientSeed: row.clientSeed,
      nonce: row.nonce,
      serverSeed: ended ? commitment.serverSeed.toString('hex') : null,
    },
  };
}

export function toPublicCommitment(commitment: SeedCommitmentRow): Commitment {
  return { id: commitment.id, commitment: commitment.commitment, nonce: commitment.nonce };
}

/** Revealed inputs and recorded outcome of a finished round (format of tools/verify-round.mjs). */
export function toVerificationData(row: RoundRow, commitment: SeedCommitmentRow): VerificationData {
  if (row.status === 'ACTIVE') throw new Error('Active rounds cannot be revealed');
  return {
    rulesVersion: PUMP_V1.rules.version,
    commitment: commitment.commitment,
    serverSeed: commitment.serverSeed.toString('hex'),
    roundId: row.id,
    nonce: row.nonce,
    clientSeed: row.clientSeed,
    betCents: row.betCents.toString(),
    autoCashoutHundredths:
      row.autoCashoutHundredths === null ? null : row.autoCashoutHundredths.toString(),
    outcome: {
      status: row.status,
      pumpCount: row.pumpCount,
      settlementReason: row.settlementReason,
      payoutCents: (row.payoutCents ?? 0n).toString(),
    },
  };
}
