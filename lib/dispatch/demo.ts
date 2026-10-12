import { errorMessage } from '../errors';
import { runDeployment } from '../engine/deploy';
import type { EngineDeps, RunResult } from '../engine/types';
import type { Job } from '../queue';
import type { Dispatcher } from './types';

/**
 * DEMO MODE ONLY. Runs jobs inside the dashboard process against the
 * simulated driver. Real deployments always go through Redis to the worker.
 */
export class InProcessDispatcher implements Dispatcher {
  constructor(private readonly deps: EngineDeps) {}

  async enqueue(job: Job): Promise<void> {
    setTimeout(() => void this.run(job, 0), 300);
  }

  private execute(job: Job): Promise<RunResult> {
    return runDeployment(this.deps, job.id);
  }

  private async run(job: Job, attempt: number): Promise<void> {
    try {
      const result = await this.execute(job);
      if (result === 'locked' && attempt < 600) setTimeout(() => void this.run(job, attempt + 1), 500);
    } catch (err) {
      console.error(`[demo] job ${job.type}/${job.id} crashed: ${errorMessage(err)}`);
    }
  }

  /** Picks up work that was in flight when the dashboard last stopped. */
  async recover(): Promise<void> {
    for (const deployment of await this.deps.store.listActiveDeployments()) await this.enqueue({ type: 'deployment', id: deployment.id });
  }
}
