/** Errors that are safe to show to the signed-in owner. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export class ValidationError extends AppError {
  constructor(message: string, fields?: Record<string, string>) {
    super(400, 'invalid_request', message, fields);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Sign in to continue.') {
    super(401, 'unauthorized', message);
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'This request is not allowed.') {
    super(403, 'forbidden', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Not found.') {
    super(404, 'not_found', message);
  }
}

export class ConflictError extends AppError {
  constructor(message: string, fields?: Record<string, string>) {
    super(409, 'conflict', message, fields);
  }
}

/** The project already has a deployment or lifecycle action in flight. */
export class BusyError extends AppError {
  constructor(message = 'Another deployment or action is already in progress for this project.') {
    super(409, 'busy', message);
  }
}

export class UnavailableError extends AppError {
  constructor(message: string) {
    super(503, 'unavailable', message);
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
