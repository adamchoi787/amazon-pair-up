# PairUp MCP server. Runs TypeScript directly with tsx (no build step).
FROM node:22-slim

WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
# pairing-core (Rust settlement core, prebuilt WebAssembly) is a local file dependency.
COPY vendor ./vendor
RUN npm ci --omit=dev && npm cache clean --force

COPY src ./src
COPY data ./data
COPY public ./public
COPY skills ./skills

# Listen on all interfaces inside the container. Set ALLOWED_HOSTS to the public
# hostname at deploy time for DNS-rebinding protection.
ENV HOST=0.0.0.0 \
    PORT=3000 \
    PGLITE_DIR=/data/pglite \
    SEED_ON_START=true \
    TZ=Asia/Hong_Kong

RUN mkdir -p /data && chown node:node /data
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "src/index.ts"]
