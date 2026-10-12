import { authed, readJson } from '@/lib/api';
import { serviceContext } from '@/lib/context';
import { getProjectDetail, updateProject } from '@/lib/services/projects';

export const dynamic = 'force-dynamic';

type Params = { id: string };

export const GET = authed<Params>(async ({ params, session }) => getProjectDetail(await serviceContext(session), params.id));

export const PATCH = authed<Params>(async ({ req, params, session }) => ({
  project: await updateProject(await serviceContext(session), params.id, await readJson(req)),
}));
