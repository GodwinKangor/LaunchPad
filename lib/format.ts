/** Small formatting helpers shared by server and client code. */

export function shortSha(sha: string | null | undefined): string {
  return sha ? sha.slice(0, 7) : '—';
}

export function formatDuration(ms: number): string {
  const seconds = Math.max(0, Math.round(ms / 1000));
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function relativeTime(iso: string | Date, now: number = Date.now()): string {
  const then = typeof iso === 'string' ? Date.parse(iso) : iso.getTime();
  const seconds = Math.round((now - then) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(then).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function repoLabel(repoUrl: string): string {
  return repoUrl.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '');
}
