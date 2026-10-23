# Built from the root of the repo (see docker-compose.yml): the bot also needs the shared lib/ workspace.
# What is sent to Docker is limited by Dockerfile.dockerignore.
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
# Dependencies first, so that they stay in Docker's cache while only the code changes.
COPY package.json package-lock.json ./
COPY lib/package.json lib/
COPY bot/package.json bot/
RUN npm ci --omit=dev --workspace bot
COPY lib/src lib/src
COPY bot/src bot/src
# Folder of the custom alerts (data/alerts.json), mounted on a Docker volume by docker-compose.yml
RUN mkdir -p bot/data && chown node:node bot/data
USER node
WORKDIR /app/bot
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.ts"]
