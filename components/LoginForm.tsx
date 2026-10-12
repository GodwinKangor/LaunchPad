'use client';

import { LogIn } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { ApiError, api } from './api-client';
import { Alert, Button, Field } from './ui';

export function LoginForm({ next, demo }: { next: string; demo: { email: string; password: string } | null }) {
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    setError(null);
    try {
      await api('/api/auth/login', { body: { email: form.get('email'), password: form.get('password') } });
      // Full navigation so the server sees the new cookie on first render.
      window.location.assign(next);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Sign-in failed.');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4" noValidate>
      {error && <Alert>{error}</Alert>}
      <Field label="Email" name="email" type="email" autoComplete="username" required autoFocus defaultValue={demo?.email} />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required defaultValue={demo?.password} />
      <Button type="submit" variant="primary" loading={loading} icon={<LogIn className="h-4 w-4" aria-hidden />} className="w-full">
        Sign in
      </Button>
    </form>
  );
}
