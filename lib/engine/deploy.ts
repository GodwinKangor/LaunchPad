import { errorMessage } from '../errors';
import { shortSha } from '../format';
import { ACTIVE_STATES, canTransition, isActiveState, type Deployment, type DeploymentState, type Project } from '../types';
import type { DeploymentPatch } from '../store/types';
import { createDeploymentLog, createRedactor } from './log';
import { imageTag } from './names';
import { pruneImages, recordedRoute, removeOtherContainers, resolveEnv, startRelease } from './release';
import { DeployError, type EngineDeps, type RunResult } from './types';

/**
 * Runs one deployment to a terminal state.
 *
 * Safe to call any number of times for the same deployment: a finished
 * deployment is skipped, a concurrent call backs off on the project lock, and
 * a call that finds an interrupted attempt cleans it up and starts over.
 */
export async function runDeployment(deps: EngineDeps, deploymentId: string): Promise<RunResult> {
  const queued = await deps.store.getDeployment(deploymentId);
  if (!queued || !isActiveState(queued.state)) return 'skipped';
  const release = await deps.locks.acquire(queued.projectId);
  if (!release) return 'locked';
  try {
    // Re-read under the lock: the previous holder may have just finished this very deployment.
    const deployment = await deps.store.getDeployment(deploymentId);
    if (!deployment || !isActiveState(deployment.state)) return 'skipped';
    const project = await deps.store.getProject(deployment.projectId);
    if (!project) return 'skipped';
    await execute(deps, project, deployment);
    return 'done';
  } finally {
    await release();
  }
}

async function execute(deps: EngineDeps, project: Project, deployment: Deployment): Promise<void> {
  const { store, driver, router } = deps;
  const id = deployment.id;
  let state = deployment.state;
  let redact: (text: string) => string = (text) => text;
  const out = createDeploymentLog(store, id, { redact: (text) => redact(text), maxLines: deps.settings.maxBuildLogLines });

  const move = async (to: DeploymentState, patch: DeploymentPatch = {}) => {
    if (!canTransition(state, to)) throw new Error(`Illegal deployment transition ${state} -> ${to}`);
    await out.flush();
    const updated = await store.transitionDeployment(id, [state], to, patch);
    if (!updated) throw new Error(`Deployment ${id} changed state unexpectedly while ${state}`);
    state = to;
  };

  let container: string | null = null;
  let builtImage: string | null = null;
  let routeSwitched = false;

  try {
    if (state !== 'queued') {
      // A previous attempt died mid-flight (worker crash or restart). Undo whatever it left and start again.
      out.log(`Resuming after an interrupted attempt (was ${state}); cleaning up first`);
      await router.setRoute(project.name, await recordedRoute(deps, project));
      for (const stale of await driver.listContainers()) {
        if (stale.deploymentId === id) await driver.removeContainer(stale.name);
      }
      await driver.cleanupWorkspace(id);
      await move('queued');
    }

    const env = await resolveEnv(deps, project);
    redact = createRedactor(Object.entries(env).filter(([key]) => key !== 'PORT').map(([, value]) => value));

    let image: string;
    if (deployment.kind === 'deploy') {
      await move('cloning', { startedAt: new Date() });
      out.log(`Cloning ${project.repoUrl} (branch ${deployment.branch})`);
      const { commitSha } = await driver.checkout({ deploymentId: id, repoUrl: project.repoUrl, branch: deployment.branch }, out.log);
      await store.updateDeployment(id, { commitSha });
      out.log(`Checked out commit ${shortSha(commitSha)}`);

      await move('building');
      image = imageTag(project, deployment);
      out.log(`Building image from ${project.rootDirectory ? `${project.rootDirectory}/Dockerfile` : 'Dockerfile'}`);
      builtImage = image;
      await driver.build({ deploymentId: id, projectId: project.id, rootDirectory: project.rootDirectory, image }, out.log);
      await store.updateDeployment(id, { image });
      out.log('Build finished');
      await move('starting');
    } else {
      if (!deployment.image || !(await driver.imageExists(deployment.image))) {
        throw new DeployError('The image for this release is no longer available on the server. Deploy again instead.');
      }
      image = deployment.image;
      out.log(`Rolling back to commit ${shortSha(deployment.commitSha)}`);
      await move('starting', { startedAt: new Date() });
    }

    container = await startRelease(deps, project, deployment, image, env, redact, out.log);
    out.log('Health check passed; switching traffic to the new release');

    routeSwitched = true;
    await router.setRoute(project.name, { kind: 'upstream', container, port: project.port });
    await out.flush();
    const promoted = await store.promoteDeployment(id, { containerName: container, image, imageRetained: true, finishedAt: new Date(), error: null });
    if (!promoted) throw new Error(`Deployment ${id} changed state unexpectedly while starting`);
    state = 'healthy';
  } catch (err) {
    const message = redact(err instanceof DeployError ? err.message : `Unexpected error: ${errorMessage(err)}`).slice(0, 2_000);
    // Only the redacted message is logged: the raw error may quote environment values.
    if (!(err instanceof DeployError)) console.error(`[engine] deployment ${id} failed: ${message}`);
    // Order matters: traffic goes back to the old release before the new container disappears.
    if (routeSwitched) await attempt(() => recordedRoute(deps, project).then((target) => router.setRoute(project.name, target)));
    if (container) await attempt(() => driver.removeContainer(container!));
    if (builtImage) await attempt(() => driver.removeImage(builtImage!));
    out.log(`Deployment failed: ${message}`);
    if (project.activeDeploymentId && project.status === 'running') out.log('The previous release is still serving traffic.');
    await out.flush();
    // If this write fails the error propagates, the queue retries the job, and the resume path above takes over.
    await store.transitionDeployment(id, ACTIVE_STATES, 'failed', { error: message, finishedAt: new Date() });
    return;
  } finally {
    await attempt(() => driver.cleanupWorkspace(id));
  }

  // The release is live. Everything below is tidying up; failures here are repaired by reconciliation.
  out.log('Deployment is live');
  await out.flush();
  await attempt(() => removeOtherContainers(deps, project.id, container));
  await attempt(() => pruneImages(deps, project.id));
}

async function attempt(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
  } catch (err) {
    console.error(`[engine] cleanup step failed: ${errorMessage(err)}`);
  }
}
