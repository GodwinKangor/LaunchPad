import type { NextConfig } from 'next';

const config: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ['@prisma/client', 'bullmq', 'ioredis'],
};

export default config;
