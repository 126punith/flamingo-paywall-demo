import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

import { log, short } from './log.js';
import { HttpError } from './types.js';

const TOKEN_TTL_S = 365 * 24 * 60 * 60;

function secret() {
  const value = process.env.SESSION_SECRET;
  if (value) return value;
  if (process.env.IAP_MOCK === '1') return 'mock-mode-dev-secret';
  throw new HttpError(500, 'Server is missing SESSION_SECRET');
}

const b64url = (input: string | Buffer) => Buffer.from(input).toString('base64url');
const sign = (data: string) => createHmac('sha256', secret()).update(data).digest('base64url');

/**
 * Demo stand-in for real sign-in: the server mints the user id, so clients can
 * no longer pick whose entitlement they read or write.
 */
export function issueSession() {
  const userId = randomUUID();
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify({ sub: userId, iat: now, exp: now + TOKEN_TTL_S }));
  log.info('auth', 'issued anonymous session', { user: short(userId) });
  return { userId, token: `${header}.${payload}.${sign(`${header}.${payload}`)}` };
}

export function verifySessionToken(token: string): string | null {
  const [header, payload, signature] = token.split('.');
  if (!header || !payload || !signature) return null;
  const expected = Buffer.from(sign(`${header}.${payload}`));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return null;
  try {
    const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (typeof claims.sub !== 'string' || typeof claims.exp !== 'number') return null;
    if (claims.exp * 1000 < Date.now()) return null;
    return claims.sub;
  } catch {
    return null;
  }
}

/** Sets `res.locals.userId` from `Authorization: Bearer <token>`. */
export function requireUser(req: Request, res: Response, next: NextFunction) {
  const [scheme, token] = (req.header('authorization') ?? '').split(' ');
  const userId = scheme === 'Bearer' && token ? verifySessionToken(token) : null;
  if (!userId) {
    log.warn('auth', `rejected ${req.method} ${req.path}`, {
      reason: scheme === 'Bearer' && token ? 'bad signature or expired' : 'no bearer token',
    });
    return next(new HttpError(401, 'Missing or invalid session.'));
  }
  res.locals.userId = userId;
  next();
}
