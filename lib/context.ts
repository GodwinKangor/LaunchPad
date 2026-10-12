import { baseConfig } from './config';
import type { ServiceContext } from './services/projects';
import type { Session } from './session';
import { getStore } from './store';

export async function serviceContext(session: Session): Promise<ServiceContext> {
  return { userId: session.userId, store: await getStore(), config: baseConfig() };
}
