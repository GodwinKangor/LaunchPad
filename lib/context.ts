import { baseConfig } from './config';
import { getDispatcher } from './dispatch';
import type { ServiceContext } from './services/projects';
import type { Session } from './session';
import { getStore } from './store';

export async function serviceContext(session: Session): Promise<ServiceContext> {
  const [store, dispatcher] = await Promise.all([getStore(), getDispatcher()]);
  return { userId: session.userId, store, config: baseConfig(), dispatcher };
}
