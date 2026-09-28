# syntax=docker/dockerfile:1
FROM node:22-alpine
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY backend/package.json ./backend/
COPY admin-app/package.json ./admin-app/
COPY customer-app/package.json ./customer-app/
COPY booth-app/package.json ./booth-app/
COPY scripts/seed/package.json ./scripts/seed/
RUN npm ci --ignore-scripts

COPY packages/shared ./packages/shared
COPY scripts/seed ./scripts/seed
RUN npm run build --workspace @queuepass/shared

# One-shot job: seeds Keycloak then exits 0. Idempotent, so restarting the stack is safe.
CMD ["npm", "run", "seed", "--workspace", "@queuepass/seed"]
