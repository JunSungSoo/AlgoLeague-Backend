FROM node:22.18.0-bookworm-slim AS builder
WORKDIR /app
COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile
COPY . .
RUN yarn build

FROM node:22.18.0-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN groupadd --system --gid 1001 backend && useradd --system --uid 1001 --gid backend backend
COPY --from=builder --chown=backend:backend /app/dist ./dist
COPY --from=builder --chown=backend:backend /app/drizzle ./drizzle
USER backend
EXPOSE 4000
ENV PORT=4000
CMD ["node", "dist/server.js"]

FROM runner AS sandbox
USER root
RUN apt-get update && apt-get install -y --no-install-recommends docker.io && rm -rf /var/lib/apt/lists/*
USER backend
EXPOSE 4100
ENV SANDBOX_PORT=4100
CMD ["node", "dist/sandbox-server.js"]

FROM runner AS production
