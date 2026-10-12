import { authed, readJson } from '@/lib/api';
import { serviceContext } from '@/lib/context';
import { createProject, listProjects } from '@/lib/services/projects';

export const dynamic = 'force-dynamic';

export const GET = authed(async ({ session }) => ({ projects: await listProjects(await serviceContext(session)) }));

export const POST = authed(async ({ req, session }) => {
  const project = await createProject(await serviceContext(session), await readJson(req));
  return Response.json({ project }, { status: 201 });
});
