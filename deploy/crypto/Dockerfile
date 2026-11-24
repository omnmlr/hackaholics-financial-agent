FROM node:24-bookworm-slim
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
RUN chown node:node /app
USER node
COPY --chown=node:node . .
RUN npm ci --ignore-scripts && npm run build
ENV NODE_ENV=production
CMD ["sh", "deploy/crypto/start.sh", "api"]
