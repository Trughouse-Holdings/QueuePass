# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY backend/package.json ./backend/
COPY admin-app/package.json ./admin-app/
COPY customer-app/package.json ./customer-app/
COPY booth-app/package.json ./booth-app/
COPY scripts/seed/package.json ./scripts/seed/
RUN npm ci --ignore-scripts

FROM deps AS build
# Baked in at build time; Compose fixes the ports, so these never vary per environment.
ARG VITE_API_BASE_URL=http://localhost:3000
ARG VITE_OIDC_AUTHORITY=http://localhost:8080/realms/queuepass
ARG VITE_OIDC_CLIENT_ID=admin-app
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL \
    VITE_OIDC_AUTHORITY=$VITE_OIDC_AUTHORITY \
    VITE_OIDC_CLIENT_ID=$VITE_OIDC_CLIENT_ID
COPY contracts ./contracts
COPY packages/shared ./packages/shared
COPY admin-app ./admin-app
RUN npm run build --workspace @queuepass/shared \
 && npm run build --workspace @queuepass/admin-app

FROM nginx:alpine AS runtime
COPY --from=build /app/admin-app/dist /usr/share/nginx/html
COPY admin-app/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 5173
