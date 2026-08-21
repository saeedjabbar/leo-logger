import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { Store } from './store.js';
import type { Session, User } from './types.js';
import { newToken, tokenId } from './security.js';

declare global {
  namespace Express {
    interface Request { currentUser?: User; currentSession?: Session }
  }
}

const COOKIE_NAME = 'leo_session';

export async function issueSession(store: Store, user: User, request: Request, response: Response) {
  const token = newToken();
  const session: Session = {
    id: tokenId(token),
    userId: user.id,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
    userAgent: request.get('user-agent')?.slice(0, 200),
  };
  await store.put('sessions', session.id, session);
  response.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 365 * 24 * 60 * 60 * 1000,
    path: '/',
  });
}

export function authMiddleware(store: Store) {
  return async (request: Request, _response: Response, next: NextFunction) => {
    try {
      const token = request.cookies?.[COOKIE_NAME] as string | undefined;
      if (!token) return next();
      const session = await store.get<Session>('sessions', tokenId(token));
      if (!session || new Date(session.expiresAt) <= new Date()) return next();
      const user = await store.get<User>('users', session.userId);
      if (user?.active) { request.currentUser = user; request.currentSession = session; }
      next();
    } catch (error) { next(error); }
  };
}

export function requireUser(request: Request, response: Response, next: NextFunction) {
  if (!request.currentUser) return response.status(401).json({ error: 'Please sign in' });
  next();
}

export function requireAdmin(request: Request, response: Response, next: NextFunction) {
  if (!request.currentUser) return response.status(401).json({ error: 'Please sign in' });
  if (request.currentUser.role !== 'master_admin') return response.status(403).json({ error: 'Admin access required' });
  next();
}

export async function logout(store: Store, request: Request, response: Response) {
  if (request.currentSession) await store.remove('sessions', request.currentSession.id);
  response.clearCookie(COOKIE_NAME, { path: '/' });
}

export function publicUser(user: User) {
  const safe: Partial<User> = { ...user };
  delete safe.passwordHash;
  delete safe.pinHash;
  return safe;
}

export function createId() { return randomUUID(); }
