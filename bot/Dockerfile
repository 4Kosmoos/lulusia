FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
# Folder of the custom alerts (data/alerts.json), mounted on a Docker volume by docker-compose.yml
RUN mkdir -p data && chown node:node data
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.ts"]
