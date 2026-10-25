FROM node:22-bookworm-slim

# System Chromium (puppeteer's own download is skipped) + the fonts/certs it needs.
# tini reaps the zombie processes Chromium leaves behind and forwards SIGTERM.
RUN apt-get update \
 && apt-get install -y --no-install-recommends chromium fonts-liberation ca-certificates tini \
 && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_DOWNLOAD=true \
    CHROME_PATH=/usr/bin/chromium \
    WA_DATA_DIR=/data \
    PORT=3100 \
    NODE_ENV=production

WORKDIR /app

# package-lock.json is optional: npm ci when it is there, npm install when it is not.
COPY package.json package-lock.json* ./
RUN if [ -f package-lock.json ]; then npm ci --omit=dev; else npm install --omit=dev; fi \
 && npm cache clean --force

COPY src ./src

# The WhatsApp session lives in /data; keep it on a volume so a restart keeps the pairing.
RUN mkdir -p /data && chown -R node:node /data /app
VOLUME /data

USER node
EXPOSE 3100

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/server.js"]
