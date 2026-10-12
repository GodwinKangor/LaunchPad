import type { HealthResult, LogFn } from './types';

export interface HealthProbe {
  /** HTTP status of one request to the health path, or null when the connection failed. */
  request(): Promise<number | null>;
  /** Whether the container process is still alive. */
  state(): Promise<{ running: boolean; detail?: string }>;
}

export interface HealthOptions {
  timeoutMs: number;
  intervalMs?: number;
  /** Consecutive good responses required, so one lucky request during a crash loop does not count. */
  successes?: number;
  path: string;
  port: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

const isHealthy = (status: number | null) => status !== null && status >= 200 && status < 400;

/**
 * Polls a freshly started container until it answers the health path with a
 * 2xx/3xx, it exits, or the deadline passes. Pure logic: the caller supplies
 * how to make a request and inspect the container.
 */
export async function pollHealth(probe: HealthProbe, options: HealthOptions, log: LogFn = () => {}): Promise<HealthResult> {
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const now = options.now ?? Date.now;
  const interval = options.intervalMs ?? 1_000;
  const needed = options.successes ?? 2;
  const deadline = now() + options.timeoutMs;
  let streak = 0;
  let lastStatus: number | null = null;
  let reported: number | null | undefined;

  for (;;) {
    const state = await probe.state();
    if (!state.running) {
      return { ok: false, reason: `the application exited before becoming healthy${state.detail ? ` (${state.detail})` : ''}` };
    }
    lastStatus = await probe.request();
    if (isHealthy(lastStatus)) {
      streak++;
      if (streak >= needed) {
        log(`GET ${options.path} -> ${lastStatus}`);
        return { ok: true };
      }
    } else {
      streak = 0;
      if (lastStatus !== reported) {
        log(lastStatus === null ? `No response on port ${options.port} yet` : `GET ${options.path} -> ${lastStatus}`);
        reported = lastStatus;
      }
    }
    if (now() >= deadline) break;
    await sleep(streak > 0 ? Math.min(interval, 250) : interval);
  }

  const seconds = Math.round(options.timeoutMs / 1000);
  return lastStatus === null
    ? { ok: false, reason: `nothing answered on port ${options.port} within ${seconds}s. Make sure the app listens on 0.0.0.0:${options.port}.` }
    : { ok: false, reason: `GET ${options.path} returned HTTP ${lastStatus} for ${seconds}s. The health check needs a 2xx or 3xx response; adjust the health check path in Settings if needed.` };
}
