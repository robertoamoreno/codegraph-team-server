FROM node:22-bookworm-slim AS build

WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim

WORKDIR /app
ENV NODE_ENV=production \
    CODEGRAPH_SERVER_HOST=0.0.0.0 \
    CODEGRAPH_SERVER_PORT=3000 \
    CODEGRAPH_SERVER_DATA_DIR=/data \
    CODEGRAPH_PROJECTS_DIR=/projects

RUN apt-get update \
  && apt-get install -y --no-install-recommends git openssh-client ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

RUN mkdir -p /data /projects

EXPOSE 3000
VOLUME ["/data", "/projects"]

CMD ["node", "dist/bin/codegraph.js", "server", "--host", "0.0.0.0", "--port", "3000"]
