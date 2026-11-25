import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { env } from '../../config/env.js';

function isValidPartnerApiKey(
  headerValue: string | string[] | undefined,
): boolean {
  if (typeof headerValue !== 'string' || headerValue.length === 0) {
    return false;
  }

  const expected = env.PARTNER_API_KEY;
  if (expected.length === 0) {
    return false;
  }

  const providedBuffer = Buffer.from(headerValue, 'utf8');
  const expectedBuffer = Buffer.from(expected, 'utf8');

  if (providedBuffer.length !== expectedBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedBuffer, expectedBuffer);
}

export async function partnerRoutes(app: FastifyInstance): Promise<void> {
  app.addHook('onRequest', async (request, reply) => {
    if (!isValidPartnerApiKey(request.headers['x-api-key'])) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
  });

  app.setErrorHandler((error, request, reply) => {
    const err = error as { code?: unknown; statusCode?: unknown };
    const code = typeof err.code === 'string' ? err.code : '';
    const statusCode = typeof err.statusCode === 'number' ? err.statusCode : 500;

    if (
      code.startsWith('FST_ERR_CTP_') ||
      statusCode === 400 ||
      statusCode === 415
    ) {
      return reply.code(422).send({ error: 'invalid_request' });
    }

    request.log.error(error);
    return reply.code(500).send({ error: 'internal_server_error' });
  });
}
