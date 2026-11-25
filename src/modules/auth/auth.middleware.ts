import type { FastifyReply, FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import { renderForbiddenPage } from '../../views/auth.views.js';
import { getSessionUser, type AuthUser } from './auth.service.js';

declare module 'fastify' {
  interface FastifyRequest {
    currentUser: AuthUser | null;
  }
}

export async function attachSession(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  request.currentUser = null;

  const cookieName = env.SESSION_COOKIE_NAME;
  const sessionId = request.cookies?.[cookieName];
  if (!sessionId) {
    return;
  }

  try {
    const user = await getSessionUser(sessionId);
    if (user) {
      request.currentUser = user;
    } else {
      reply.clearCookie(cookieName, { path: '/' });
    }
  } catch {
    request.currentUser = null;
  }
}

export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.currentUser) {
    reply.redirect('/login');
    return;
  }
}

export async function requireParticipant(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.currentUser) {
    reply.redirect('/login');
    return;
  }

  if (request.currentUser.role !== 'participant') {
    reply
      .code(403)
      .type('text/html; charset=utf-8')
      .send(
        renderForbiddenPage(
          request.currentUser,
          'Esta área é exclusiva para participantes.',
        ),
      );
    return;
  }
}

export async function requireOrganizer(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  if (!request.currentUser) {
    reply.redirect('/login');
    return;
  }

  if (request.currentUser.role !== 'organizer') {
    reply
      .code(403)
      .type('text/html; charset=utf-8')
      .send(
        renderForbiddenPage(
          request.currentUser,
          'Acesso restrito a organizadores.',
        ),
      );
    return;
  }
}
