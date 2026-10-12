import { createHash, timingSafeEqual } from 'node:crypto';
import { authConfig, type AuthConfig } from './config';
import { ForbiddenError, UnauthorizedError } from './errors';
import { SESSION_COOKIE, SESSION_TTL_SECONDS, createSessionToken, verifySessionToken, type Session } from './session';

/** The MVP has exactly one account. Projects still record an owner so more can be added later. */
export const OWNER_ID = 'owner';

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

/** Compares fixed-length digests so timing does not reveal length or prefix matches. */
export function verifyCredentials(email: string, password: string, config: Pick<AuthConfig, 'ownerEmail' | 'ownerPassword'>): boolean {
  const emailOk = timingSafeEqual(digest(email.trim().toLowerCase()), digest(config.ownerEmail));
  const passwordOk = timingSafeEqual(digest(password), digest(config.ownerPassword));
  return emailOk && passwordOk;
}

/** Global failed-login limiter. Coarse on purpose: there is one account and no trustworthy client IP behind a proxy. */
export class LoginThrottle {
  private failures: number[] = [];

  constructor(
    private readonly maxFailures = 8,
    private readonly windowMs = 10 * 60_000,
  ) {}

  private prune(now: number) {
    this.failures = this.failures.filter((t) => now - t < this.windowMs);
  }

  retryAfterSeconds(now: number = Date.now()): number {
    this.prune(now);
    if (this.failures.length < this.maxFailures) return 0;
    return Math.max(1, Math.ceil((this.failures[0] + this.windowMs - now) / 1000));
  }

  recordFailure(now: number = Date.now()) {
    this.prune(now);
    this.failures.push(now);
  }

  reset() {
    this.failures = [];
  }
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const index = part.indexOf('=');
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return undefined;
}

export async function getSession(req: Request, config: Pick<AuthConfig, 'sessionSecret'> = authConfig()): Promise<Session | null> {
  return verifySessionToken(readCookie(req, SESSION_COOKIE), config.sessionSecret);
}

export async function requireSession(req: Request, config: Pick<AuthConfig, 'sessionSecret'> = authConfig()): Promise<Session> {
  const session = await getSession(req, config);
  if (!session) throw new UnauthorizedError();
  return session;
}

/**
 * CSRF defence for state-changing requests, on top of SameSite=Lax cookies:
 * a browser always sends Origin (or Sec-Fetch-Site) on cross-site writes.
 */
export function assertSameOrigin(req: Request): void {
  if (req.method === 'GET' || req.method === 'HEAD') return;
  const origin = req.headers.get('origin');
  if (origin) {
    const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host') ?? new URL(req.url).host;
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch {
      /* malformed origin is rejected below */
    }
    if (originHost !== host) throw new ForbiddenError('Cross-site requests are not allowed.');
    return;
  }
  const site = req.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin' && site !== 'none') throw new ForbiddenError('Cross-site requests are not allowed.');
}

function cookieAttributes(config: Pick<AuthConfig, 'secureCookies'>): string {
  return `Path=/; HttpOnly; SameSite=Lax${config.secureCookies ? '; Secure' : ''}`;
}

export async function sessionCookieHeader(userId: string, config: AuthConfig = authConfig()): Promise<string> {
  const token = await createSessionToken(userId, config.sessionSecret);
  return `${SESSION_COOKIE}=${token}; Max-Age=${SESSION_TTL_SECONDS}; ${cookieAttributes(config)}`;
}

export function clearSessionCookieHeader(config: Pick<AuthConfig, 'secureCookies'> = authConfig()): string {
  return `${SESSION_COOKIE}=; Max-Age=0; ${cookieAttributes(config)}`;
}
