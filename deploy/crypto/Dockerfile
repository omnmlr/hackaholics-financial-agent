FROM node:24-bookworm-slim@sha256:873f586f3794f52281bd039bf02c048a0be08fde619338f9941bad1eb6b34530
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN apt-get update \
  && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-eng \
  && rm -rf /var/lib/apt/lists/* \
  && chown node:node /app
USER node
COPY --chown=node:node . .
RUN npm ci --ignore-scripts && npm run build
ENV NODE_ENV=production
CMD ["sh", "deploy/crypto/start.sh", "api"]
