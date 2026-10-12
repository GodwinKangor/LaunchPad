import type { ProjectLocks, Release } from './types';

/** Per-process project locks for demo mode and tests. The worker uses Redis-backed locks instead. */
export class MemoryLocks implements ProjectLocks {
  private held = new Set<string>();

  async acquire(projectId: string): Promise<Release | null> {
    if (this.held.has(projectId)) return null;
    this.held.add(projectId);
    return async () => {
      this.held.delete(projectId);
    };
  }
}
