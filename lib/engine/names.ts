import { shortSuffix } from '../ids';
import type { Deployment, Project } from '../types';

/** One immutable image tag per deployment; rollbacks reuse the tag of the release they restore. */
export function imageTag(project: Pick<Project, 'name'>, deployment: Pick<Deployment, 'id'>): string {
  return `launchpad/${project.name}:${deployment.id}`;
}

/** Unique per start, so a replacement container can run next to the one it replaces. Also its DNS name on the app network. */
export function containerName(project: Pick<Project, 'name'>, deployment: Pick<Deployment, 'id'>): string {
  return `lp-${project.name}-${deployment.id.slice(0, 8)}-${shortSuffix()}`;
}
