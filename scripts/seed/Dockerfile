# syntax=docker/dockerfile:1
FROM node:22-alpine
WORKDIR /app

# npm ci checks the lock file against every workspace's manifest, so all of them are copied.
COPY package.json package-lock.json ./
COPY packages/shared/package.json ./packages/shared/
COPY backend/package.json ./backend/
COPY admin-app/package.json ./admin-app/
COPY customer-app/package.json ./customer-app/
COPY booth-app/package.json ./booth-app/
COPY scripts/seed/package.json ./scripts/seed/
# Spec 020 research R1: only the seed's own workspace (and the root) is installed, so the
# Backend's geo-tz (about 72 MB) stays out of this image; the next line fails the build if it is
# here anyway. scripts/test/seed-image.test.mjs keeps both lines.
RUN npm ci --ignore-scripts --workspace @queuepass/seed --include-workspace-root
RUN test ! -e node_modules/geo-tz

# The seed imports nothing from packages/shared (spec 020 review round 2, n6), so it is neither
# copied nor built.
COPY scripts/seed ./scripts/seed

# One-shot job: seeds Keycloak then exits 0. Idempotent, so restarting the stack is safe.
CMD ["npm", "run", "seed", "--workspace", "@queuepass/seed"]
