# syntax=docker/dockerfile:1
# Builds for the platform it runs on. For a Raspberry Pi 5 from another machine:
#   docker buildx build --platform linux/arm64 -t disco-controller .

FROM node:24-bookworm-slim AS build
# Toolchain in case a native module (better-sqlite3) has no prebuilt binary.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g pnpm@12.11.2
WORKDIR /src
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
# Server bundle, migrations, and production node_modules only.
RUN pnpm --filter server deploy --prod /out/apps/server \
  && mkdir -p /out/apps/web \
  && cp -r apps/web/dist /out/apps/web/dist

FROM node:24-bookworm-slim
ENV NODE_ENV=production \
  PORT=3000 \
  HOST=0.0.0.0 \
  DATABASE_PATH=/data/disco.db
WORKDIR /app
COPY --from=build --chown=node:node /out /app
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME ["/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "apps/server/dist/index.js"]
