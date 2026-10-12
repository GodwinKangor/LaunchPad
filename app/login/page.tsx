import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { LoginForm } from '@/components/LoginForm';
import { Alert, Card, Logo } from '@/components/ui';
import { DEMO_DEFAULTS, isDemoMode } from '@/lib/config';
import { getServerSession } from '@/lib/server-session';

export const metadata: Metadata = { title: 'Sign in' };
export const dynamic = 'force-dynamic';

/** Only same-site paths are accepted, so the login page cannot be used as an open redirect. */
function safeNext(value: string | string[] | undefined): string {
  const next = Array.isArray(value) ? value[0] : value;
  return next && /^\/(?!\/)[A-Za-z0-9/_-]*$/.test(next) ? next : '/projects';
}

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string | string[] }> }) {
  const next = safeNext((await searchParams).next);
  if (await getServerSession()) redirect(next);
  // Pre-fill only when demo mode is running on its built-in public credentials.
  const demoDefaults = isDemoMode() && !process.env.OWNER_PASSWORD;
  return (
    <main className="flex min-h-full items-center justify-center px-4 py-12">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex justify-center">
          <Logo className="text-xl" />
        </div>
        <Card className="p-6">
          <h1 className="text-lg font-semibold">Sign in</h1>
          <p className="mb-5 mt-1 text-sm text-muted">Use the owner account configured for this server.</p>
          {demoDefaults && (
            <div className="mb-5">
              <Alert tone="info" title="Demo mode">
                Deployments are simulated. The demo credentials are filled in for you.
              </Alert>
            </div>
          )}
          <LoginForm next={next} demo={demoDefaults ? { email: DEMO_DEFAULTS.ownerEmail, password: DEMO_DEFAULTS.ownerPassword } : null} />
        </Card>
      </div>
    </main>
  );
}
