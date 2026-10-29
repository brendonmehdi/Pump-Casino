import {
  CLIENT_SEED_PATTERN,
  PUMP_RULES_V1,
  ROUND_ID_PATTERN,
  SHA256_HEX_PATTERN,
} from '@pump/engine';
import { z } from 'zod';
import { CENTS_PATTERN, parseMultiplierToHundredths } from './money';

const rules = PUMP_RULES_V1;

// ── Primitives ──────────────────────────────────────────────────────────────────────────────

export const centsSchema = z.string().regex(CENTS_PATTERN, 'Expected integer cents as a string');
export const roundIdSchema = z.string().regex(ROUND_ID_PATTERN, 'Expected a lowercase UUID');
export const hex32Schema = z.string().regex(SHA256_HEX_PATTERN, 'Expected 64 lowercase hex chars');
export const isoDateSchema = z.iso.datetime();
/** Auto cash-out target in hundredths of a multiplier as an integer string ("250" = 2.50×). */
export const hundredthsSchema = z.string().regex(CENTS_PATTERN, 'Expected an integer string');

// Zod runs refinements even after an earlier check fails, so the pattern is re-checked here
// before BigInt() — otherwise "10.00" would throw a SyntaxError instead of a validation error.
export const betCentsSchema = centsSchema.refine(
  (value) =>
    CENTS_PATTERN.test(value) &&
    BigInt(value) >= rules.minBetCents &&
    BigInt(value) <= rules.maxBetCents,
  'Bet must be between $0.10 and $1,000.00',
);

export const clientSeedSchema = z
  .string()
  .regex(
    CLIENT_SEED_PATTERN,
    'Client seed must be 1–64 printable ASCII characters without spaces or "|"',
  );

/** Auto cash-out target as a multiplier string with at most two decimals, e.g. "2.50". */
export const autoCashoutMultiplierSchema = z.string().refine((value) => {
  const hundredths = parseMultiplierToHundredths(value);
  return (
    hundredths !== null &&
    hundredths >= rules.minAutoCashoutHundredths &&
    hundredths <= rules.maxAutoCashoutHundredths
  );
}, 'Auto cash-out must be a multiplier from 1.01 to 1000.00 with at most two decimals');

/** Client-generated per-intent key (crypto.randomUUID() in the web app). */
export const IDEMPOTENCY_KEY_HEADER = 'idempotency-key';
export const idempotencyKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{16,64}$/, 'Idempotency-Key must be 16–64 URL-safe characters');

// ── Requests ────────────────────────────────────────────────────────────────────────────────

export const startRoundRequestSchema = z.strictObject({
  betCents: betCentsSchema,
  clientSeed: clientSeedSchema,
  /** The prepared commitment the player was shown; it becomes the round id. */
  commitmentId: roundIdSchema,
  autoCashoutMultiplier: autoCashoutMultiplierSchema.nullable(),
});

/** Body of POST /api/pump/pump and POST /api/pump/cashout. */
export const roundActionRequestSchema = z.strictObject({
  roundId: roundIdSchema,
  /** The round version the player acted on; stale versions are rejected with 409. */
  expectedVersion: z.int().min(0).max(1_000),
});

export const rotateCommitmentRequestSchema = z.strictObject({
  commitmentId: roundIdSchema,
});

export const HISTORY_PAGE_SIZE_DEFAULT = 10;
export const HISTORY_PAGE_SIZE_MAX = 50;

export const historyQuerySchema = z.strictObject({
  limit: z
    .string()
    .regex(/^[1-9][0-9]?$/, 'limit must be an integer from 1 to 50')
    .transform(Number)
    .refine((limit) => limit <= HISTORY_PAGE_SIZE_MAX, 'limit must be at most 50')
    .optional(),
  /** Nonce of the last round on the previous page. */
  cursor: z
    .string()
    .regex(/^[1-9][0-9]{0,9}$/, 'cursor must be a round nonce')
    .transform(Number)
    .refine((cursor) => cursor <= 2_147_483_647, 'cursor must be a round nonce')
    .optional(),
});

export const roundParamsSchema = z.strictObject({ id: roundIdSchema });

// ── Responses ───────────────────────────────────────────────────────────────────────────────

export const roundStatusSchema = z.enum(['ACTIVE', 'POPPED', 'CASHED_OUT', 'EXPIRED']);
export const settlementReasonSchema = z.enum(['MANUAL', 'AUTO_TARGET', 'LADDER_TOP']);

export const publicRoundSchema = z
  .strictObject({
    id: roundIdSchema,
    status: roundStatusSchema,
    settlementReason: settlementReasonSchema.nullable(),
    /** Increments on every state change; send it back as expectedVersion. */
    version: z.int().min(0),
    betCents: centsSchema,
    pumpCount: z.int().min(0).max(rules.maxPumps),
    maxPumps: z.int().min(1),
    /** Multiplier reached, floored to 2 dp for display; null before the first pump. */
    multiplier: z.string().nullable(),
    /** Exact amount a cash-out pays right now; null unless ACTIVE with at least one pump. */
    cashoutCents: centsSchema.nullable(),
    /** Public chance that the next pump pops; null when no pump is possible. */
    nextPopChanceBasisPoints: z.int().min(0).nullable(),
    nextMultiplier: z.string().nullable(),
    autoCashoutMultiplier: z.string().nullable(),
    /** Credited at settlement ("0" when popped or expired); null while ACTIVE. */
    payoutCents: centsSchema.nullable(),
    startedAt: isoDateSchema,
    endedAt: isoDateSchema.nullable(),
    expiresAt: isoDateSchema,
    fairness: z.strictObject({
      rulesVersion: z.literal(rules.version),
      commitment: hex32Schema,
      clientSeed: z.string(),
      nonce: z.int().min(1),
      /** Revealed only once the round has ended. */
      serverSeed: hex32Schema.nullable(),
    }),
  })
  .refine(
    (round) => (round.status === 'ACTIVE') === (round.fairness.serverSeed === null),
    'The server seed is revealed exactly when the round has ended',
  );

