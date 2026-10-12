import { z } from 'zod';
import { readJson, errorResponse } from '@/lib/api';
import { LoginThrottle, OWNER_ID, assertSameOrigin, sessionCookieHeader, verifyCredentials } from '@/lib/auth';
import { authConfig } from '@/lib/config';
import { AppError } from '@/lib/errors';
import { parseInput } from '@/lib/validation';

export const dynamic = 'force-dynamic';

const throttle = new LoginThrottle();
const schema = z.object({ email: z.string().max(320), password: z.string().max(1024) });

export async function POST(req: Request): Promise<Response> {
  try {
    assertSameOrigin(req);
    const wait = throttle.retryAfterSeconds();
    if (wait > 0) throw new AppError(429, 'rate_limited', `Too many failed attempts. Try again in ${Math.ceil(wait / 60)} minute(s).`);
    const { email, password } = parseInput(schema, await readJson(req));
    const config = authConfig();
    if (!verifyCredentials(email, password, config)) {
      throttle.recordFailure();
      throw new AppError(401, 'invalid_credentials', 'That email and password do not match.');
    }
    throttle.reset();
    return Response.json({ ok: true }, { headers: { 'Set-Cookie': await sessionCookieHeader(OWNER_ID, config) } });
  } catch (err) {
    return errorResponse(err);
  }
}
