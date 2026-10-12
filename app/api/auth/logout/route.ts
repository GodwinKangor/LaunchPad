import { errorResponse } from '@/lib/api';
import { assertSameOrigin, clearSessionCookieHeader } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export async function POST(req: Request): Promise<Response> {
  try {
    assertSameOrigin(req);
    return Response.json({ ok: true }, { headers: { 'Set-Cookie': clearSessionCookieHeader() } });
  } catch (err) {
    return errorResponse(err);
  }
}
