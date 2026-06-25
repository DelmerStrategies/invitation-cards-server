# syntax=docker/dockerfile:1
# Backend API only (Express + Puppeteer/Chromium). The React client is deployed
# separately on Vercel, so this image just runs the server.
FROM node:20-bookworm-slim
ENV NODE_ENV=production

# System libraries Chromium needs. Puppeteer downloads Chromium itself during
# npm ci, but it won't launch without these + a base font.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates fonts-liberation \
      libasound2 libatk-bridge2.0-0 libatk1.0-0 libatspi2.0-0 libcairo2 \
      libcups2 libdbus-1-3 libdrm2 libgbm1 libglib2.0-0 libnspr4 libnss3 \
      libpango-1.0-0 libpangocairo-1.0-0 libx11-6 libxcb1 libxcomposite1 \
      libxdamage1 libxext6 libxfixes3 libxkbcommon0 libxrandr2 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev                 # also downloads Chromium (puppeteer postinstall)
COPY . .
# cardGenerator does path.resolve("assets") — cwd-relative — so the server MUST
# run from /app, where COPY put assets/. WORKDIR keeps cwd here.

ENV PORT=8080
EXPOSE 8080
CMD ["node", "src/index.js"]
