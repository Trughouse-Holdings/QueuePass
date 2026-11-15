//! Spec 037 research R3, data-model.md `AuthState` (tasks T025; parity S1–S3): the sign-in state
//! machine, mirroring `packages/shared/src/web/auth-provider.tsx` and its tests
//! (`packages/shared/test/web/auth-provider.test.tsx`). Pure: the browser glue performs each
//! `Effect`, and time is passed in.

use admin_rust_core::auth::{
    AuthMachine, AuthStatus, Effect, MemoryPkceStore, PendingSignIn, PkceError, PkceStore,
    RENEW_BEFORE_MS, RENEW_RETRY_MS, RenewError, Tokens, claims_of, finish_sign_in, start_sign_in,
};

/// An unsigned JWT with the given payload, as Keycloak's shape (header.payload.signature).
fn jwt(payload: &str) -> String {
    use base64::Engine;
    let enc = base64::engine::general_purpose::URL_SAFE_NO_PAD;
    format!(
        "{}.{}.sig",
        enc.encode(r#"{"alg":"RS256"}"#),
        enc.encode(payload)
    )
}

fn admin_token() -> String {
    jwt(
        r#"{"preferred_username":"admin2","realm_access":{"roles":["queuepass-admin","offline_access","uma_authorization"]}}"#,
    )
}

fn tokens(access: String, expires_at_ms: i64) -> Tokens {
    Tokens {
        access_token: access,
        id_token: Some("the-id-token".into()),
        refresh_token: Some("the-refresh-token".into()),
        expires_at_ms,
    }
}

const NOW: i64 = 1_800_000_000_000;
const LIFE: i64 = 300_000;

/// A machine signed in as admin2 with a token valid for 5 minutes from NOW.
fn signed_in() -> AuthMachine {
    let mut m = AuthMachine::new();
    assert_eq!(
        m.start("/", "?code=abc&state=xyz"),
        vec![Effect::ExchangeCode]
    );
    m.code_exchanged(
        Ok((tokens(admin_token(), NOW + LIFE), Some("/".into()))),
        "/",
    );
    m
}

#[test]
fn a_signed_out_visitor_is_sent_to_sign_in_and_sees_nothing() {
    let mut m = AuthMachine::new();
    assert_eq!(m.status(), AuthStatus::Loading);
    let effects = m.start("/", "");
    assert_eq!(
        effects,
        vec![Effect::RedirectToSignIn {
            return_to: "/".into()
        }]
    );
    assert_eq!(m.status(), AuthStatus::SigningIn);
    assert_eq!(m.access_token(), None);
}

#[test]
fn sign_in_asks_to_come_back_to_the_page_opened() {
    let mut m = AuthMachine::new();
    assert_eq!(
        m.start("/events", "?q=jazz"),
        vec![Effect::RedirectToSignIn {
            return_to: "/events?q=jazz".into()
        }]
    );
}

#[test]
fn the_callback_completes_then_the_code_leaves_the_url_for_the_return_page() {
    let mut m = AuthMachine::new();
    m.start("/", "?state=xyz&code=abc");
    let effects = m.code_exchanged(
        Ok((tokens(admin_token(), NOW + LIFE), Some("/events".into()))),
        "/",
    );
    assert_eq!(effects, vec![Effect::ReplaceUrl("/events".into())]);
    assert_eq!(m.status(), AuthStatus::SignedIn);
    assert_eq!(m.access_token(), Some(admin_token().as_str()));
}

#[test]
fn a_return_page_not_starting_with_a_slash_goes_home() {
    let mut m = AuthMachine::new();
    m.start("/", "?state=s&code=c");
    let effects = m.code_exchanged(
        Ok((
            tokens(admin_token(), NOW + LIFE),
            Some("https://evil.example/".into()),
        )),
        "/",
    );
    assert_eq!(effects, vec![Effect::ReplaceUrl("/".into())]);
    let mut m = AuthMachine::new();
    m.start("/", "?state=s&code=c");
    assert_eq!(
        m.code_exchanged(Ok((tokens(admin_token(), NOW + LIFE), None)), "/"),
        vec![Effect::ReplaceUrl("/".into())]
    );
}

#[test]
fn a_failed_exchange_drops_the_code_and_signs_in_again() {
    let mut m = AuthMachine::new();
    m.start("/events", "?code=stale&state=old");
    let effects = m.code_exchanged(Err(()), "/events");
    assert_eq!(
        effects,
        vec![
            Effect::ReplaceUrl("/events".into()),
            Effect::RedirectToSignIn {
                return_to: "/events".into()
            },
        ]
    );
    assert_eq!(m.status(), AuthStatus::SigningIn);
}

#[test]
fn only_a_code_and_a_state_together_are_a_callback() {
    let mut m = AuthMachine::new();
    assert!(matches!(
        m.start("/", "?code=abc")[0],
        Effect::RedirectToSignIn { .. }
    ));
    let mut m = AuthMachine::new();
    assert!(matches!(
        m.start("/", "?state=abc")[0],
        Effect::RedirectToSignIn { .. }
    ));
}

#[test]
fn the_username_and_queuepass_roles_come_from_the_access_token() {
    let claims = claims_of(&admin_token());
    assert_eq!(claims.username.as_deref(), Some("admin2"));
    assert_eq!(claims.roles, vec!["queuepass-admin".to_string()]);
    let m = signed_in();
    assert_eq!(m.username(), Some("admin2"));
    assert_eq!(m.roles(), vec!["queuepass-admin".to_string()]);
}

#[test]
fn a_token_that_does_not_read_has_no_roles() {
    assert!(claims_of("not-a-jwt").roles.is_empty());
    assert!(claims_of("a.%%%.c").roles.is_empty());
    assert_eq!(claims_of(&jwt("[]")).username, None);
}

#[test]
fn without_the_admin_role_the_wrong_role_page_shows() {
    let mut m = AuthMachine::new();
    m.start("/", "?code=c&state=s");
    let customer =
        jwt(r#"{"preferred_username":"customer1","realm_access":{"roles":["customer"]}}"#);
    m.code_exchanged(Ok((tokens(customer, NOW + LIFE), None)), "/");
    assert_eq!(m.status(), AuthStatus::WrongRole);
    // Still signed in: the wrong-role page offers Log out.
    assert!(m.access_token().is_some());
}

#[test]
fn renewal_starts_shortly_before_expiry_with_no_page_change() {
    let mut m = signed_in();
    assert_eq!(m.tick(NOW), vec![]);
    assert_eq!(m.tick(NOW + LIFE - RENEW_BEFORE_MS - 1), vec![]);
    assert_eq!(m.tick(NOW + LIFE - RENEW_BEFORE_MS), vec![Effect::Refresh]);
    // One renewal at a time.
    assert_eq!(m.tick(NOW + LIFE - RENEW_BEFORE_MS + 1_000), vec![]);
}

#[test]
fn a_renewed_token_is_picked_up() {
    let mut m = signed_in();
    m.tick(NOW + LIFE - RENEW_BEFORE_MS);
    let renewed = jwt(
        r#"{"preferred_username":"admin2","realm_access":{"roles":["queuepass-admin"]},"n":2}"#,
    );
    let effects = m.refreshed(
        Ok(tokens(renewed.clone(), NOW + 2 * LIFE)),
        NOW + LIFE - 50_000,
        "/",
    );
    assert_eq!(effects, vec![]);
    assert_eq!(m.access_token(), Some(renewed.as_str()));
    assert_eq!(m.status(), AuthStatus::SignedIn);
    // The next renewal is due before the new expiry.
    assert_eq!(
        m.tick(NOW + 2 * LIFE - RENEW_BEFORE_MS),
        vec![Effect::Refresh]
    );
}

#[test]
fn keycloak_refusing_the_renewal_signs_in_again() {
    let mut m = signed_in();
    m.tick(NOW + LIFE - RENEW_BEFORE_MS);
    let effects = m.refreshed(Err(RenewError::Refused), NOW + LIFE - 50_000, "/events");
    assert_eq!(
        effects,
        vec![Effect::RedirectToSignIn {
            return_to: "/events".into()
        }]
    );
    assert_eq!(m.status(), AuthStatus::SigningIn);
    assert_eq!(m.access_token(), None);
}

#[test]
fn a_renewal_failing_for_lack_of_network_keeps_the_user_and_retries_every_30_seconds() {
    let mut m = signed_in();
    let t = NOW + LIFE - RENEW_BEFORE_MS;
    m.tick(t);
    assert_eq!(m.refreshed(Err(RenewError::Other), t + 100, "/"), vec![]);
    assert_eq!(m.status(), AuthStatus::SignedIn);
    assert!(m.renew_failed());
    assert!(m.access_token().is_some());
    // Retried at once (the React provider tries as soon as the failure is recorded) ...
    assert_eq!(m.tick(t + 200), vec![Effect::Refresh]);
    m.refreshed(Err(RenewError::Other), t + 300, "/");
    // ... then every 30 seconds after the last try.
    assert_eq!(m.tick(t + 200 + RENEW_RETRY_MS - 1), vec![]);
    assert_eq!(m.tick(t + 200 + RENEW_RETRY_MS), vec![Effect::Refresh]);
}

#[test]
fn going_back_online_retries_a_failed_renewal_at_once() {
    let mut m = signed_in();
    let t = NOW + LIFE - RENEW_BEFORE_MS;
    m.tick(t);
    m.refreshed(Err(RenewError::Other), t, "/");
    m.tick(t);
    m.refreshed(Err(RenewError::Other), t, "/");
    assert_eq!(m.online(), vec![Effect::Refresh]);
    // No second try while one is pending.
    assert_eq!(m.online(), vec![]);
}

#[test]
fn no_retry_without_a_failed_renewal() {
    let mut m = signed_in();
    assert_eq!(m.online(), vec![]);
    assert_eq!(m.tick(NOW + 60_000), vec![]);
}

#[test]
fn a_token_that_simply_expires_keeps_the_user_and_retries() {
    let mut m = signed_in();
    // The scheduled renewal was never answered (a hanging request) until after expiry.
    m.tick(NOW + LIFE - RENEW_BEFORE_MS);
    m.refreshed(Err(RenewError::Other), NOW + LIFE + 1, "/");
    assert!(m.renew_failed());
    assert_eq!(m.status(), AuthStatus::SignedIn);
}

#[test]
fn an_expiry_with_no_renewal_error_before_it_counts_as_a_failed_renewal() {
    let mut m = signed_in();
    // The device slept through the renewal time: the first tick is after expiry.
    let effects = m.tick(NOW + LIFE + 5_000);
    assert_eq!(effects, vec![Effect::Refresh]);
    assert!(m.renew_failed());
}

#[test]
fn keycloak_refusing_a_retry_ends_the_session() {
    let mut m = signed_in();
    let t = NOW + LIFE + 1;
    m.tick(t);
    let effects = m.refreshed(Err(RenewError::Refused), t, "/reports");
    assert_eq!(
        effects,
        vec![Effect::RedirectToSignIn {
            return_to: "/reports".into()
        }]
    );
}

#[test]
fn log_out_clears_memory_first_then_ends_the_keycloak_session() {
    let mut m = signed_in();
    let effects = m.logout();
    assert_eq!(
        effects,
        vec![Effect::EndSession {
            id_token_hint: Some("the-id-token".into())
        }]
    );
    assert_eq!(m.access_token(), None);
    assert_eq!(m.status(), AuthStatus::SignedOut);
}

#[test]
fn no_retry_and_no_sign_in_while_logging_out() {
    let mut m = signed_in();
    m.tick(NOW + LIFE - RENEW_BEFORE_MS);
    m.logout();
    assert_eq!(m.online(), vec![]);
    assert_eq!(m.tick(NOW + LIFE + RENEW_RETRY_MS), vec![]);
    assert_eq!(m.sign_in("/"), vec![]);
    // A failure recorded while logging out starts no try.
    assert_eq!(m.refreshed(Err(RenewError::Other), NOW + LIFE, "/"), vec![]);
    assert_eq!(m.tick(NOW + LIFE + 2 * RENEW_RETRY_MS), vec![]);
}

#[test]
fn a_renewal_landing_during_logout_is_dropped() {
    let mut m = signed_in();
    m.tick(NOW + LIFE - RENEW_BEFORE_MS);
    m.logout();
    let effects = m.refreshed(
        Ok(tokens(admin_token(), NOW + 2 * LIFE)),
        NOW + LIFE - 1,
        "/",
    );
    assert_eq!(effects, vec![]);
    assert_eq!(m.access_token(), None);
    assert_eq!(m.status(), AuthStatus::SignedOut);
}

#[test]
fn a_401_signs_in_again_with_the_page_to_return_to() {
    let mut m = signed_in();
    assert_eq!(
        m.sign_in("/events/1/attendees"),
        vec![Effect::RedirectToSignIn {
            return_to: "/events/1/attendees".into()
        }]
    );
    // The page stays signed in until the browser leaves (review finding 3).
    assert_eq!(m.status(), AuthStatus::SignedIn);
}

#[test]
fn back_forward_cache_restore_with_no_user_signs_in() {
    let mut m = signed_in();
    m.logout();
    assert_eq!(
        m.page_show(true, NOW, "/events"),
        vec![Effect::RedirectToSignIn {
            return_to: "/events".into()
        }]
    );
    assert_eq!(m.status(), AuthStatus::SigningIn);
}

#[test]
fn back_forward_cache_restore_with_an_expired_user_keeps_it_and_retries() {
    let mut m = signed_in();
    assert_eq!(
        m.page_show(true, NOW + LIFE + 1, "/"),
        vec![Effect::Refresh]
    );
    assert!(m.renew_failed());
    assert_eq!(m.status(), AuthStatus::SignedIn);
}

#[test]
fn an_ordinary_page_show_changes_nothing() {
    let mut m = signed_in();
    assert_eq!(m.page_show(false, NOW + LIFE + 1, "/"), vec![]);
    assert_eq!(m.page_show(true, NOW, "/"), vec![]);
}

// The PKCE verifier and `state` cross the redirect in sessionStorage and are removed at once
// (spec 018 R12, research R3).

fn pending() -> PendingSignIn {
    PendingSignIn {
        state: "state-123".into(),
        code_verifier: "verifier-abc".into(),
        nonce: "nonce-1".into(),
        return_to: "/events".into(),
    }
}

#[test]
fn the_pkce_values_are_kept_until_the_callback_then_removed() {
    let mut store = MemoryPkceStore::default();
    start_sign_in(&mut store, &pending());
    assert_eq!(store.len(), 1);
    let back = finish_sign_in(&mut store, "state-123").unwrap();
    assert_eq!(back, pending());
    assert_eq!(store.len(), 0, "nothing is left after the exchange");
}

#[test]
fn a_callback_with_another_state_is_refused_and_still_clears_the_store() {
    let mut store = MemoryPkceStore::default();
    start_sign_in(&mut store, &pending());
    assert_eq!(
        finish_sign_in(&mut store, "forged"),
        Err(PkceError::StateMismatch)
    );
    assert_eq!(store.len(), 0);
    assert_eq!(
        finish_sign_in(&mut store, "state-123"),
        Err(PkceError::Missing)
    );
}

#[test]
fn a_new_sign_in_replaces_an_old_pending_one() {
    let mut store = MemoryPkceStore::default();
    start_sign_in(&mut store, &pending());
    let mut second = pending();
    second.state = "state-456".into();
    start_sign_in(&mut store, &second);
    assert_eq!(store.len(), 1);
    assert_eq!(finish_sign_in(&mut store, "state-456").unwrap(), second);
}

#[test]
fn an_unreadable_pending_value_is_missing() {
    let mut store = MemoryPkceStore::default();
    store.set(admin_rust_core::auth::PKCE_KEY, "{not json");
    assert_eq!(finish_sign_in(&mut store, "x"), Err(PkceError::Missing));
    assert_eq!(store.len(), 0);
}
