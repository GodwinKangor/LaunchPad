import { assertSameOrigin, requireSession } from './auth';
import { AppError, ValidationError } from './errors';
import type { Session } from './session';

export interface ApiContext<P> {
  req: Request;
  params: P;
  session: Session;
}

type RouteArgs<P> = { params: Promise<P> };

export function errorResponse(err: unknown): Response {
  if (err instanceof AppError) {
    return Response.json({ error: { code: err.code, message: err.message, fields: err.fields } }, { status: err.status });
  }
  // Unexpected errors may carry connection strings or other internals: log server-side, return nothing specific.
  console.error('[api] unhandled error:', err);
  return Response.json({ error: { code: 'internal', message: 'Something went wrong on the server.' } }, { status: 500 });
}

/**
 * Wraps a route handler so that every API route gets the same-origin check,
 * a verified session and JSON error mapping. There is deliberately no opt-out
 * flag: the few public routes (login, health) do not use this wrapper.
 */
export function authed<P = Record<string, never>>(handler: (ctx: ApiContext<P>) => Promise<Response | object>) {
  return async (req: Request, args: RouteArgs<P>): Promise<Response> => {
    try {
      assertSameOrigin(req);
      const session = await requireSession(req);
      const result = await handler({ req, params: await args.params, session });
      return result instanceof Response ? result : Response.json(result);
    } catch (err) {
      return errorResponse(err);
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) {
    throw new ValidationError('Send a JSON body with Content-Type: application/json.');
  }
  try {
    return await req.json();
  } catch {
    throw new ValidationError('The request body is not valid JSON.');
  }
}
