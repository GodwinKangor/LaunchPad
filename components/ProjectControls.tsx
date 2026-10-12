'use client';

import { Rocket } from 'lucide-react';
import { useState } from 'react';
import type { ProjectDetailDTO } from '@/lib/dto';
import { ApiError, api } from './api-client';
import { Button } from './ui';

type Pending = 'deploy' | null;

export function ProjectControls({ detail, onChange, onError }: { detail: ProjectDetailDTO; onChange: () => Promise<void>; onError: (message: string | null) => void }) {
  const [pending, setPending] = useState<Pending>(null);
  const { project, busy } = detail;

  async function act(kind: Exclude<Pending, null>, path: string, body?: unknown) {
    setPending(kind);
    onError(null);
    try {
      await api(`/api/projects/${project.id}/${path}`, { method: 'POST', body });
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'The action failed.');
    }
    await onChange();
    setPending(null);
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="primary" loading={pending === 'deploy'} disabled={busy} icon={<Rocket className="h-4 w-4" aria-hidden />} onClick={() => act('deploy', 'deploy')}>
        {project.status === 'idle' ? 'Deploy' : 'Redeploy'}
      </Button>
    </div>
  );
}
