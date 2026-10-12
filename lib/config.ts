/**
 * Environment configuration. Parsed lazily so `next build` and unit tests do
 * not need a populated environment, and split by role so the worker never
 * needs dashboard credentials.
 */

const EXAMPLE_ENCRYPTION_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

/** Demo mode is usable with zero configuration; these values are public and insecure by design. */
export const DEMO_DEFAULTS = {
  ownerEmail: 'owner@launchpad.local',
  ownerPassword: 'launchpad-demo',
  sessionSecret: 'demo-mode-insecure-session-secret-not-for-real-use',
  encryptionKey: 'de'.repeat(32),
} as const;

export class ConfigError extends Error {
  constructor(message: string) {
    super(`Configuration error: ${message}`);
    this.name = 'ConfigError';
  }
}

type Env = Record<string, string | undefined>;

export function isDemoMode(env: Env = process.env): boolean {
  return env.DEMO_MODE === 'true';
}

function int(env: Env, name: string, fallback: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new ConfigError(`${name} must be an integer between ${min} and ${max}`);
  }
  return value;
}

export interface BaseConfig {
  demo: boolean;
  databaseUrl: string;
  redisUrl: string;
  /** 32-byte key, hex encoded, used to encrypt stored environment variable values. */
  encryptionKey: string;
  /** Lowercased GitHub owners whose repositories may be deployed. */
  allowedOwners: string[];
  appDomain: string;
  appScheme: 'http' | 'https';
  /** Port shown in app URLs when the proxy is not on 80/443 (local development). */
  appPublicPort: number | null;
}

export function loadBaseConfig(env: Env = process.env): BaseConfig {
  const demo = isDemoMode(env);
  const encryptionKey = env.ENV_ENCRYPTION_KEY || (demo ? DEMO_DEFAULTS.encryptionKey : '');
  if (!/^[0-9a-fA-F]{64}$/.test(encryptionKey)) {
    throw new ConfigError('ENV_ENCRYPTION_KEY must be 64 hex characters (openssl rand -hex 32)');
  }
  if (!demo && encryptionKey.toLowerCase() === EXAMPLE_ENCRYPTION_KEY) {
    throw new ConfigError('ENV_ENCRYPTION_KEY is still the example value; generate your own');
  }
  const allowedOwners = (env.GITHUB_ALLOWED_OWNERS ?? '')
    .split(',')
    .map((o) => o.trim().toLowerCase())
    .filter(Boolean);
  if (!demo) {
    if (!env.DATABASE_URL) throw new ConfigError('DATABASE_URL is required');
    if (!env.REDIS_URL) throw new ConfigError('REDIS_URL is required');
    if (allowedOwners.length === 0 || allowedOwners.includes('your-github-username')) {
      throw new ConfigError('GITHUB_ALLOWED_OWNERS must list the GitHub accounts you control');
    }
  }
  const appScheme = env.APP_SCHEME === 'https' ? 'https' : 'http';
  const appDomain = (env.APP_DOMAIN || 'localhost').toLowerCase();
  if (!/^[a-z0-9]([a-z0-9.-]*[a-z0-9])?$/.test(appDomain)) throw new ConfigError('APP_DOMAIN is not a valid hostname');
  const port = int(env, 'APP_PUBLIC_PORT', 0, 0, 65535);
  return {
    demo,
    databaseUrl: env.DATABASE_URL ?? '',
    redisUrl: env.REDIS_URL ?? '',
    encryptionKey,
    allowedOwners,
    appDomain,
    appScheme,
    appPublicPort: port === 0 || port === (appScheme === 'https' ? 443 : 80) ? null : port,
  };
}

export interface AuthConfig {
  ownerEmail: string;
  ownerPassword: string;
  sessionSecret: string;
  secureCookies: boolean;
}

