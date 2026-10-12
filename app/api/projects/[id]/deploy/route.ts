import { authed } from '@/lib/api';
import { serviceContext } from '@/lib/context';
import { deployProject } from '@/lib/services/projects';

export const dynamic = 'force-dynamic';

export const POST = authed<{ id: string }>(async ({ params, session }) => {
  const deployment = await deployProject(await serviceContext(session), params.id);
  return Response.json({ deployment }, { status: 202 });
});
