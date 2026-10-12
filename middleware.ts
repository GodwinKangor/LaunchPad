import { NextResponse, type NextRequest } from 'next/server';
import { authConfig } from '@/lib/config';
import { SESSION_COOKIE, verifySessionToken } from '@/lib/session';

/**
 * First line of defence only: keeps signed-out visitors away from dashboard
 * pages. Every API route and server layout verifies the session again.
 */
export async function middleware(req: NextRequest) {
  const session = await verifySessionToken(req.cookies.get(SESSION_COOKIE)?.value, authConfig().sessionSecret);
  if (session) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json({ error: { code: 'unauthorized', message: 'Sign in to continue.' } }, { status: 401 });
  }
  const login = new URL('/login', req.url);
  if (req.nextUrl.pathname !== '/') login.searchParams.set('next', req.nextUrl.pathname);
  return NextResponse.redirect(login);
}

export const config = {
  runtime: 'nodejs',
  matcher: ['/((?!login|api/auth/|api/health|_next/|favicon.ico|icon.svg).*)'],
};
