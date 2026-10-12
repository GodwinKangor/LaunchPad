import type { DeploymentState, ProjectStatus } from '@/lib/types';
import { cx } from './ui';

type Tone = 'ok' | 'bad' | 'info' | 'warn' | 'muted';

const TONES: Record<Tone, { text: string; dot: string }> = {
  ok: { text: 'text-ok border-ok/30 bg-ok/10', dot: 'bg-ok' },
  bad: { text: 'text-bad border-bad/30 bg-bad/10', dot: 'bg-bad' },
  info: { text: 'text-info border-info/30 bg-info/10', dot: 'bg-info' },
  warn: { text: 'text-warn border-warn/30 bg-warn/10', dot: 'bg-warn' },
  muted: { text: 'text-muted border-line bg-raised', dot: 'bg-muted' },
};

export function Badge({ tone, label, pulse }: { tone: Tone; label: string; pulse?: boolean }) {
  return (
    <span className={cx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-0.5 text-xs font-medium', TONES[tone].text)}>
      <span className={cx('h-1.5 w-1.5 rounded-full', TONES[tone].dot, pulse && 'animate-pulse')} aria-hidden />
      {label}
    </span>
  );
}

const DEPLOYMENT: Record<DeploymentState, { tone: Tone; label: string; pulse?: boolean }> = {
  queued: { tone: 'muted', label: 'Queued', pulse: true },
  cloning: { tone: 'info', label: 'Cloning', pulse: true },
  building: { tone: 'info', label: 'Building', pulse: true },
  starting: { tone: 'info', label: 'Starting', pulse: true },
  healthy: { tone: 'ok', label: 'Healthy' },
  failed: { tone: 'bad', label: 'Failed' },
};

export function DeploymentBadge({ state }: { state: DeploymentState }) {
  return <Badge {...DEPLOYMENT[state]} />;
}

const PROJECT: Record<ProjectStatus, { tone: Tone; label: string; pulse?: boolean }> = {
  idle: { tone: 'muted', label: 'Not deployed' },
  running: { tone: 'ok', label: 'Running' },
  stopped: { tone: 'muted', label: 'Stopped' },
  crashed: { tone: 'bad', label: 'Crashed' },
  deleting: { tone: 'warn', label: 'Deleting', pulse: true },
};

/** A project that is mid-deployment shows that instead of its resting status. */
export function ProjectBadge({ status, deploying }: { status: ProjectStatus; deploying?: boolean }) {
  if (deploying && status !== 'deleting') return <Badge tone="info" label="Deploying" pulse />;
  return <Badge {...PROJECT[status]} />;
}
