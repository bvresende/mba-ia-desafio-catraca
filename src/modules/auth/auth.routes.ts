import type { FastifyInstance, FastifyReply } from 'fastify';
import { env } from '../../config/env.js';
import {
  renderHomePage,
  renderLoginPage,
  renderOrganizerPlaceholderPage,
  renderRegisterPage,
} from '../../views/auth.views.js';
import { requireOrganizer } from './auth.middleware.js';
import {
  authenticateUser,
  createSession,
  deleteSession,
  registerParticipant,
} from './auth.service.js';

function asString(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function setSessionCookie(
  reply: FastifyReply,
  sessionId: string,
  expiresAt: Date,
): void {
  reply.setCookie(env.SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
    secure: false,
  });
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.get('/', async (request, reply) => {
    return reply
      .type('text/html; charset=utf-8')
      .send(renderHomePage(request.currentUser));
  });

  app.get('/register', async (request, reply) => {
    if (request.currentUser) {
      return reply.redirect(
        request.currentUser.role === 'organizer' ? '/organizer/events' : '/',
      );
    }
    return reply
      .type('text/html; charset=utf-8')
      .send(renderRegisterPage());
  });

  app.post('/register', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const name = asString(body['name']);
    const email = asString(body['email']);
    const password = asString(body['password']);

    // Intentionally ignore any client-supplied role field (FR-007)
    const result = await registerParticipant({ name, email, password });
    if (!result.ok) {
      return reply
        .code(400)
        .type('text/html; charset=utf-8')
        .send(renderRegisterPage({ error: result.error, name, email }));
    }

    const session = await createSession(result.user.id);
    setSessionCookie(reply, session.id, session.expiresAt);
    return reply.redirect('/');
  });

  app.get('/login', async (request, reply) => {
    if (request.currentUser) {
      return reply.redirect(
        request.currentUser.role === 'organizer' ? '/organizer/events' : '/',
      );
    }
    return reply
      .type('text/html; charset=utf-8')
      .send(renderLoginPage());
  });

  app.post('/login', async (request, reply) => {
    const body = (request.body ?? {}) as Record<string, unknown>;
    const email = asString(body['email']);
    const password = asString(body['password']);

    const user = await authenticateUser({ email, password });
    if (!user) {
      return reply
        .code(401)
        .type('text/html; charset=utf-8')
        .send(
          renderLoginPage({
            error: 'E-mail ou senha inválidos.',
            email,
          }),
        );
    }

    const session = await createSession(user.id);
    setSessionCookie(reply, session.id, session.expiresAt);
    return reply.redirect(
      user.role === 'organizer' ? '/organizer/events' : '/',
    );
  });

  app.post('/logout', async (request, reply) => {
    const cookieName = env.SESSION_COOKIE_NAME;
    const sessionId = request.cookies?.[cookieName];
    if (sessionId) {
      await deleteSession(sessionId);
    }
    reply.clearCookie(cookieName, { path: '/' });
    return reply.redirect('/');
  });

  app.get(
    '/organizer',
    { preHandler: requireOrganizer },
    async (_request, reply) => {
      return reply.redirect('/organizer/events');
    },
  );

  app.get(
    '/organizer/events',
    { preHandler: requireOrganizer },
    async (request, reply) => {
      const organizer = request.currentUser!;
      return reply
        .type('text/html; charset=utf-8')
        .send(renderOrganizerPlaceholderPage(organizer));
    },
  );
}
