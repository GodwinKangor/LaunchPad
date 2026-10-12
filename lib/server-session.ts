import { cookies } from 'next/headers';
import { authConfig } from './config';
import { SESSION_COOKIE, verifySessionToken, type Session } from './session';

/** Session lookup for server components. Route handlers use getSession(req) instead. */
export async function getServerSession(): Promise<Session | null> {
  const jar = await cookies();
  return verifySessionToken(jar.get(SESSION_COOKIE)?.value, authConfig().sessionSecret);
}
