# Pipeline hosted API (apps/api) — monorepo-aware image.
# Installs only the api + its workspace deps, builds the shared TS packages, and
# runs the Fastify server. Point DATABASE_URL at managed Postgres; the schema is
# applied on startup. (Single stage for simplicity; can be slimmed to multi-stage
# + compiled output later.)
FROM node:20-slim
RUN corepack enable
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

# Copy the whole workspace (the .dockerignore keeps node_modules/dist/business out).
COPY . .

# Install the api dependency closure, then build the shared packages it imports.
RUN pnpm install --filter "@pipeline/api..." --frozen-lockfile \
 && pnpm --filter "@pipeline/contracts" --filter "@pipeline/crypto" --filter "@pipeline/classify" \
         --filter "@pipeline/providers" --filter "@pipeline/db" --filter "@pipeline/license" \
         --filter "@pipeline/sync" build

ENV NODE_ENV=production PORT=3001
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://localhost:'+(process.env.PORT||3001)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["pnpm", "--filter", "@pipeline/api", "start"]
