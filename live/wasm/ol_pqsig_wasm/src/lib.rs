// =============================================================================
// ol_pqsig_wasm  -  WASM bindings for One Link PQ-hybrid signatures
// =============================================================================
//
// Real Ed25519 + ML-DSA-65 hybrid signature scheme, in the browser, using the
// exact same `ol_pqsig` crate the daemon uses. The visitor can mint a fresh
// hybrid identity, sign a message, and watch both the classical and PQ halves
// verify.
//
// Wire layout (matches daemon):
//   HybridVerifyingKey  = ed25519_pk  (32)   || ml_dsa_pk  (1952)  = 1984 bytes
//   HybridSigningKey    = ed25519_seed (32)  || ml_dsa_seed (32)   = 64 bytes
//   HybridSignature     = ed25519_sig (64)   || ml_dsa_sig (3309)  = 3373 bytes
//
// License: AGPL-3.0-or-later
// =============================================================================

#![forbid(unsafe_code)]

use rand_core::OsRng;
use wasm_bindgen::prelude::*;

use ol_pqsig::{
    HybridSigningKey, HybridVerifyingKey,
    ED25519_SIG_LEN, ED25519_VK_LEN, HYBRID_SIG_LEN, HYBRID_SK_LEN, HYBRID_VK_LEN,
    ML_DSA_65_SIG_LEN, ML_DSA_65_VK_LEN,
};

