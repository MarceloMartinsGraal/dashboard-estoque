FROM node:24.22.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY backend ./backend
COPY frontend ./frontend
COPY tests ./tests
RUN npm run build

FROM build AS test
COPY scripts/test-first-access-browser.cjs ./scripts/test-first-access-browser.cjs
COPY scripts/test-invoices-browser.cjs ./scripts/test-invoices-browser.cjs
COPY docs/integracoes/integration-v1.openapi.json ./docs/integracoes/integration-v1.openapi.json
COPY scripts/provision-integration.cjs ./scripts/provision-integration.cjs
CMD ["sh", "-c", "npm run lint && npm run test:compiled"]

FROM node:24.22.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV INVOICE_STORAGE_DIR=/var/lib/graal/invoices
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build --chown=node:node /app/dist/backend ./dist/backend
COPY --from=build --chown=node:node /app/backend/migrations ./backend/migrations
COPY --chown=node:node scripts/provision-integration.cjs ./scripts/provision-integration.cjs
RUN mkdir -p /var/lib/graal/invoices && chown node:node /var/lib/graal/invoices && chmod 700 /var/lib/graal/invoices
USER node
EXPOSE 3000
CMD ["node", "dist/backend/main.js"]

FROM nginx:1.30.6-alpine AS web
COPY --from=build /app/dist/frontend /usr/share/nginx/html
