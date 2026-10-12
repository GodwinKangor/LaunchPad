import type { Queue } from 'bullmq';
import { JOB_OPTIONS, jobKey, type Job } from '../lib/queue';
import type { Store } from '../lib/store/types';
import { ACTIVE_STATES } from '../lib/types';

/** Marks work as failed when the queue has given up on it, releasing the project's work slot. */
export async function abandon(store: Store, job: Job, reason: string): Promise<void> {
  const error = `The worker could not finish this job: ${reason}`.slice(0, 2_000);
  await store.transitionDeployment(job.id, ACTIVE_STATES, 'failed', { error, finishedAt: new Date() });
}

/**
 * Reconciles the database with the queue after a restart. Work the database
 * says is in flight must have a live job: missing jobs are re-queued (running
 * one twice is safe), and jobs the queue already gave up on are closed out.
 */
export async function recoverJobs(store: Store, queue: Queue): Promise<void> {
  const jobs: Job[] = (await store.listActiveDeployments()).map((d) => ({ type: 'deployment', id: d.id }));
  for (const job of jobs) {
    const existing = await queue.getJob(jobKey(job));
    if (!existing) {
      await queue.add(job.type, job, { jobId: jobKey(job), ...JOB_OPTIONS });
      console.log(`[recover] re-queued ${jobKey(job)}`);
      continue;
    }
    const state = await existing.getState();
    if (state === 'failed' || state === 'completed') {
      await abandon(store, job, existing.failedReason || 'it was interrupted');
      console.log(`[recover] closed out ${jobKey(job)} (queue state: ${state})`);
    }
  }
}