#[wasm_bindgen(start)]
pub fn _init() {
    #[cfg(feature = "debug-panic")]
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn ol_pqsig_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

/// Wire lengths exposed to JS so the bridge can sanity-check buffer sizes.
#[wasm_bindgen(getter_with_clone)]
pub struct PqSigSizes {
    pub verifying_key_bytes: u32,
    pub signing_key_bytes: u32,
    pub signature_bytes: u32,
    pub ed25519_vk_bytes: u32,
    pub ed25519_sig_bytes: u32,
    pub ml_dsa_vk_bytes: u32,
    pub ml_dsa_sig_bytes: u32,
}

#[wasm_bindgen(js_name = pqSigSizes)]
pub fn pq_sig_sizes() -> PqSigSizes {
    PqSigSizes {
        verifying_key_bytes: HYBRID_VK_LEN as u32,
        signing_key_bytes: HYBRID_SK_LEN as u32,
        signature_bytes: HYBRID_SIG_LEN as u32,
        ed25519_vk_bytes: ED25519_VK_LEN as u32,
        ed25519_sig_bytes: ED25519_SIG_LEN as u32,
        ml_dsa_vk_bytes: ML_DSA_65_VK_LEN as u32,
        ml_dsa_sig_bytes: ML_DSA_65_SIG_LEN as u32,
    }
}

// =============================================================================
// Owned hybrid signing handle
// =============================================================================

#[wasm_bindgen]
pub struct OlPqSigKeypair {
    sk: HybridSigningKey,
    vk: HybridVerifyingKey,
}

#[wasm_bindgen]
impl OlPqSigKeypair {
    /// Generate a fresh Ed25519 + ML-DSA-65 hybrid identity using the
    /// browser-side CSPRNG (getrandom -> Web Crypto).
    #[wasm_bindgen(constructor)]
    pub fn new() -> OlPqSigKeypair {
        let mut rng = OsRng;
        let (sk, vk) = HybridSigningKey::generate(&mut rng);
        OlPqSigKeypair { sk, vk }
    }

    /// Serialize the verifying key to wire bytes (1984 bytes:
    /// 32-byte Ed25519 pubkey + 1952-byte ML-DSA-65 pubkey).
    #[wasm_bindgen(getter, js_name = verifyingKeyBytes)]
    pub fn verifying_key_bytes(&self) -> Vec<u8> {
        self.vk.to_bytes().to_vec()
    }

    /// Sign a message with both halves. Returns the 3373-byte hybrid
    /// signature: `ed25519_sig (64) || ml_dsa_sig (3309)`.
    #[wasm_bindgen(js_name = sign)]
    pub fn sign(&self, message: &[u8]) -> Result<Vec<u8>, JsError> {
        let sig = self
            .sk
            .sign(message)
            .map_err(|e| JsError::new(&format!("ol_pqsig sign: {e:?}")))?;
        Ok(sig.to_vec())
    }
}

// =============================================================================
// Stateless verify
// =============================================================================

/// Verify a hybrid signature against a verifying key. Returns `true` only if
/// BOTH the Ed25519 and ML-DSA-65 halves pass. Constant-time wrt which half
/// fails (the underlying crate intentionally runs both verify paths).
#[wasm_bindgen(js_name = verify)]
pub fn verify(vk_bytes: &[u8], message: &[u8], sig: &[u8]) -> Result<bool, JsError> {
    let vk = HybridVerifyingKey::from_bytes(vk_bytes)
        .map_err(|e| JsError::new(&format!("ol_pqsig vk: {e:?}")))?;
    Ok(vk.verify(message, sig).is_ok())
}

// =============================================================================
// In-browser round-trip demo
// =============================================================================

/// Generate -> sign -> verify -> tampered-verify, all locally in the visitor's
/// tab. Returns a structured result for the /security/ page to render.
#[wasm_bindgen(js_name = liveDemoRoundTrip)]
pub fn live_demo_round_trip(message: &[u8]) -> Result<JsValue, JsError> {
    let mut rng = OsRng;
    let (sk, vk) = HybridSigningKey::generate(&mut rng);

    let sig = sk
        .sign(message)
        .map_err(|e| JsError::new(&format!("ol_pqsig sign: {e:?}")))?;

    let verified_ok = vk.verify(message, &sig).is_ok();

    // Tamper: flip a single bit in the first byte of the message, prove the
    // signature stops verifying.
    let mut tampered = message.to_vec();
    if !tampered.is_empty() {
        tampered[0] ^= 0x01;
    } else {
        tampered.push(0x01);
    }
    let verified_tampered = vk.verify(&tampered, &sig).is_ok();

    // Tamper the SIGNATURE this time (flip a byte in the ML-DSA half, which
    // exercises the PQ verifier).
    let mut tampered_sig = sig.to_vec();
    let pq_idx = ED25519_SIG_LEN + ML_DSA_65_SIG_LEN / 2;
    tampered_sig[pq_idx] ^= 0x01;
    let verified_tampered_sig = vk.verify(message, &tampered_sig).is_ok();

    let vk_bytes = vk.to_bytes();

    let obj = js_sys::Object::new();
    set(&obj, "verifyingKey",      &js_sys::Uint8Array::from(&vk_bytes[..]).into())?;
    set(&obj, "signature",         &js_sys::Uint8Array::from(&sig[..]).into())?;
    set(&obj, "verified",          &JsValue::from_bool(verified_ok))?;
    set(&obj, "verifiedTampered",  &JsValue::from_bool(verified_tampered))?;
    set(&obj, "verifiedTamperedSig",&JsValue::from_bool(verified_tampered_sig))?;
    set(&obj, "ed25519VkLen",      &JsValue::from_f64(ED25519_VK_LEN as f64))?;
    set(&obj, "ed25519SigLen",     &JsValue::from_f64(ED25519_SIG_LEN as f64))?;
    set(&obj, "mlDsaVkLen",        &JsValue::from_f64(ML_DSA_65_VK_LEN as f64))?;
    set(&obj, "mlDsaSigLen",       &JsValue::from_f64(ML_DSA_65_SIG_LEN as f64))?;
    set(&obj, "hybridVkLen",       &JsValue::from_f64(HYBRID_VK_LEN as f64))?;
    set(&obj, "hybridSigLen",      &JsValue::from_f64(HYBRID_SIG_LEN as f64))?;
    Ok(obj.into())
}

fn set(o: &js_sys::Object, k: &str, v: &JsValue) -> Result<(), JsError> {
    js_sys::Reflect::set(o, &JsValue::from_str(k), v)
        .map(|_| ())
        .map_err(|e| JsError::new(&format!("set {k}: {e:?}")))
}
