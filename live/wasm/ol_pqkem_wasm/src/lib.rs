// =============================================================================
// ol_pqkem_wasm  -  WASM bindings for One Link PQ-hybrid KEM
// =============================================================================
//
// Real X25519 + ML-KEM-768 hybrid key encapsulation, in the browser, using
// the exact same `ol_pqkem` crate the daemon uses. The browser can now
// negotiate a post-quantum session shared secret with the relay that is
// byte-identical to what the daemon would compute.
//
// Wire format:
//   HybridPublicKey  = ml_kem_ek (1184)  || x25519_pk     (32)   = 1216 bytes
//   HybridCiphertext = ml_kem_ct (1088)  || x25519_eph_pk (32)   = 1120 bytes
//   SharedSecret     = blake3(combiner)                          =   32 bytes
//
// License: AGPL-3.0-or-later
// =============================================================================

#![forbid(unsafe_code)]

use rand_core::OsRng;
use wasm_bindgen::prelude::*;

use ol_pqkem::{
    decapsulate, encapsulate, keypair, HybridCiphertext, HybridPublicKey, HybridSecretKey,
    HYBRID_CIPHERTEXT_LEN, HYBRID_PUBLIC_KEY_LEN, HYBRID_SECRET_KEY_LEN, SHARED_SECRET_LEN,
};

#[wasm_bindgen(start)]
pub fn _init() {
    #[cfg(feature = "debug-panic")]
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn ol_pqkem_version() -> String {
    ol_pqkem::VERSION.to_string()
}

/// Wire lengths exposed to JS so the bridge can validate buffer sizes
/// before sending bytes over the network.
#[wasm_bindgen(getter_with_clone)]
pub struct PqKemSizes {
    pub public_key_bytes: u32,
    pub secret_key_bytes: u32,
    pub ciphertext_bytes: u32,
    pub shared_secret_bytes: u32,
}

#[wasm_bindgen(js_name = pqKemSizes)]
pub fn pq_kem_sizes() -> PqKemSizes {
    PqKemSizes {
        public_key_bytes: HYBRID_PUBLIC_KEY_LEN as u32,
        secret_key_bytes: HYBRID_SECRET_KEY_LEN as u32,
        ciphertext_bytes: HYBRID_CIPHERTEXT_LEN as u32,
        shared_secret_bytes: SHARED_SECRET_LEN as u32,
    }
}

// =============================================================================
// Owned keypair handle
// =============================================================================

#[wasm_bindgen]
pub struct OlPqKemKeypair {
    public: HybridPublicKey,
    secret: HybridSecretKey,
}

#[wasm_bindgen]
impl OlPqKemKeypair {
    /// Generate a fresh hybrid keypair using browser-side CSPRNG.
    #[wasm_bindgen(constructor)]
    pub fn new() -> OlPqKemKeypair {
        let mut rng = OsRng;
        let (public, secret) = keypair(&mut rng);
        OlPqKemKeypair { public, secret }
    }

    /// Serialize the public key to wire bytes (1216 bytes).
    #[wasm_bindgen(getter, js_name = publicKeyBytes)]
    pub fn public_key_bytes(&self) -> Vec<u8> {
        self.public.to_bytes().to_vec()
    }

    /// Decapsulate a hybrid ciphertext from the peer, returning the 32-byte
    /// shared secret. Both sides arrive at the same value if the math holds.
    #[wasm_bindgen(js_name = decapsulate)]
    pub fn decapsulate_bytes(&self, ct_bytes: &[u8]) -> Result<Vec<u8>, JsError> {
        let ct = HybridCiphertext::from_bytes(ct_bytes)
            .map_err(|e| JsError::new(&format!("ol_pqkem ct: {e:?}")))?;
        let ss = decapsulate(&self.secret, &ct)
            .map_err(|e| JsError::new(&format!("ol_pqkem decap: {e:?}")))?;
        Ok(ss.to_vec())
    }
}

// =============================================================================
// Initiator-side: encapsulate against a peer public key
// =============================================================================

/// Encapsulate a fresh shared secret against the given peer hybrid public key.
/// Returns `[ciphertext_bytes, shared_secret_bytes]`.
///
/// Used by the browser-side session-start flow: fetch the relay's hybrid
/// pubkey from `/api/session`, call this to derive `(ct, ss)`, send `ct`
/// back, both sides now hold the same `ss`.
#[wasm_bindgen(js_name = encapsulateAgainst)]
pub fn encapsulate_against(peer_pubkey_bytes: &[u8]) -> Result<js_sys::Array, JsError> {
    let peer = HybridPublicKey::from_bytes(peer_pubkey_bytes)
        .map_err(|e| JsError::new(&format!("ol_pqkem peer pk: {e:?}")))?;
    let mut rng = OsRng;
    let (ct, ss) = encapsulate(&peer, &mut rng)
        .map_err(|e| JsError::new(&format!("ol_pqkem encap: {e:?}")))?;
    let arr = js_sys::Array::new();
    arr.push(&js_sys::Uint8Array::from(&ct.to_bytes()[..]).into());
    arr.push(&js_sys::Uint8Array::from(&ss[..]).into());
    Ok(arr)
}

// =============================================================================
// In-browser round-trip demo (Inviter + Responder, both sides locally)
// =============================================================================

/// Full Alice <-> Bob KEM round-trip in the visitor's tab. Both halves run
/// locally; returns:
///   {
///     alicePub:        Uint8Array (1216),
///     bobCiphertext:   Uint8Array (1120),
///     bobSharedSecret: Uint8Array (32),
///     aliceSharedSecret: Uint8Array (32),
///     matched:         Boolean (must be true if the math holds)
///   }
#[wasm_bindgen(js_name = liveDemoRoundTrip)]
pub fn live_demo_round_trip() -> Result<JsValue, JsError> {
    let mut rng = OsRng;
    let (alice_pub, alice_sk) = keypair(&mut rng);
    let (ct, bob_ss) = encapsulate(&alice_pub, &mut rng)
        .map_err(|e| JsError::new(&format!("ol_pqkem encap: {e:?}")))?;
    let alice_ss = decapsulate(&alice_sk, &ct)
        .map_err(|e| JsError::new(&format!("ol_pqkem decap: {e:?}")))?;
    let matched: bool = alice_ss[..] == bob_ss[..];

    let obj = js_sys::Object::new();
    set(&obj, "alicePub", &js_sys::Uint8Array::from(&alice_pub.to_bytes()[..]).into())?;
    set(&obj, "bobCiphertext", &js_sys::Uint8Array::from(&ct.to_bytes()[..]).into())?;
    set(&obj, "bobSharedSecret", &js_sys::Uint8Array::from(&bob_ss[..]).into())?;
    set(&obj, "aliceSharedSecret", &js_sys::Uint8Array::from(&alice_ss[..]).into())?;
    set(&obj, "matched", &JsValue::from_bool(matched))?;
    Ok(obj.into())
}

fn set(o: &js_sys::Object, k: &str, v: &JsValue) -> Result<(), JsError> {
    js_sys::Reflect::set(o, &JsValue::from_str(k), v)
        .map(|_| ())
        .map_err(|e| JsError::new(&format!("set {k}: {e:?}")))
}
