# One Dockerfile, two targets:
#   dashboard  Next.js UI and API. Has no Docker CLI and no access to the Docker socket.
#   worker     Deployment worker. Has git and the Docker CLI; talks to the host's Docker daemon.

FROM node:22-bookworm-slim AS base
WORKDIR /app
RUN apt-get update \
  && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci
COPY . .

FROM base AS dashboard
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN npm run build && chown -R node:node /app/.next
USER node
EXPOSE 3000
CMD ["npm", "run", "start"]

FROM base AS worker
ENV NODE_ENV=production
RUN apt-get update \
  && apt-get install -y --no-install-recommends git \
  && rm -rf /var/lib/apt/lists/*
COPY --from=docker:27-cli /usr/local/bin/docker /usr/local/bin/docker
COPY --from=docker:27-cli /usr/local/libexec/docker/cli-plugins/docker-buildx /usr/local/libexec/docker/cli-plugins/docker-buildx
CMD ["npm", "run", "worker"]
