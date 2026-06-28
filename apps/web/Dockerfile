# Pipeline web (apps/web) — build the Vite app, serve static via nginx, and proxy
# /api to the API service. (For most hosters, deploying apps/web to Vercel/Netlify
# is simpler than this image — see docs/DEPLOY.md.)
FROM node:20-slim AS build
RUN corepack enable
WORKDIR /app
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY . .
RUN pnpm install --filter "@pipeline/web..." --frozen-lockfile \
 && pnpm --filter "@pipeline/contracts" build \
 && pnpm --filter "@pipeline/web" build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/web/dist /usr/share/nginx/html
EXPOSE 80
