# syntax=docker/dockerfile:1
# Copied from customer-rust-app/Dockerfile at 680b4f7 (spec 040 R4, R12): the Rust Customer app.
# From spec 037 (research R11): A Rust build stage compiles the app to WebAssembly
# with Trunk; an nginx stage serves the static files on 5177, as customer-app/Dockerfile does. The
# build context is the repository root (the contract and the two stylesheets live outside the app).
# trixie: the prebuilt Trunk needs glibc 2.39 or later (bookworm has 2.36).
FROM rust:1.100.0-slim-trixie AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
# The pinned prebuilt Trunk (research R12), for the build machine's architecture.
ARG TRUNK_VERSION=0.22.1
RUN case "$(uname -m)" in \
      x86_64) triple=x86_64-unknown-linux-gnu ;; \
      aarch64) triple=aarch64-unknown-linux-gnu ;; \
      *) echo "unsupported architecture $(uname -m)" && exit 1 ;; \
    esac \
 && curl -fsSL "https://github.com/trunk-rs/trunk/releases/download/v${TRUNK_VERSION}/trunk-${triple}.tar.gz" \
    | tar -xz -C /usr/local/bin trunk
WORKDIR /repo/customer-rust-app
COPY customer-rust-app/rust-toolchain.toml ./
RUN rustup show

# The dependencies first, from the manifests and stub sources: a cached layer that only a
# dependency change rebuilds.
COPY customer-rust-app/Cargo.toml customer-rust-app/Cargo.lock ./
COPY customer-rust-app/.cargo ./.cargo
COPY customer-rust-app/core/Cargo.toml ./core/
COPY customer-rust-app/app/Cargo.toml ./app/
RUN mkdir -p core/src app/src \
 && echo 'fn main() {}' > core/build.rs \
 && touch core/src/lib.rs \
 && echo 'fn main() {}' > app/src/main.rs \
 && cargo build --release --target wasm32-unknown-unknown -p customer-rust-app \
 && rm -rf core/src app/src core/build.rs

# Baked in at build time, as the React apps' VITE_* values (research R11).
ARG QP_API_BASE_URL=http://localhost:3000
ARG QP_OIDC_AUTHORITY=http://localhost:8080/realms/queuepass-customer-app
ARG QP_OIDC_CLIENT_ID=customer-rust-app
ENV QP_API_BASE_URL=$QP_API_BASE_URL \
    QP_OIDC_AUTHORITY=$QP_OIDC_AUTHORITY \
    QP_OIDC_CLIENT_ID=$QP_OIDC_CLIENT_ID
# The contract (core/build.rs generates the API types from it), the React Customer app's own two
# stylesheets, and the Rust Admin app's red.css (spec 040 R6), at their repository paths. No fonts.
COPY contracts/openapi.yaml /repo/contracts/openapi.yaml
COPY packages/shared/src/web/theme.css /repo/packages/shared/src/web/theme.css
COPY customer-app/src/styles.css /repo/customer-app/src/styles.css
COPY admin-rust-app/style/red.css /repo/admin-rust-app/style/red.css
COPY customer-rust-app ./
# COPY keeps the files' own times, which can be older than the stub build: make them newer.
RUN find core app -name '*.rs' -exec touch {} + \
 && trunk build --release

FROM nginx:alpine AS runtime
COPY --from=build /repo/customer-rust-app/dist /usr/share/nginx/html
COPY customer-rust-app/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 5177
