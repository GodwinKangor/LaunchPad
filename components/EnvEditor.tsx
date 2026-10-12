'use client';

import { KeyRound, Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { EnvVarDTO } from '@/lib/dto';
import { relativeTime } from '@/lib/format';
import { ApiError, api } from './api-client';
import { useNow } from './hooks';
import { Alert, Button, Card, EmptyState, Field } from './ui';

export function EnvEditor({ projectId, env, deployed, onChange }: { projectId: string; env: EnvVarDTO[]; deployed: boolean; onChange: () => Promise<void> }) {
  const now = useNow();
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  async function save(body: { set?: Record<string, string>; remove?: string[] }) {
    setError(null);
    try {
      await api(`/api/projects/${projectId}/env`, { method: 'PUT', body });
      setDirty(true);
      await onChange();
      return true;
    } catch (err) {
      const apiError = err instanceof ApiError ? err : null;
      setError(Object.values(apiError?.fields ?? {})[0] ?? apiError?.message ?? 'Could not save.');
      return false;
    }
  }

  async function onAdd(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    if (await save({ set: { [key.trim()]: value } })) {
      setKey('');
      setValue('');
    }
    setSaving(false);
  }

  const replacing = env.some((e) => e.key === key.trim());

  return (
    <div className="space-y-5">
      {dirty && deployed && (
        <Alert tone="info" title="Saved">
          Running containers keep their old values. Redeploy or restart to apply the change.
        </Alert>
      )}
      <Card className="p-5">
        <h2 className="text-sm font-semibold">Add or replace a variable</h2>
        <p className="mt-1 text-sm text-muted">Values are encrypted at rest and cannot be read back, only replaced.</p>
        <form onSubmit={onAdd} className="mt-4 grid gap-4 sm:grid-cols-[1fr_1.5fr_auto] sm:items-start" noValidate>
          <Field label="Key" name="env-key" value={key} onChange={(e) => setKey(e.target.value)} placeholder="DATABASE_URL" mono autoComplete="off" spellCheck={false} required />
          <Field label="Value" name="env-value" type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder="••••••••" mono autoComplete="new-password" spellCheck={false} />
          <Button type="submit" variant="primary" loading={saving} disabled={!key.trim()} icon={<Plus className="h-4 w-4" aria-hidden />} className="sm:mt-[26px]">
            {replacing ? 'Replace' : 'Add'}
          </Button>
        </form>
        {error && (
          <p className="mt-3 text-sm text-bad" role="alert">
            {error}
          </p>
        )}
      </Card>

      {env.length === 0 ? (
        <EmptyState icon={<KeyRound className="h-5 w-5" aria-hidden />} title="No environment variables">
          Add configuration and secrets your application reads at runtime. <span className="font-mono">PORT</span> is set for you.
        </EmptyState>
      ) : (
        <Card>
          <ul className="divide-y divide-line">
            {env.map((variable) => (
              <li key={variable.key} className="flex items-center justify-between gap-4 px-5 py-3">
                <div className="min-w-0">
                  <p className="truncate font-mono text-sm">{variable.key}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    <span aria-label="Value hidden">••••••••</span> · updated {relativeTime(variable.updatedAt, now)}
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  loading={removing === variable.key}
                  icon={<Trash2 className="h-3.5 w-3.5" aria-hidden />}
                  aria-label={`Remove ${variable.key}`}
                  onClick={async () => {
                    setRemoving(variable.key);
                    await save({ remove: [variable.key] });
                    setRemoving(null);
                  }}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
