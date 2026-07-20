# Multi-stage-friendly, small production image.
FROM node:20-alpine

WORKDIR /app

# Install deps first (layer caching: deps only reinstall when package.json changes)
COPY package*.json ./
RUN npm install --omit=dev

COPY src ./src

EXPOSE 3000

# Healthcheck so orchestrators (compose/k8s) know when the service is ready.
HEALTHCHECK --interval=10s --timeout=3s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/server.js"]
