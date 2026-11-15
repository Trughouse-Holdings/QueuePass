//! Spec 037 research R11: the build-time configuration, as the React apps' `VITE_*` values.
//! Compose and `scripts/run-host.mjs` set them; a plain `cargo build` (lint, tests) falls back to
//! Compose's defaults, so it needs no environment.

/// The Backend's address.
pub const API_BASE_URL: &str = match option_env!("QP_API_BASE_URL") {
    Some(v) => v,
    None => "http://localhost:3000",
};

/// The app's own realm.
pub const OIDC_AUTHORITY: &str = match option_env!("QP_OIDC_AUTHORITY") {
    Some(v) => v,
    None => "http://localhost:8080/realms/queuepass-admin-rust-app",
};

/// The app's public client.
pub const OIDC_CLIENT_ID: &str = match option_env!("QP_OIDC_CLIENT_ID") {
    Some(v) => v,
    None => "admin-rust-app",
};
