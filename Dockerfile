FROM node:24-alpine AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-alpine AS runtime

ENV NODE_ENV=production \
    PORT=3000 \
    DATA_DIR=/app/data

WORKDIR /app
RUN mkdir -p /app/data && chown node:node /app/data
COPY --from=build --chown=node:node /app/dist ./dist
COPY --from=build --chown=node:node /app/server ./server

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD ["node", "-e", "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/health').then(response => { if (!response.ok) process.exit(1); }).catch(() => process.exit(1));"]

CMD ["node", "server/index.mjs"]
