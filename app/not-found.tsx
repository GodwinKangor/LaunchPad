import Link from 'next/link';
import { buttonClass } from '@/components/ui';

export default function NotFound() {
  return (
    <main className="flex min-h-full flex-col items-center justify-center px-4 text-center">
      <p className="font-mono text-sm text-muted">404</p>
      <h1 className="mt-2 text-xl font-semibold">Page not found</h1>
      <p className="mt-2 text-sm text-muted">The page you are looking for does not exist or was removed.</p>
      <Link href="/projects" className={`${buttonClass('secondary')} mt-6`}>
        Back to projects
      </Link>
    </main>
  );
}
