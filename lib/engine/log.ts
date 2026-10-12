import { errorMessage } from '../errors';
import type { Store } from '../store/types';

const MAX_LINE_LENGTH = 2_000;
const ANSI = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f]/g;

/** Replaces every occurrence of a secret value. Short values are skipped: masking "1" or "true" would shred the log. */
export function createRedactor(secrets: string[]): (text: string) => string {
  const needles = [...new Set(secrets.flatMap((s) => [s, ...s.split('\n')]).map((s) => s.trim()))]
    .filter((s) => s.length >= 6)
    .sort((a, b) => b.length - a.length);
  if (needles.length === 0) return (text) => text;
  return (text) => needles.reduce((out, needle) => out.split(needle).join('[redacted]'), text);
}

export function sanitizeLine(line: string): string {
  const clean = line.replace(ANSI, '').replace(CONTROL, '');
  return clean.length > MAX_LINE_LENGTH ? `${clean.slice(0, MAX_LINE_LENGTH)}… [line truncated]` : clean;
}

export interface DeploymentLog {
  log(line: string): void;
  flush(): Promise<void>;
}

/**
 * Buffers build output and writes it in batches. Lines are sanitised, redacted
 * and capped so an untrusted build cannot flood the database or echo secrets.
 */
export function createDeploymentLog(store: Store, deploymentId: string, options: { redact: (text: string) => string; maxLines: number }): DeploymentLog {
  let buffer: string[] = [];
  let written = 0;
  let capped = false;
  let timer: NodeJS.Timeout | undefined;
  let chain: Promise<void> = Promise.resolve();

  const flush = (): Promise<void> => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    const batch = buffer;
    buffer = [];
    if (batch.length > 0) {
      chain = chain
        .then(() => store.appendLogs(deploymentId, batch))
        .catch((err) => console.error(`[engine] could not store log lines for ${deploymentId}: ${errorMessage(err)}`));
    }
    return chain;
  };

  return {
    log(text: string) {
      for (const raw of text.split(/\r?\n|\r/)) {
        if (capped) return;
        if (written >= options.maxLines) {
          capped = true;
          buffer.push(`[log truncated after ${options.maxLines} lines]`);
          break;
        }
        buffer.push(options.redact(sanitizeLine(raw)));
        written++;
      }
      if (buffer.length >= 100) void flush();
      else timer ??= setTimeout(() => void flush(), 250);
    },
    flush,
  };
}
