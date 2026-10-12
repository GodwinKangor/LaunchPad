import { authed, readJson } from '@/lib/api';
import { serviceContext } from '@/lib/context';
import { updateEnv } from '@/lib/services/projects';

export const dynamic = 'force-dynamic';

export const PUT = authed<{ id: string }>(async ({ req, params, session }) => ({
  env: await updateEnv(await serviceContext(session), params.id, await readJson(req)),
}));
