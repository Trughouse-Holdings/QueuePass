//! Parity S3, S8, S16 (`customer-app/src/use-load.ts`): loads one page's data with the
//! customer's own token; a new key starts a new load, and an answer to an older key is dropped.

use std::future::Future;

use customer_rust_core::{
    api::client::{ApiClient, ApiError},
    load::Load,
};
use leptos::{prelude::*, task::spawn_local};

use crate::auth::use_auth;

/// Loads `fetch(api, key)` each time `key()` changes; the state starts at `Loading` each time.
pub fn use_load<K, T, F, Fut>(key: impl Fn() -> K + 'static, fetch: F) -> RwSignal<Load<T>>
where
    K: PartialEq + Clone + 'static,
    T: Send + Sync + 'static,
    F: Fn(ApiClient, K) -> Fut + 'static,
    Fut: Future<Output = Result<T, ApiError>> + 'static,
{
    let auth = use_auth();
    let state = RwSignal::new(Load::Loading);
    let asked = StoredValue::new(0u64);
    Effect::new(move |prev: Option<K>| {
        let k = key();
        if prev.as_ref() == Some(&k) {
            return k;
        }
        let ticket = asked.get_value() + 1;
        asked.set_value(ticket);
        state.set(Load::Loading);
        let fut = fetch(auth.api(), k.clone());
        spawn_local(async move {
            let result = fut.await;
            if asked.try_get_value() != Some(ticket) {
                return;
            }
            state.set(Load::from_result(result));
        });
        k
    });
    state
}
