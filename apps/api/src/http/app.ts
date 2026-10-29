import { randomUUID } from 'node:crypto';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import { ERROR_STATUS, type ErrorCode, type ErrorResponse } from '@pump/contracts';
import Fastify, { type FastifyError, type FastifyInstance, type FastifyRequest } from 'fastify';
import type { AppConfig } from '../config';
import { DomainError } from '../services/errors';
import type { GameService } from '../services/game-service';
import { registerApiRoutes } from './routes';

export interface AppDependencies {
  readonly config: AppConfig;
  readonly service: GameService;
  /** Resolves when the database answers a trivial query. */
  readonly pingDatabase: () => Promise<void>;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);
/** Request bodies are a few hundred bytes; anything larger is rejected before parsing. */
const BODY_LIMIT_BYTES = 4 * 1024;

export async function buildApp(deps: AppDependencies): Promise<FastifyInstance> {
  const { config } = deps;
  const app = Fastify({
    logger:
      config.logLevel === 'silent'
        ? false
        : {
            level: config.logLevel,
            redact: [
              'req.headers.cookie',
              'req.headers.authorization',
              'res.headers["set-cookie"]',
            ],
          },
    trustProxy: config.trustProxy,
    bodyLimit: BODY_LIMIT_BYTES,
    genReqId: () => randomUUID(),
    requestIdHeader: false,
  });

  // JSON only: a cross-site <form> can send text/plain, which must never reach a handler.
  app.removeContentTypeParser('text/plain');

  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
      },
    },
  });
  await app.register(cookie);
  await app.register(rateLimit, {
    max: config.rateLimitPerMinute,
    timeWindow: '1 minute',
    // The plugin throws whatever this returns; statusCode 429 maps it to RATE_LIMITED.
    errorResponseBuilder: (_request, context) => ({
      statusCode: 429,
      message: `Too many requests; retry in ${Math.ceil(context.ttl / 1000).toString()}s`,
    }),
  });

  app.addHook('onRequest', (request, _reply, done) => {
    if (MUTATING_METHODS.has(request.method) && isCrossSite(request, config.allowedOrigins)) {
      done(new DomainError('ORIGIN_REJECTED', 'Cross-site requests are not allowed'));
      return;
    }
    done();
  });

  app.setErrorHandler((error: FastifyError | DomainError, request, reply) => {
    const { code, message } = describeError(error);
    const status = ERROR_STATUS[code];
    if (status >= 500) request.log.error({ err: error }, 'request failed');
    return reply.code(status).send(errorPayload(code, message, request));
  });

  await app.register(registerApiRoutes, { prefix: '/api', ...deps });

  if (config.webDistDir) {
    await app.register(fastifyStatic, {
      root: config.webDistDir,
      wildcard: false,
      setHeaders: (reply, filePath) => {
        // Vite fingerprints everything under /assets, so those files never change.
        const immutable = filePath.replaceAll('\\', '/').includes('/assets/');
        reply.header(
          'cache-control',
          immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
        );
      },
    });
  }

  app.setNotFoundHandler((request, reply) => {
    const wantsPage =
      config.webDistDir !== null &&
      request.method === 'GET' &&
      !request.url.startsWith('/api/') &&
      (request.headers.accept ?? '').includes('text/html');
    if (wantsPage) return reply.header('cache-control', 'no-cache').sendFile('index.html');
    return reply.code(404).send(errorPayload('NOT_FOUND', 'Not found', request));
  });

  return app;
}

/**
 * CSRF defence in depth (on top of SameSite=Strict cookies and the JSON-only body parser):
 * browsers label cross-site requests with Sec-Fetch-Site and Origin; either one marking the
 * request as coming from another site rejects it. Non-browser clients send neither.
 */
function isCrossSite(request: FastifyRequest, allowedOrigins: readonly string[]): boolean {
  const fetchSite = request.headers['sec-fetch-site'];
  if (fetchSite !== undefined && fetchSite !== 'same-origin' && fetchSite !== 'none') return true;
  const origin = request.headers.origin;
  if (origin === undefined || allowedOrigins.includes(origin)) return false;
  // Host headers rarely carry a default port, but URL() always drops one; compare like for like.
  const requestHost = request.host.replace(/:(80|443)$/, '');
  try {
    return new URL(origin).host !== requestHost;
  } catch {
    return true; // "null" or malformed origins are never same-site
  }
}

function describeError(error: FastifyError | DomainError): { code: ErrorCode; message: string } {
  if (error instanceof DomainError) return { code: error.code, message: error.message };
  switch (error.code) {
    case 'FST_ERR_CTP_BODY_TOO_LARGE':
      return { code: 'PAYLOAD_TOO_LARGE', message: 'Request body is too large' };
    case 'FST_ERR_CTP_INVALID_MEDIA_TYPE':
      return {
        code: 'UNSUPPORTED_MEDIA_TYPE',
        message: 'Send JSON with Content-Type: application/json',
      };
    case 'FST_ERR_CTP_EMPTY_JSON_BODY':
    case 'FST_ERR_CTP_INVALID_JSON_BODY':
      return { code: 'VALIDATION_ERROR', message: 'Request body is not valid JSON' };
  }
  if (error.statusCode === 429) return { code: 'RATE_LIMITED', message: error.message };
  if (error.statusCode !== undefined && error.statusCode >= 400 && error.statusCode < 500) {
    return { code: 'VALIDATION_ERROR', message: 'The request could not be processed' };
  }
  return {
    code: 'INTERNAL_ERROR',
    message: 'Something went wrong. Refresh to see your latest balance.',
  };
}

export function errorPayload(
  code: ErrorCode,
  message: string,
  request: FastifyRequest,
): ErrorResponse {
  return { error: { code, message, requestId: request.id } };
}
