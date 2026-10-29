import {
  IDEMPOTENCY_KEY_HEADER,
  errorResponseSchema,
  gameStateSchema,
  healthResponseSchema,
  historyQuerySchema,
  historyResponseSchema,
  idempotencyKeySchema,
  rotateCommitmentRequestSchema,
  rotateCommitmentResponseSchema,
  roundActionRequestSchema,
  roundParamsSchema,
  sessionResponseSchema,
  startRoundRequestSchema,
  verifyResponseSchema,
  walletSchema,
} from '@pump/contracts';
import type { FastifyPluginCallback, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DomainError } from '../services/errors';
import type { ActionRequestContext } from '../services/game-service';
import type { ActionOutcome } from '../services/idempotency';
import type { SessionPlayer } from '../services/sessions';
import type { AppDependencies } from './app';
import { cachedPing } from './cached-ping';

const SESSION_COOKIE = 'pump_session';
/** Browsers cap cookie lifetimes at 400 days. */
const SESSION_MAX_AGE_SECONDS = 400 * 24 * 60 * 60;
/** Health checks share one database ping per this interval. */
const HEALTH_PING_TTL_MS = 2_000;
/** Each rotation stores a commitment and a request record, so it gets its own, tighter limit. */
const ROTATIONS_PER_MINUTE = 20;

function parse<S extends z.ZodType>(schema: S, value: unknown, what: string): z.output<S> {
  const result = schema.safeParse(value);
  if (!result.success) {
    throw new DomainError('VALIDATION_ERROR', `Invalid ${what}: ${z.prettifyError(result.error)}`);
  }
  return result.data;
}

/**
 * Thin HTTP adapters: validate input with the shared contracts, call the service, and validate
 * every response body against its strict schema before it leaves the server, so an accidental
 * extra field (such as a hidden pop point) becomes a 500 instead of a leak.
 */
export const registerApiRoutes: FastifyPluginCallback<AppDependencies> = (app, deps, done) => {
  const { service, config } = deps;
  const pingDatabase = cachedPing(deps.pingDatabase, HEALTH_PING_TTL_MS);
  const checkSessionCreationLimit = app.createRateLimit({
    max: config.sessionsPerHourPerIp,
    timeWindow: '1 hour',
  });

  async function requirePlayer(request: FastifyRequest): Promise<SessionPlayer> {
    const token = request.cookies[SESSION_COOKIE];
    const player = token === undefined ? null : await service.findPlayer(token);
    if (!player) {
      throw new DomainError('SESSION_REQUIRED', 'No active session; call POST /api/session first');
    }
    return player;
  }

  async function actionContext(request: FastifyRequest): Promise<ActionRequestContext> {
    const player = await requirePlayer(request);
    const idempotencyKey = parse(
      idempotencyKeySchema,
      request.headers[IDEMPOTENCY_KEY_HEADER],
      'Idempotency-Key header',
    );
    return { playerId: player.id, idempotencyKey, requestId: request.id };
  }

  function sendOutcome(reply: FastifyReply, outcome: ActionOutcome, successSchema: z.ZodType) {
    const schema = outcome.statusCode < 400 ? successSchema : errorResponseSchema;
    if (outcome.replayed) reply.header('idempotent-replayed', 'true');
    return reply.code(outcome.statusCode).send(schema.parse(outcome.body));
  }

  app.post('/session', async (request, reply) => {
    const token = request.cookies[SESSION_COOKIE];
    const existing = token === undefined ? null : await service.findPlayer(token);
    if (existing) {
      return sessionResponseSchema.parse({
        player: { id: existing.id, createdAt: existing.createdAt.toISOString() },
        isNew: false,
      });
    }
    // isAllowed means "on the allow list"; the limit itself is reported by isExceeded.
    const limit = await checkSessionCreationLimit(request);
    if (!limit.isAllowed && limit.isExceeded) {
      throw new DomainError('RATE_LIMITED', 'Too many new players from this network; try later');
    }
    const created = await service.createPlayer();
    reply.setCookie(SESSION_COOKIE, created.token, {
      path: '/api',
      httpOnly: true,
      sameSite: 'strict',
      secure: config.cookieSecure,
      maxAge: SESSION_MAX_AGE_SECONDS,
    });
    return reply.code(201).send(
      sessionResponseSchema.parse({
        player: { id: created.player.id, createdAt: created.player.createdAt.toISOString() },
        isNew: true,
      }),
    );
  });

  app.get('/pump/current', async (request) => {
    const player = await requirePlayer(request);
    return gameStateSchema.parse(await service.getState(player.id));
  });

  app.post('/pump/start', async (request, reply) => {
    const ctx = await actionContext(request);
    const body = parse(startRoundRequestSchema, request.body, 'request body');
    return sendOutcome(reply, await service.start(ctx, body), gameStateSchema);
  });

  app.post('/pump/pump', async (request, reply) => {
    const ctx = await actionContext(request);
    const body = parse(roundActionRequestSchema, request.body, 'request body');
    return sendOutcome(reply, await service.pump(ctx, body), gameStateSchema);
  });

  app.post('/pump/cashout', async (request, reply) => {
    const ctx = await actionContext(request);
    const body = parse(roundActionRequestSchema, request.body, 'request body');
    return sendOutcome(reply, await service.cashOut(ctx, body), gameStateSchema);
  });

  const rotateLimit = { rateLimit: { max: ROTATIONS_PER_MINUTE, timeWindow: '1 minute' } };
  app.post('/fairness/rotate', { config: rotateLimit }, async (request, reply) => {
    const ctx = await actionContext(request);
    const body = parse(rotateCommitmentRequestSchema, request.body, 'request body');
    return sendOutcome(
      reply,
      await service.rotateCommitment(ctx, body),
      rotateCommitmentResponseSchema,
    );
  });

  app.get('/wallet', async (request) => {
    const player = await requirePlayer(request);
    return walletSchema.parse(await service.getWallet(player.id));
  });

  app.get('/history', async (request) => {
    const player = await requirePlayer(request);
    const query = parse(historyQuerySchema, request.query, 'query');
    return historyResponseSchema.parse(await service.getHistory(player.id, query));
  });

  app.get('/rounds/:id/verify', async (request) => {
    const player = await requirePlayer(request);
    const { id } = parse(roundParamsSchema, request.params, 'round id');
    return verifyResponseSchema.parse(await service.getVerification(player.id, id));
  });

  app.get('/health', { config: { rateLimit: false } }, async (request, reply) => {
    let database: 'ok' | 'unreachable' = 'ok';
    try {
      await pingDatabase();
    } catch (error) {
      database = 'unreachable';
      request.log.warn({ err: error }, 'health check: database unreachable');
    }
    return reply.code(database === 'ok' ? 200 : 503).send(
      healthResponseSchema.parse({
        status: database === 'ok' ? 'ok' : 'degraded',
        database,
        version: config.version,
        uptimeSeconds: Math.round(process.uptime()),
      }),
    );
  });
  done();
};
