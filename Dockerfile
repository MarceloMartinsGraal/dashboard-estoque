FROM node:24.22.0-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY backend ./backend
COPY frontend ./frontend
COPY tests ./tests
RUN npm run build

FROM build AS test
CMD ["sh", "-c", "npm run lint && npm run test:compiled"]

FROM node:24.22.0-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund && npm cache clean --force
COPY --from=build --chown=node:node /app/dist/backend ./dist/backend
COPY --from=build --chown=node:node /app/backend/migrations ./backend/migrations
USER node
EXPOSE 3000
CMD ["node", "dist/backend/main.js"]

FROM nginx:1.30.6-alpine AS web
COPY --from=build /app/dist/frontend /usr/share/nginx/html
