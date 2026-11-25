# Build context is the repository root (workspaces share one lockfile).
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci -w backend
COPY backend backend
RUN npm run build -w backend

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci -w backend --omit=dev
COPY --from=build /app/backend/dist backend/dist
COPY backend/drizzle backend/drizzle
WORKDIR /app/backend
EXPOSE 3000
# Migrations apply at every start; they are idempotent.
CMD ["sh", "-c", "node dist/db/migrate.js && node dist/server.js"]