export function loadAuthConfig(env: Env = process.env): AuthConfig {
  const demo = isDemoMode(env);
  const ownerEmail = (env.OWNER_EMAIL || (demo ? DEMO_DEFAULTS.ownerEmail : '')).trim().toLowerCase();
  const ownerPassword = env.OWNER_PASSWORD || (demo ? DEMO_DEFAULTS.ownerPassword : '');
  const sessionSecret = env.SESSION_SECRET || (demo ? DEMO_DEFAULTS.sessionSecret : '');
  if (!ownerEmail) throw new ConfigError('OWNER_EMAIL is required');
  if (!demo) {
    if (ownerPassword.length < 12 || ownerPassword === 'change-this-owner-password') {
      throw new ConfigError('OWNER_PASSWORD must be set to your own value of at least 12 characters');
    }
    if (sessionSecret.length < 32 || sessionSecret.startsWith('replace-with')) {
      throw new ConfigError('SESSION_SECRET must be at least 32 random characters (openssl rand -hex 32)');
    }
  }
  return {
    ownerEmail,
    ownerPassword,
    sessionSecret,
    secureCookies: (env.APP_URL ?? '').startsWith('https://'),
  };
}

export interface WorkerConfig {
  appNetwork: string;
  caddyContainer: string;
  routesDir: string;
  buildDir: string;
  cloneTimeoutMs: number;
  buildTimeoutMs: number;
  healthTimeoutMs: number;
  retainedReleases: number;
  maxBuildLogLines: number;
  concurrency: number;
  reconcileIntervalMs: number;
  limits: { memoryMb: number; cpus: string; pids: number; logMaxSize: string; logMaxFiles: number };
}

export function loadWorkerConfig(env: Env = process.env): WorkerConfig {
  const cpus = env.APP_CPUS || '1';
  if (!/^\d+(\.\d+)?$/.test(cpus)) throw new ConfigError('APP_CPUS must be a number such as 0.5');
  const logMaxSize = env.APP_LOG_MAX_SIZE || '10m';
  if (!/^\d+[kmg]$/.test(logMaxSize)) throw new ConfigError('APP_LOG_MAX_SIZE must look like 10m');
  const names = { appNetwork: env.APP_NETWORK || 'launchpad_apps', caddyContainer: env.CADDY_CONTAINER || 'launchpad-caddy' };
  for (const [key, value] of Object.entries(names)) {
    if (!/^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(value)) throw new ConfigError(`${key} is not a valid Docker name`);
  }
  return {
    ...names,
    routesDir: env.ROUTES_DIR || '/routes',
    buildDir: env.BUILD_DIR || '/tmp/launchpad-builds',
    cloneTimeoutMs: int(env, 'CLONE_TIMEOUT_MS', 120_000, 1_000, 3_600_000),
    buildTimeoutMs: int(env, 'BUILD_TIMEOUT_MS', 600_000, 1_000, 7_200_000),
    healthTimeoutMs: int(env, 'HEALTH_TIMEOUT_MS', 60_000, 1_000, 900_000),
    retainedReleases: int(env, 'RETAINED_RELEASES', 3, 1, 50),
    maxBuildLogLines: int(env, 'BUILD_LOG_MAX_LINES', 5_000, 100, 100_000),
    concurrency: int(env, 'WORKER_CONCURRENCY', 2, 1, 16),
    reconcileIntervalMs: int(env, 'RECONCILE_INTERVAL_MS', 60_000, 5_000, 3_600_000),
    limits: {
      memoryMb: int(env, 'APP_MEMORY_MB', 512, 16, 1_048_576),
      cpus,
      pids: int(env, 'APP_PIDS_LIMIT', 256, 8, 65_536),
      logMaxSize,
      logMaxFiles: int(env, 'APP_LOG_MAX_FILES', 3, 1, 100),
    },
  };
}

let cachedBase: BaseConfig | undefined;
let cachedAuth: AuthConfig | undefined;

export function baseConfig(): BaseConfig {
  return (cachedBase ??= loadBaseConfig());
}

export function authConfig(): AuthConfig {
  return (cachedAuth ??= loadAuthConfig());
}

/** Public URL of a deployed project. In demo mode nothing is deployed, so link to a labelled placeholder page. */
export function projectUrl(name: string, config: Pick<BaseConfig, 'demo' | 'appDomain' | 'appScheme' | 'appPublicPort'>): string {
  if (config.demo) return `/demo-app/${name}`;
  const port = config.appPublicPort ? `:${config.appPublicPort}` : '';
  return `${config.appScheme}://${name}.${config.appDomain}${port}`;
}
