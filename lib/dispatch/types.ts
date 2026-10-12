import type { Job } from '../queue';

/** How the dashboard hands work to whatever executes it. It has no other path to Docker. */
export interface Dispatcher {
  enqueue(job: Job): Promise<void>;
}
