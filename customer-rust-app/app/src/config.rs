// Copied from admin-rust-app/app/src/config.rs at 680b4f7 (spec 040 R4).
//! Spec 037 research R11: the build-time configuration, as the React apps' `VITE_*` values.
//! Compose and `scripts/run-host.mjs` set them; a plain `cargo build` (lint, tests) falls back to
//! Compose's defaults, so it needs no environment.

/// The Backend's address.
pub const API_BASE_URL: &str = match option_env!("QP_API_BASE_URL") {
    Some(v) => v,
    None => "http://localhost:3000",
};

/// The Customer app's realm, shared with the React Customer app (spec 040 R3).
pub const OIDC_AUTHORITY: &str = match option_env!("QP_OIDC_AUTHORITY") {
    Some(v) => v,
    None => "http://localhost:8080/realms/queuepass-customer-app",
};

/// The app's own public client in that realm (spec 040 R3).
pub const OIDC_CLIENT_ID: &str = match option_env!("QP_OIDC_CLIENT_ID") {
    Some(v) => v,
    None => "customer-rust-app",
};
