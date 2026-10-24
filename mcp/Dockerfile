# Remote MCP server (src/http.ts). Built from the root of the repo (see docker-compose.yml): it also
# needs the shared lib/ workspace. What is sent to Docker is limited by Dockerfile.dockerignore.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
# Dependencies first, so that they stay in Docker's cache while only the code changes. npm needs the
# package.json of every workspace, but only installs the MCP server's dependencies.
COPY package.json package-lock.json ./
COPY lib/package.json lib/
COPY bot/package.json bot/
COPY mcp/package.json mcp/
RUN npm ci --omit=dev --workspace mcp
COPY lib/src lib/src
COPY mcp/src mcp/src
USER node
WORKDIR /app/mcp
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3100/health').then((r) => process.exit(r.ok ? 0 : 1), () => process.exit(1))"]
CMD ["node", "--disable-warning=ExperimentalWarning", "src/http.ts"]
