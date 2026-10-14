FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
# Dossier des alertes perso (data/alerts.json), monté sur un volume Docker par docker-compose.yml
RUN mkdir -p data && chown node:node data
USER node
CMD ["node", "--disable-warning=ExperimentalWarning", "src/index.ts"]