export const commitmentSchema = z.strictObject({
  /** Pre-allocated round id; send it as commitmentId when starting the round. */
  id: roundIdSchema,
  commitment: hex32Schema,
  nonce: z.int().min(1),
});

export const walletSchema = z.strictObject({ balanceCents: centsSchema });

/** Returned by every gameplay endpoint so the client can replace its state wholesale. */
export const gameStateSchema = z.strictObject({
  round: publicRoundSchema.nullable(),
  wallet: walletSchema,
  nextCommitment: commitmentSchema,
});

export const sessionResponseSchema = z.strictObject({
  player: z.strictObject({ id: z.uuid(), createdAt: isoDateSchema }),
  isNew: z.boolean(),
});

export const historyResponseSchema = z.strictObject({
  rounds: z.array(publicRoundSchema),
  nextCursor: z.string().nullable(),
});

/** Everything needed to recompute a finished round; input format of tools/verify-round.mjs. */
export const verificationDataSchema = z.strictObject({
  rulesVersion: z.literal(rules.version),
  commitment: hex32Schema,
  serverSeed: hex32Schema,
  roundId: roundIdSchema,
  nonce: z.int().min(1),
  clientSeed: z.string(),
  betCents: centsSchema,
  autoCashoutHundredths: hundredthsSchema.nullable(),
  outcome: z.strictObject({
    status: z.enum(['POPPED', 'CASHED_OUT', 'EXPIRED']),
    pumpCount: z.int().min(0).max(rules.maxPumps),
    settlementReason: settlementReasonSchema.nullable(),
    payoutCents: centsSchema,
  }),
});

export const verifyResponseSchema = z.strictObject({
  round: publicRoundSchema,
  verification: verificationDataSchema,
});

export const rotateCommitmentResponseSchema = z.strictObject({
  revoked: z.strictObject({ id: roundIdSchema, commitment: hex32Schema, serverSeed: hex32Schema }),
  nextCommitment: commitmentSchema,
});

export const healthResponseSchema = z.strictObject({
  status: z.enum(['ok', 'degraded']),
  database: z.enum(['ok', 'unreachable']),
  version: z.string(),
  uptimeSeconds: z.number().nonnegative(),
});

// ── Errors ──────────────────────────────────────────────────────────────────────────────────

/** Every error code the API can return, with its HTTP status. */
export const ERROR_STATUS = {
  VALIDATION_ERROR: 400,
  SESSION_REQUIRED: 401,
  ORIGIN_REJECTED: 403,
  NOT_FOUND: 404,
  ROUND_NOT_FOUND: 404,
  ACTIVE_ROUND_EXISTS: 409,
  STALE_ROUND_VERSION: 409,
  ROUND_NOT_ACTIVE: 409,
  ROUND_EXPIRED: 409,
  ROUND_IN_PROGRESS: 409,
  COMMITMENT_MISMATCH: 409,
  PAYLOAD_TOO_LARGE: 413,
  UNSUPPORTED_MEDIA_TYPE: 415,
  INSUFFICIENT_BALANCE: 422,
  CASHOUT_REQUIRES_PUMP: 422,
  IDEMPOTENCY_KEY_REUSED: 422,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
} as const;

export type ErrorCode = keyof typeof ERROR_STATUS;

const errorCodes = Object.keys(ERROR_STATUS) as [ErrorCode, ...ErrorCode[]];

export const errorResponseSchema = z.strictObject({
  error: z.strictObject({
    code: z.enum(errorCodes),
    message: z.string(),
    requestId: z.string(),
  }),
  /** Authoritative state attached to conflicts so the client can resync without another call. */
  state: gameStateSchema.optional(),
});

// ── Types ───────────────────────────────────────────────────────────────────────────────────

export type StartRoundRequest = z.infer<typeof startRoundRequestSchema>;
export type RoundActionRequest = z.infer<typeof roundActionRequestSchema>;
export type RotateCommitmentRequest = z.infer<typeof rotateCommitmentRequestSchema>;
export type HistoryQuery = z.infer<typeof historyQuerySchema>;
export type PublicRound = z.infer<typeof publicRoundSchema>;
export type Commitment = z.infer<typeof commitmentSchema>;
export type Wallet = z.infer<typeof walletSchema>;
export type GameState = z.infer<typeof gameStateSchema>;
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export type HistoryResponse = z.infer<typeof historyResponseSchema>;
export type VerificationData = z.infer<typeof verificationDataSchema>;
export type VerifyResponse = z.infer<typeof verifyResponseSchema>;
export type RotateCommitmentResponse = z.infer<typeof rotateCommitmentResponseSchema>;
export type ErrorResponse = z.infer<typeof errorResponseSchema>;
