FROM node:24-bookworm-slim AS build

WORKDIR /app/backend

COPY backend/package.json backend/package-lock.json ./
COPY backend/prisma ./prisma
RUN npm ci && npm prune --omit=dev

COPY backend/src ./src

FROM node:24-bookworm-slim

ENV NODE_ENV=production
WORKDIR /app/backend

COPY --from=build --chown=node:node /app/backend/package.json ./package.json
COPY --from=build --chown=node:node /app/backend/package-lock.json ./package-lock.json
COPY --from=build --chown=node:node /app/backend/node_modules ./node_modules
COPY --from=build --chown=node:node /app/backend/prisma ./prisma
COPY --from=build --chown=node:node /app/backend/src ./src

RUN mkdir -p /app/backend/uploads && chown -R node:node /app/backend

USER node
EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4000/health/ready').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"

CMD ["node", "src/index.js"]
