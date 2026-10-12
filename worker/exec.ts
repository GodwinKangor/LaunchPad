import { spawn } from 'node:child_process';

const MAX_CAPTURE = 256 * 1024;

export class CommandError extends Error {
  constructor(
    message: string,
    public readonly exitCode: number | null,
    public readonly stderr: string,
    public readonly timedOut: boolean,
  ) {
    super(message);
    this.name = 'CommandError';
  }

  /** Last non-empty line of stderr: usually the actual complaint. */
  get lastLine(): string {
    return this.stderr.trim().split('\n').pop()?.trim() ?? '';
  }
}

export interface ExecOptions {
  cwd?: string;
  /** Extra variables on top of the minimal base environment. */
  env?: Record<string, string>;
  timeoutMs?: number;
  onLine?: (line: string) => void;
}

/**
 * Child processes get only what they need. In particular the worker's own
 * secrets (DATABASE_URL, REDIS_URL, ENV_ENCRYPTION_KEY) never reach git or docker.
 */
export function baseEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const key of ['PATH', 'HOME', 'LANG', 'DOCKER_HOST', 'DOCKER_CONFIG', 'DOCKER_CONTEXT']) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

/**
 * Runs a program with an argument array. There is no shell anywhere in this
 * path, so user-supplied values can never be interpreted as shell syntax.
 */
export function exec(command: string, args: string[], options: ExecOptions = {}): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...baseEnv(), ...options.env } as NodeJS.ProcessEnv,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let killTimer: NodeJS.Timeout | undefined;
    const timer = options.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          child.kill('SIGTERM');
          killTimer = setTimeout(() => child.kill('SIGKILL'), 5_000);
        }, options.timeoutMs)
      : undefined;

    const lines = (emit: (chunk: string) => void) => {
      let pending = '';
      return {
        push(chunk: Buffer) {
          const text = chunk.toString('utf8');
          emit(text);
          if (!options.onLine) return;
          const parts = (pending + text).split(/\r?\n|\r/);
          pending = parts.pop() ?? '';
          for (const line of parts) options.onLine(line);
        },
        end() {
          if (pending && options.onLine) options.onLine(pending);
        },
      };
    };
    const out = lines((text) => (stdout = (stdout + text).slice(-MAX_CAPTURE)));
    const err = lines((text) => (stderr = (stderr + text).slice(-MAX_CAPTURE)));
    child.stdout.on('data', out.push);
    child.stderr.on('data', err.push);

    const finish = (error: Error | null, code: number | null) => {
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      out.end();
      err.end();
      if (timedOut) reject(new CommandError(`${command} timed out`, code, stderr, true));
      else if (error) reject(new CommandError(`${command} could not be started: ${error.message}`, null, stderr, false));
      else if (code !== 0) reject(new CommandError(`${command} exited with code ${code}`, code, stderr, false));
      else resolve({ stdout, stderr });
    };
    child.once('error', (error) => finish(error, null));
    child.once('close', (code) => finish(null, code));
  });
}
