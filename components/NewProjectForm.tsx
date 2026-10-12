'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import type { ProjectDTO } from '@/lib/dto';
import { ApiError, api } from './api-client';
import { Alert, Button, Card, Field, buttonClass } from './ui';

export function NewProjectForm({ urlPattern, demo }: { urlPattern: string; demo: boolean }) {
  const router = useRouter();
  const [name, setName] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    setLoading(true);
    setError(null);
    setFields({});
    try {
      const { project } = await api<{ project: ProjectDTO }>('/api/projects', { body: form });
      router.push(`/projects/${project.id}`);
    } catch (err) {
      const apiError = err instanceof ApiError ? err : null;
      setFields(apiError?.fields ?? {});
      if (!apiError || Object.keys(apiError.fields).length === 0) setError(apiError?.message ?? 'Could not create the project.');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Card className="space-y-5 p-6">
        {error && <Alert>{error}</Alert>}
        <Field
          label="Project name"
          name="name"
          value={name}
          onChange={(e) => setName(e.target.value.toLowerCase())}
          placeholder="my-app"
          autoFocus
          required
          mono
          autoComplete="off"
          spellCheck={false}
          error={fields.name}
          hint={
            <>
              Becomes the address <span className="font-mono text-ink">{urlPattern.replace('{name}', name || 'my-app')}</span>. It cannot be changed later.
            </>
          }
        />
        <Field
          label="GitHub repository"
          name="repoUrl"
          type="url"
          placeholder="https://github.com/you/your-app"
          required
          mono
          autoComplete="off"
          spellCheck={false}
          error={fields.repoUrl}
          hint="A public repository you control, with a Dockerfile."
        />
        <div className="grid gap-5 sm:grid-cols-2">
          <Field
            label="Branch"
            name="branch"
            defaultValue="main"
            required
            mono
            autoComplete="off"
            spellCheck={false}
            error={fields.branch}
            hint={demo ? 'Demo: a branch containing "fail-build" or "fail-health" simulates that failure.' : undefined}
          />
          <Field label="Application port" name="port" type="number" min={1} max={65535} defaultValue={3000} required mono error={fields.port} hint="The port your app listens on inside its container." />
        </div>
        <details className="group rounded-lg border border-line px-4 py-3">
          <summary className="cursor-pointer select-none text-sm font-medium text-muted hover:text-ink">Advanced</summary>
          <div className="mt-4 grid gap-5 sm:grid-cols-2">
            <Field label="Root directory" name="rootDirectory" placeholder="(repository root)" mono autoComplete="off" spellCheck={false} error={fields.rootDirectory} hint="Folder that contains the Dockerfile." />
            <Field label="Health check path" name="healthPath" defaultValue="/" mono autoComplete="off" spellCheck={false} error={fields.healthPath} hint="Must answer with a 2xx or 3xx status." />
          </div>
        </details>
      </Card>
      <div className="mt-5 flex items-center justify-end gap-3">
        <Link href="/projects" className={buttonClass('ghost')}>
          Cancel
        </Link>
        <Button type="submit" variant="primary" loading={loading}>
          Create project
        </Button>
      </div>
    </form>
  );
}
