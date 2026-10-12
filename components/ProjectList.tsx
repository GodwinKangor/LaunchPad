'use client';

import { ArrowUpRight, GitBranch, Plus, Rocket } from 'lucide-react';
import Link from 'next/link';
import type { ProjectSummaryDTO } from '@/lib/dto';
import { relativeTime, repoLabel, shortSha } from '@/lib/format';
import { isActiveState } from '@/lib/types';
import { useNow, usePoll } from './hooks';
import { DeploymentBadge, ProjectBadge } from './StatusBadge';
import { Alert, Button, Card, EmptyState, Spinner, buttonClass } from './ui';

export function ProjectList() {
  const { data, error, loading, refresh } = usePoll<{ projects: ProjectSummaryDTO[] }>('/api/projects', 5_000);
  const now = useNow();

  return (
    <div>
      <div className="mb-6 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="mt-1 text-sm text-muted">Applications deployed from your GitHub repositories.</p>
        </div>
        <Link href="/projects/new" className={buttonClass('primary')}>
          <Plus className="h-4 w-4" aria-hidden />
          New project
        </Link>
      </div>

      {error && (
        <div className="mb-4">
          <Alert title="Could not load projects" action={<Button size="sm" onClick={() => void refresh()}>Retry</Button>}>
            {error.message}
          </Alert>
        </div>
      )}

      {loading ? (
        <Spinner label="Loading projects" />
      ) : data && data.projects.length === 0 ? (
        <EmptyState
          icon={<Rocket className="h-5 w-5" aria-hidden />}
          title="No projects yet"
          action={
            <Link href="/projects/new" className={buttonClass('primary')}>
              <Plus className="h-4 w-4" aria-hidden />
              Create your first project
            </Link>
          }
        >
          Point LaunchPad at a GitHub repository with a Dockerfile and it will build, run and route it for you.
        </EmptyState>
      ) : data ? (
        <ul className="grid gap-4 md:grid-cols-2">
          {data.projects.map((project) => {
            const latest = project.latestDeployment;
            return (
              <li key={project.id}>
                <Card className="group relative h-full p-5 transition-colors hover:border-muted/50">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="min-w-0 truncate text-base font-semibold">
                      <Link href={`/projects/${project.id}`} className="after:absolute after:inset-0 after:rounded-xl">
                        {project.name}
                      </Link>
                    </h2>
                    <ProjectBadge status={project.status} deploying={latest !== null && isActiveState(latest.state)} />
                  </div>
                  <p className="mt-1 flex items-center gap-1.5 truncate text-sm text-muted">
                    <GitBranch className="h-3.5 w-3.5 shrink-0" aria-hidden />
                    <span className="truncate">
                      {repoLabel(project.repoUrl)} · {project.branch}
                    </span>
                  </p>
                  <div className="mt-4 flex items-center justify-between gap-3 border-t border-line pt-4 text-sm">
                    {latest ? (
                      <div className="flex min-w-0 items-center gap-2">
                        <DeploymentBadge state={latest.state} />
                        <span className="truncate text-muted">
                          <span className="font-mono text-xs">{shortSha(latest.commitSha)}</span> · {relativeTime(latest.createdAt, now)}
                        </span>
                      </div>
                    ) : (
                      <span className="text-muted">No deployments yet</span>
                    )}
                    {project.status === 'running' && (
                      <a href={project.url} target="_blank" rel="noreferrer" className="relative z-10 inline-flex shrink-0 items-center gap-1 text-xs font-medium text-accent hover:underline">
                        Open
                        <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
                      </a>
                    )}
                  </div>
                </Card>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
