# syntax=docker/dockerfile:1
FROM node:22-alpine AS base
WORKDIR /app
RUN apk add --no-cache openssl

FROM base AS deps
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY backend/package.json ./backend/
COPY admin-app/package.json ./admin-app/
COPY customer-app/package.json ./customer-app/
COPY booth-app/package.json ./booth-app/
COPY scripts/seed/package.json ./scripts/seed/
RUN npm ci

FROM deps AS build
COPY packages/shared ./packages/shared
COPY backend ./backend
# @queuepass/shared must be compiled to JS first — the runtime stage runs plain `node`,
# which cannot load the TypeScript sources that ts-jest and Vite happily transpile.
RUN npm run build --workspace @queuepass/shared \
 && npx prisma generate --schema backend/prisma/schema.prisma \
 && npm run build --workspace @queuepass/backend

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/shared ./packages/shared
COPY --from=build /app/backend/dist ./backend/dist
COPY --from=build /app/backend/prisma ./backend/prisma
COPY --from=build /app/backend/package.json ./backend/
# The contract is served at /docs (spec 001 FR-027). Same file the tests validate against.
COPY contracts ./contracts
COPY package.json ./
ENV OPENAPI_PATH=/app/contracts/openapi.yaml
EXPOSE 3000

# Apply migrations before serving the first request. `migrate deploy`, never `db push` —
# db push skips migration SQL and would omit the event_no_overlap constraint.
CMD ["sh", "-c", "npx prisma migrate deploy --schema backend/prisma/schema.prisma && node backend/dist/main.js"]
