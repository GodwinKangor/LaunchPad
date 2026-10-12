'use client';

import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { api } from './api-client';
import { Button } from './ui';

export function SignOutButton() {
  const [loading, setLoading] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      loading={loading}
      icon={<LogOut className="h-3.5 w-3.5" aria-hidden />}
      onClick={async () => {
        setLoading(true);
        await api('/api/auth/logout', { method: 'POST' }).catch(() => undefined);
        window.location.assign('/login');
      }}
    >
      Sign out
    </Button>
  );
}
