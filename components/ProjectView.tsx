'use client';

import { ArrowUpRight, ChevronLeft, GitBranch } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import type { ProjectDetailDTO } from '@/lib/dto';
import { repoLabel } from '@/lib/format';
import { isActiveState } from '@/lib/types';
import { EnvEditor } from './EnvEditor';
import { usePoll } from './hooks';
import { SettingsPanel } from './SettingsPanel';
import { ProjectBadge } from './StatusBadge';
import { Alert, Button, Spinner, buttonClass, cx } from './ui';

const TABS = [
  { id: 'env', label: 'Environment' },
  { id: 'settings', label: 'Settings' },
] as const;
type TabId = (typeof TABS)[number]['id'];

export function ProjectView({ projectId }: { projectId: string }) {
  const [busyHint, setBusyHint] = useState(false);
  const { data, error, loading, refresh } = usePoll<ProjectDetailDTO>(`/api/projects/${projectId}`, busyHint ? 1_500 : 6_000);
  const [tab, setTab] = useState<TabId>('env');

  const busy = data?.busy ?? false;
  if (busy !== busyHint) setBusyHint(busy);

  if (loading) return <Spinner label="Loading project" />;
  if (!data) {
    return error?.status === 404 ? (
      <div className="py-16 text-center">
        <h1 className="text-xl font-semibold">Project not found</h1>
        <p className="mt-2 text-sm text-muted">It may have been deleted.</p>
        <Link href="/projects" className={cx(buttonClass('secondary'), 'mt-6')}>
          Back to projects
        </Link>
      </div>
    ) : (
      <Alert title="Could not load this project" action={<Button size="sm" onClick={() => void refresh()}>Retry</Button>}>
        {error?.message}
      </Alert>
    );
  }

  const { project, deployments } = data;
  const deploying = deployments.some((d) => isActiveState(d.state));

  return (
    <div>
      <Link href="/projects" className="mb-4 inline-flex items-center gap-1 text-sm text-muted hover:text-ink">
        <ChevronLeft className="h-4 w-4" aria-hidden />
        Projects
      </Link>

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="truncate text-2xl font-semibold tracking-tight">{project.name}</h1>
            <ProjectBadge status={project.status} deploying={deploying} />
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
            {project.status === 'running' ? (
              <a href={project.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-accent hover:underline">
                {project.url.replace(/^https?:\/\//, '')}
                <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
              </a>
            ) : (
              <span className="font-mono text-xs">{project.url.replace(/^https?:\/\//, '')}</span>
            )}
            <span className="inline-flex items-center gap-1.5">
              <GitBranch className="h-3.5 w-3.5" aria-hidden />
              {repoLabel(project.repoUrl)} · {project.branch}
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-4">
          <Alert tone="warn" title="Live updates paused">
            {error.message}
          </Alert>
        </div>
      )}

      <div className="mt-6 border-b border-line">
        <div role="tablist" aria-label="Project sections" className="-mb-px flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t.id}
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={tab === t.id}
              aria-controls={`panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={cx(
                'whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
                tab === t.id ? 'border-accent text-ink' : 'border-transparent text-muted hover:text-ink',
              )}
            >
              {t.label}
              {t.id === 'env' && data.env.length > 0 && <span className="ml-1.5 rounded-full bg-raised px-1.5 py-0.5 text-xs text-muted">{data.env.length}</span>}
            </button>
          ))}
        </div>
      </div>

      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="pt-6">
        {tab === 'env' && <EnvEditor projectId={project.id} env={data.env} deployed={project.status !== 'idle'} onChange={refresh} />}
        {tab === 'settings' && <SettingsPanel project={project} onChange={refresh} />}
      </div>
    </div>
  );
}
