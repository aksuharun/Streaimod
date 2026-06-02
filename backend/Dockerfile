# syntax=docker/dockerfile:1.7

FROM node:20-bookworm-slim AS deps
WORKDIR /app

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

RUN npm ci

FROM deps AS build
COPY backend backend
RUN npm run build --workspace @ai-mod/backend

FROM node:20-bookworm-slim AS runtime
WORKDIR /app

ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY backend/package.json backend/package.json
COPY frontend/package.json frontend/package.json

RUN npm ci --omit=dev --workspace @ai-mod/backend

COPY --from=build /app/backend/dist backend/dist

EXPOSE 3000

CMD ["npm", "run", "start", "--workspace", "@ai-mod/backend"]
