// =============================================================================
// ol_threshold_recovery_wasm  -  Shamir K-of-N threshold sharing, in-browser
// =============================================================================
//
// Real Shamir secret sharing over GF(2^8), in the visitor's tab, using the
// exact same `ol_threshold_recovery` crate the daemon uses for identity
// master-key recovery. The visitor can split a secret into N shares,
// recover from any K, and SEE that fewer than K shares actually fail.
//
// License: AGPL-3.0-or-later
// =============================================================================

#![forbid(unsafe_code)]

use wasm_bindgen::prelude::*;

use ol_threshold_recovery::{
    reconstruct_bytes, share_bytes, PrngState,
};

#[wasm_bindgen(start)]
pub fn _init() {
    #[cfg(feature = "debug-panic")]
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn ol_threshold_recovery_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Generate a fresh 64-bit PRNG seed from the browser's CSPRNG.
fn seed_from_browser() -> u64 {
    let mut buf = [0u8; 8];
    // getrandom in the wasm32-unknown-unknown target uses crypto.getRandomValues.
    getrandom::getrandom(&mut buf).expect("browser CSPRNG must be available");
    u64::from_le_bytes(buf)
}

/// Split `secret` into `n` shares such that any `k` reconstruct, any `k-1`
/// cannot. Returns a JS array of N share-streams (each is a Uint8Array of
/// the same length as the secret).
#[wasm_bindgen(js_name = splitSecret)]
pub fn split_secret(secret: &[u8], k: u32, n: u32) -> Result<js_sys::Array, JsError> {
    let mut state = PrngState::new(seed_from_browser());
    let streams = share_bytes(secret, k, n, &mut state)
        .map_err(|e| JsError::new(&format!("ol_threshold_recovery split: {e:?}")))?;
    let out = js_sys::Array::new();
    for s in &streams {
        out.push(&js_sys::Uint8Array::from(s.as_slice()).into());
    }
    Ok(out)
}

/// Reconstruct a secret from at least `k` of the `n` shares. `xs` is the
/// 1-indexed x-coordinate vector (typically [1, 2, ..., n] truncated to
/// the indices the caller chose to include).
#[wasm_bindgen(js_name = reconstructSecret)]
pub fn reconstruct_secret(
    xs: &[u8],
    streams_flat: &[u8],
    secret_len: u32,
    k: u32,
) -> Result<Vec<u8>, JsError> {
    let sl = secret_len as usize;
    let provided = xs.len();
    if streams_flat.len() != provided * sl {
        return Err(JsError::new(&format!(
            "streams_flat length {} != provided * secret_len {} * {}",
            streams_flat.len(),
            provided,
            sl
        )));
    }
    let mut stream_refs: Vec<&[u8]> = Vec::with_capacity(provided);
    for i in 0..provided {
        let lo = i * sl;
        stream_refs.push(&streams_flat[lo..lo + sl]);
    }
    let result = reconstruct_bytes(xs, &stream_refs, k)
        .map_err(|e| JsError::new(&format!("ol_threshold_recovery reconstruct: {e:?}")))?;
    Ok(result)
}

// =============================================================================
// In-browser round-trip demo
// =============================================================================

/// Full "split-five, recover-from-three, fail-with-two" demo, all locally.
/// Returns a JS object the /security/ page can render directly.
#[wasm_bindgen(js_name = liveDemoRoundTrip)]
pub fn live_demo_round_trip(secret: &[u8], k: u32, n: u32) -> Result<JsValue, JsError> {
    let mut state = PrngState::new(seed_from_browser());
    let streams = share_bytes(secret, k, n, &mut state)
        .map_err(|e| JsError::new(&format!("split: {e:?}")))?;

    // 1) Recover with exactly K shares (the first K by index): must succeed.
    let xs_full: Vec<u8> = (1..=n as u8).collect();
    let xs_k: Vec<u8> = xs_full[..k as usize].to_vec();
    let stream_refs_k: Vec<&[u8]> = streams[..k as usize].iter().map(|v| v.as_slice()).collect();
    let recovered = reconstruct_bytes(&xs_k, &stream_refs_k, k)
        .map_err(|e| JsError::new(&format!("recover K: {e:?}")))?;
    let recovered_ok = recovered == secret;

    // 2) Try to recover with K-1 shares: the crate refuses (NotEnoughShares).
    //    We capture the error message to surface in the demo.
    let recover_kminus_err = if k > 1 {
        let xs_km1: Vec<u8> = xs_full[..(k as usize - 1)].to_vec();
        let stream_refs_km1: Vec<&[u8]> = streams[..(k as usize - 1)].iter().map(|v| v.as_slice()).collect();
        match reconstruct_bytes(&xs_km1, &stream_refs_km1, k) {
            Err(e) => format!("{e}"),
            Ok(_) => "BUG: K-1 shares reconstructed (should have failed)".to_string(),
        }
    } else {
        "k=1 - K-1 has 0 shares, demo not meaningful".to_string()
    };

    // 3) Recover with a DIFFERENT K subset (mid-range share indices):
    //    must produce the same secret bytes (any-K-suffices property).
    let mut xs_alt: Vec<u8> = Vec::new();
    let mut stream_refs_alt: Vec<&[u8]> = Vec::new();
    if n >= k && k >= 1 {
        // pick shares [n-k+1 .. n] (last K)
        let lo = (n - k) as usize;
        for i in lo..n as usize {
            xs_alt.push(xs_full[i]);
            stream_refs_alt.push(streams[i].as_slice());
        }
    }
    let recovered_alt_ok = if !xs_alt.is_empty() {
        match reconstruct_bytes(&xs_alt, &stream_refs_alt, k) {
            Ok(out) => out == secret,
            Err(_) => false,
        }
    } else {
        true
    };

    // Surface representative wire details: lengths + first 3 shares' first
    // 8 hex bytes so the visitor sees they look random.
    let share_previews = js_sys::Array::new();
    for s in streams.iter().take(3) {
        let preview = &s[..s.len().min(8)];
        let hex: String = preview.iter().map(|b| format!("{:02x}", b)).collect();
        share_previews.push(&JsValue::from_str(&hex));
    }

    let obj = js_sys::Object::new();
    set(&obj, "secretLen",          &JsValue::from_f64(secret.len() as f64))?;
    set(&obj, "k",                  &JsValue::from_f64(k as f64))?;
    set(&obj, "n",                  &JsValue::from_f64(n as f64))?;
    set(&obj, "shareLen",           &JsValue::from_f64(streams.first().map(|s| s.len()).unwrap_or(0) as f64))?;
    set(&obj, "recoveredWithKOk",   &JsValue::from_bool(recovered_ok))?;
    set(&obj, "recoveredWithAltK",  &JsValue::from_bool(recovered_alt_ok))?;
    set(&obj, "recoveredKMinusErr", &JsValue::from_str(&recover_kminus_err))?;
    set(&obj, "sharePreviews",      &share_previews.into())?;
    set(&obj, "recoveredBytes",     &js_sys::Uint8Array::from(recovered.as_slice()).into())?;
    Ok(obj.into())
}

fn set(o: &js_sys::Object, k: &str, v: &JsValue) -> Result<(), JsError> {
    js_sys::Reflect::set(o, &JsValue::from_str(k), v)
        .map(|_| ())
        .map_err(|e| JsError::new(&format!("set {k}: {e:?}")))
}
