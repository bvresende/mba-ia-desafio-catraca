import Fastify, { type FastifyInstance } from 'fastify';
import cookie from '@fastify/cookie';
import formbody from '@fastify/formbody';
import { pool } from './db/client.js';
import {
  attachSession,
  requireOrganizer,
} from './modules/auth/auth.middleware.js';
import { authRoutes } from './modules/auth/auth.routes.js';
import { eventsRoutes } from './modules/events/events.routes.js';
import { partnerRoutes } from './modules/partner/partner.routes.js';
import { storefrontRoutes } from './modules/storefront/storefront.routes.js';
import { renderLayout } from './views/layout.js';

export function buildApp(): FastifyInstance {
  const app = Fastify({
    logger: process.env['NODE_ENV'] !== 'test',
  });

  app.register(cookie);
  app.register(formbody);

  app.addHook('onRequest', attachSession);

  app.get('/health', async (_request, reply) => {
    try {
      await pool.query('SELECT 1');
      return reply.code(200).send({ status: 'ok', db: 'ok' });
    } catch {
      return reply.code(503).send({ status: 'error', db: 'unavailable' });
    }
  });

  app.register(authRoutes);
  app.register(eventsRoutes);
  app.register(storefrontRoutes);
  app.register(partnerRoutes, { prefix: '/api/partner' });

  app.setNotFoundHandler(async (request, reply) => {
    if (request.currentUser === undefined) {
      await attachSession(request, reply);
    }
    const pathname = request.url.split('?')[0] ?? request.url;
    if (pathname === '/organizer' || pathname.startsWith('/organizer/')) {
      await requireOrganizer(request, reply);
      if (reply.sent) {
        return;
      }
    }

    return reply
      .code(404)
      .type('text/html; charset=utf-8')
      .send(
        renderLayout({
          title: 'Página não encontrada',
          currentUser: request.currentUser ?? null,
          bodyHtml: `
            <section class="card card-narrow">
              <h1>Página não encontrada</h1>
              <p class="muted">O recurso solicitado não existe.</p>
              <a href="/" class="btn btn-secondary">Voltar ao início</a>
            </section>
          `,
        }),
      );
  });

  return app;
}
