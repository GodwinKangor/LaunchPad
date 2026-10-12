'use client';

import { useState, type FormEvent } from 'react';
import type { ProjectDTO } from '@/lib/dto';
import { ApiError, api } from './api-client';
import { Alert, Button, Card, Field } from './ui';

export function SettingsPanel({ project, onChange }: { project: ProjectDTO; onChange: () => Promise<void> }) {
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    setLoading(true);
    setError(null);
    setFields({});
    setSaved(false);
    try {
      await api(`/api/projects/${project.id}`, { method: 'PATCH', body });
      await onChange();
      setSaved(true);
    } catch (err) {
      const apiError = err instanceof ApiError ? err : null;
      setFields(apiError?.fields ?? {});
      if (!apiError || Object.keys(apiError.fields).length === 0) setError(apiError?.message ?? 'Could not save settings.');
    }
    setLoading(false);
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <Card className="space-y-5 p-5">
        <div>
          <h2 className="text-sm font-semibold">Source and runtime</h2>
          <p className="mt-1 text-sm text-muted">Changes take effect on the next deployment.</p>
        </div>
        {error && <Alert>{error}</Alert>}
        {saved && <Alert tone="ok" title="Settings saved" />}
        <Field label="GitHub repository" name="repoUrl" type="url" defaultValue={project.repoUrl} mono required spellCheck={false} autoComplete="off" error={fields.repoUrl} />
        <div className="grid gap-5 sm:grid-cols-2">
          <Field label="Branch" name="branch" defaultValue={project.branch} mono required spellCheck={false} autoComplete="off" error={fields.branch} />
          <Field label="Application port" name="port" type="number" min={1} max={65535} defaultValue={project.port} mono required error={fields.port} />
          <Field label="Root directory" name="rootDirectory" defaultValue={project.rootDirectory} placeholder="(repository root)" mono spellCheck={false} autoComplete="off" error={fields.rootDirectory} hint="Folder that contains the Dockerfile." />
          <Field label="Health check path" name="healthPath" defaultValue={project.healthPath} mono spellCheck={false} autoComplete="off" error={fields.healthPath} hint="Must answer with a 2xx or 3xx status." />
        </div>
        <div className="flex justify-end">
          <Button type="submit" variant="primary" loading={loading}>
            Save settings
          </Button>
        </div>
      </Card>
    </form>
  );
}
