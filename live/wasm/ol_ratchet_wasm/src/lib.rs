// =============================================================================
// ol_ratchet_wasm  -  Per-chunk forward-secret ratchet, in-browser
// =============================================================================
//
// Real per-chunk forward-secret ratchet (One Link's `ol_ratchet`), in the
// visitor's tab. Demonstrates the forward-secrecy property: the visitor sees
// a chain of message keys, each one byte-distinct from the next, and the
// crate refuses to rewind the chain. Compromising key[i] cannot derive
// key[i+1] because the chain step is a one-way KDF.
//
// License: AGPL-3.0-or-later
// =============================================================================

#![forbid(unsafe_code)]

use wasm_bindgen::prelude::*;

use ol_ratchet::{Chain, ChainKey};

#[wasm_bindgen(start)]
pub fn _init() {
    #[cfg(feature = "debug-panic")]
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn ol_ratchet_version() -> String {
    ol_ratchet::VERSION.to_string()
}

fn random_chain_key() -> ChainKey {
    let mut buf = [0u8; 32];
    getrandom::getrandom(&mut buf).expect("browser CSPRNG must be available");
    ChainKey::new(buf)
}

// =============================================================================
// In-browser round-trip demo
// =============================================================================

/// Generate a fresh chain, derive `n_keys` message keys, return all of them
/// + the chain-rewind error so the /security/ page can show forward secrecy
/// visibly. Each message key is 32 bytes. The crate refuses to rewind, which
/// we surface as well.
#[wasm_bindgen(js_name = liveDemoRoundTrip)]
pub fn live_demo_round_trip(n_keys: u32) -> Result<JsValue, JsError> {
    let n = n_keys.min(16).max(2) as usize;
    let root = random_chain_key();
    let root_preview: String = root.iter().take(8).map(|b| format!("{:02x}", b)).collect();

    let mut chain = Chain::from_chain_key(root);

    // Derive n message keys, capturing the first 8 hex bytes of each for the
    // visitor to see.
    let key_previews = js_sys::Array::new();
    let mut all_distinct = true;
    let mut seen: Vec<Vec<u8>> = Vec::with_capacity(n);
    for _ in 0..n {
        let mk = chain.next_message_key();
        let preview: String = mk.iter().take(8).map(|b| format!("{:02x}", b)).collect();
        key_previews.push(&JsValue::from_str(&preview));
        let bytes: Vec<u8> = mk.to_vec();
        if seen.iter().any(|prev| prev == &bytes) {
            all_distinct = false;
        }
        seen.push(bytes);
    }
    let final_step = chain.step();

    // Demonstrate the rewind refusal: peek a step BEHIND current.
    // peek_message_key with step < self.step returns RatchetError::Rewind.
    let rewind_err = match chain.peek_message_key(0) {
        Err(e) => format!("{e}"),
        Ok(_) => "BUG: rewind succeeded".to_string(),
    };

    // Demonstrate the skip cap: peek_message_key past MAX_SKIP_STEPS fails.
    let skip_err = match chain.peek_message_key(final_step + ol_ratchet::MAX_SKIP_STEPS + 1) {
        Err(e) => format!("{e}"),
        Ok(_) => "BUG: oversized skip succeeded".to_string(),
    };

    let obj = js_sys::Object::new();
    set(&obj, "nKeys",         &JsValue::from_f64(n as f64))?;
    set(&obj, "messageKeyLen", &JsValue::from_f64(32.0))?;
    set(&obj, "chainKeyLen",   &JsValue::from_f64(32.0))?;
    set(&obj, "rootPreview",   &JsValue::from_str(&root_preview))?;
    set(&obj, "finalStep",     &JsValue::from_f64(final_step as f64))?;
    set(&obj, "keyPreviews",   &key_previews.into())?;
    set(&obj, "allDistinct",   &JsValue::from_bool(all_distinct))?;
    set(&obj, "rewindErr",     &JsValue::from_str(&rewind_err))?;
    set(&obj, "skipErr",       &JsValue::from_str(&skip_err))?;
    set(&obj, "maxSkipSteps",  &JsValue::from_f64(ol_ratchet::MAX_SKIP_STEPS as f64))?;
    Ok(obj.into())
}

fn set(o: &js_sys::Object, k: &str, v: &JsValue) -> Result<(), JsError> {
    js_sys::Reflect::set(o, &JsValue::from_str(k), v)
        .map(|_| ())
        .map_err(|e| JsError::new(&format!("set {k}: {e:?}")))
}
