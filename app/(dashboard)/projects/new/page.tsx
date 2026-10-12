import { ChevronLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { NewProjectForm } from '@/components/NewProjectForm';
import { baseConfig, projectUrl } from '@/lib/config';

export const metadata: Metadata = { title: 'New project' };

export default function NewProjectPage() {
  const config = baseConfig();
  const urlPattern = config.demo ? '{name} (simulated)' : projectUrl('{name}', config).replace(/^https?:\/\//, '');
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/projects" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeft className="h-4 w-4" aria-hidden />
        Projects
      </Link>
      <h1 className="text-2xl font-semibold tracking-tight">New project</h1>
      <p className="mb-6 mt-1 text-sm text-muted">Connect a repository. You can add environment variables before the first deploy.</p>
      <NewProjectForm urlPattern={urlPattern} demo={config.demo} />
    </div>
  );
}
