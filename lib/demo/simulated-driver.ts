import { createHash } from 'node:crypto';
import { DeployError, type ContainerDriver, type ContainerInfo, type HealthResult, type LogFn, type RunSpec } from '../engine/types';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * DEMO MODE ONLY. Pretends to clone, build and run so the dashboard can be
 * explored without Docker. Nothing here executes a process or opens a socket.
 *
 * A branch name containing "fail-build" or "fail-health" triggers that
 * failure, to make the error paths visible.
 */
export class SimulatedDriver implements ContainerDriver {
  private containers = new Map<string, ContainerInfo & { startedAt: number }>();
  private branches = new Map<string, string>();
  private images = new Map<string, string>();

  constructor(private readonly speed = 1) {}

  private wait(ms: number) {
    return sleep(ms * this.speed);
  }

  async checkout(input: { deploymentId: string; repoUrl: string; branch: string }, log: LogFn): Promise<{ commitSha: string }> {
    this.branches.set(input.deploymentId, input.branch);
    await this.wait(900);
    log('[simulated] remote: Enumerating objects: 42, done.');
    await this.wait(500);
    return { commitSha: createHash('sha1').update(`${input.repoUrl}#${input.branch}#${input.deploymentId}`).digest('hex') };
  }

  async build(input: { deploymentId: string; image: string }, log: LogFn): Promise<void> {
    const branch = this.branches.get(input.deploymentId) ?? '';
    const steps = [
      '#1 [internal] load build definition from Dockerfile',
      '#2 [internal] load metadata for docker.io/library/node:22-alpine',
      '#3 [1/4] FROM docker.io/library/node:22-alpine',
      '#4 [2/4] WORKDIR /app',
      '#5 [3/4] COPY package.json ./',
      '#6 [4/4] COPY . .',
    ];
    for (const step of steps) {
      log(`[simulated] ${step}`);
      await this.wait(450);
    }
    if (branch.includes('fail-build')) {
      log('[simulated] #6 ERROR: "/app/server.js": not found');
      throw new DeployError('The Docker build failed (simulated because the branch name contains "fail-build").');
    }
    log('[simulated] #7 exporting to image');
    await this.wait(600);
    this.images.set(input.image, branch);
  }

  async cleanupWorkspace(deploymentId: string): Promise<void> {
    this.branches.delete(deploymentId);
  }

  async imageExists(image: string): Promise<boolean> {
    return this.images.has(image);
  }

  async removeImage(image: string): Promise<void> {
    this.images.delete(image);
  }

  async run(spec: RunSpec): Promise<void> {
    await this.wait(500);
    this.containers.set(spec.name, { name: spec.name, projectId: spec.projectId, deploymentId: spec.deploymentId, running: true, startedAt: Date.now() });
  }

  async waitHealthy(input: { name: string; path: string }, log: LogFn): Promise<HealthResult> {
    await this.wait(900);
    const image = [...this.images.entries()].find(([tag]) => this.containers.get(input.name)?.deploymentId && tag.endsWith(this.containers.get(input.name)!.deploymentId));
    if (image?.[1].includes('fail-health')) {
      await this.wait(1_500);
      return { ok: false, reason: `no healthy response from ${input.path} (simulated because the branch name contains "fail-health")` };
    }
    log(`[simulated] GET ${input.path} -> 200`);
    return { ok: true };
  }

  async promote(): Promise<void> {}

  async removeContainer(name: string): Promise<void> {
    this.containers.delete(name);
  }

  async listContainers(): Promise<ContainerInfo[]> {
    return [...this.containers.values()].map(({ name, projectId, deploymentId, running }) => ({ name, projectId, deploymentId, running }));
  }

  async logs(name: string, tail: number): Promise<string[]> {
    const startedAt = this.containers.get(name)?.startedAt ?? Date.now();
    const stamp = (offset: number) => new Date(startedAt + offset).toISOString();
    const lines = [`${stamp(0)} [simulated] server starting`, `${stamp(120)} [simulated] listening on $PORT`];
    const minutes = Math.min(30, Math.floor((Date.now() - startedAt) / 20_000));
    for (let i = 1; i <= minutes; i++) lines.push(`${stamp(i * 20_000)} [simulated] GET / 200 ${3 + (i % 5)}ms`);
    return lines.slice(-tail);
  }
}
