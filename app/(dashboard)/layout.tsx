import { FlaskConical } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { SignOutButton } from '@/components/SignOutButton';
import { Logo } from '@/components/ui';
import { isDemoMode } from '@/lib/config';
import { getServerSession } from '@/lib/server-session';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  if (!(await getServerSession())) redirect('/login');
  return (
    <div className="flex min-h-full flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-raised focus:px-3 focus:py-2 focus:text-sm">
        Skip to content
      </a>
      {isDemoMode() && (
        <div role="status" className="flex items-center justify-center gap-2 border-b border-warn/30 bg-warn/10 px-4 py-2 text-center text-xs text-warn">
          <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>
            <strong className="font-semibold">Demo mode.</strong> Deployments are simulated: nothing is cloned, built or run.
          </span>
        </div>
      )}
      <header className="border-b border-line bg-surface/60 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/projects" aria-label="LaunchPad projects">
            <Logo />
          </Link>
          <SignOutButton />
        </div>
      </header>
      <main id="main" className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6">
        {children}
      </main>
    </div>
  );
}
