# Monitoring Dashboard — all-in-one image.
#   docker build -t server-monitor .
#   docker run -p 3000:3000 -v /var/run/docker.sock:/var/run/docker.sock:ro server-monitor

FROM node:20-bookworm-slim AS client-build
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY client/ ./
RUN npm run build

FROM node:20-bookworm-slim
WORKDIR /app

# docker CLI for the Containers/Projects/Database tabs (talks to the
# mounted socket); git/gh and systemd tools are absent — those tabs
# degrade to inline errors by design.
RUN apt-get update \
 && apt-get install -y --no-install-recommends docker.io python3 make g++ \
 && rm -rf /var/lib/apt/lists/*

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund \
 && npm cache clean --force

COPY index.js auth.js config.js monitor.js db.js builds.js ratelimit.js errors.js ./
COPY .env.example ./
COPY --from=client-build /app/client/dist ./client/dist

RUN mkdir -p /app/data && chown node:node /app/data

ENV NODE_ENV=production \
    PORT=3000 \
    HOST=0.0.0.0 \
    AUTH_FILE=/app/data/.auth.json

EXPOSE 3000

# The container user also needs the host docker group to use the mounted
# socket — pass it via `group_add` / `--group-add` (see docker-compose.yml).
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "index.js"]
