/** Queue names and job shapes shared by the dashboard (producer) and the worker (consumer). */

export const JOB_QUEUE = 'launchpad-jobs';

export type Job = { type: 'deployment'; id: string };

/** Deterministic ids make enqueueing idempotent: BullMQ ignores a second add with the same id. */
export function jobKey(job: Job): string {
  return `${job.type}-${job.id}`;
}

export const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 5_000 },
  removeOnComplete: { age: 3_600, count: 1_000 },
  removeOnFail: { age: 86_400, count: 1_000 },
} as const;
