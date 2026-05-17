// =============================================================================
// ol_pair_qr_wasm  -  WASM bindings for the One Link pair-by-QR handshake.
// =============================================================================
//
// Thin wasm-bindgen wrapper around the production ol_pair_qr crate. JS gets
// two owned classes (OlInviter, OlScanner) and a few free functions. Every
// byte of cryptographic state stays Rust-side; we only hand JS the wire bytes
// and the human-readable SAS.
//
// Determinism + integrity invariants:
//   * Wire frames are byte-identical to what the daemon would produce because
//     this calls the SAME ol_pair_qr code path the daemon uses.
//   * RNG seeds come from getrandom (with the `js` feature, which routes to
//     window.crypto.getRandomValues in the browser).
//   * Inviter and Scanner state machines refuse out-of-order transitions; on
//     misuse we surface PairError as a JS exception string.
//
// License: AGPL-3.0-or-later (inherits from ol_pair_qr).
// =============================================================================

#![forbid(unsafe_code)]

use ed25519_dalek::SigningKey;
use rand_core::OsRng;
use wasm_bindgen::prelude::*;

use ol_pair_qr::invite::CapabilityScope;
use ol_pair_qr::{ChainKey, Inviter, PairError, Scanner};

/// Initialize the WASM module. Optional; bridge.js calls it once at boot
/// so we get readable panic messages in the browser console during dev.
#[wasm_bindgen(start)]
pub fn _init() {
    #[cfg(feature = "debug-panic")]
    console_error_panic_hook::set_once();
}

// =============================================================================
// VERSION + DIAGNOSTICS
// =============================================================================

/// Crate version of the underlying ol_pair_qr binding.
#[wasm_bindgen]
pub fn ol_pair_qr_version() -> String {
    ol_pair_qr::VERSION.to_string()
}

/// Protocol domain separator (constant, exposed for visibility tools).
#[wasm_bindgen]
pub fn ol_pair_qr_domain() -> String {
    String::from_utf8(ol_pair_qr::PROTOCOL_DOMAIN.to_vec()).unwrap_or_default()
}

// =============================================================================
// QR ENCODING
// =============================================================================

/// Encode arbitrary bytes into a QR code, returned as an inline-able SVG
/// string. Used to render the home-page invite QR so the displayed QR is
/// produced by the same toolchain that produces One Link wire frames.
///
/// Error-correction level Q ("quartile", 25 percent damage tolerance) is
/// chosen to survive screen photography + viewing angle distortion.
#[wasm_bindgen(js_name = encodeQrSvg)]
pub fn encode_qr_svg(payload: &[u8]) -> Result<String, JsError> {
    use qrcode::{render::svg, EcLevel, QrCode};

    let code = QrCode::with_error_correction_level(payload, EcLevel::Q)
        .map_err(|e| JsError::new(&format!("qr encode: {e:?}")))?;

    let svg = code
        .render::<svg::Color<'_>>()
        .min_dimensions(240, 240)
        .quiet_zone(true)
        .dark_color(svg::Color("#02040a"))
        .light_color(svg::Color("#ffffff"))
        .build();

    Ok(svg)
}

// =============================================================================
// INVITER  -  the device that GENERATES the QR
// =============================================================================

/// Owned Inviter handle. JS receives this from `OlInviter.new()` and uses it
/// across the rest of the handshake. Drop it from JS when done to zeroize.
#[wasm_bindgen]
pub struct OlInviter {
    inner: Inviter,
    invite_bytes: Vec<u8>,
}

#[wasm_bindgen]
impl OlInviter {
    /// Construct a fresh Inviter. Generates an Ed25519 identity key in-browser,
    /// builds + signs the Invite, returns an OlInviter holding the bytes you
    /// will render into a QR.
    ///
    /// `expiry_unix`: when the invite stops being valid (seconds since epoch).
    /// `capability_label`: arbitrary UTF-8, up to 64 bytes after canonical
    /// encoding; describes what the pairing grants ("contact:alice", etc).
    #[wasm_bindgen(constructor)]
    pub fn new(expiry_unix: u64, capability_label: &str) -> Result<OlInviter, JsError> {
        let mut rng = OsRng;
        let signing = SigningKey::generate(&mut rng);
        let scope = CapabilityScope::from_bytes(capability_label.as_bytes())
            .map_err(|e| JsError::new(&format!("invalid capability label: {e:?}")))?;
        let inviter = Inviter::new(signing, &mut rng, expiry_unix, scope);
        let invite_bytes = inviter.invite_bytes().to_vec();
        Ok(OlInviter { inner: inviter, invite_bytes })
    }

    /// QR-encodable bytes of the signed Invite. These ARE what the daemon
    /// would emit. Render them with the QR encoder of your choice; the
    /// scanner side parses them with `OlScanner.scan(bytes)`.
    #[wasm_bindgen(getter, js_name = inviteBytes)]
    pub fn invite_bytes(&self) -> Vec<u8> {
        self.invite_bytes.clone()
    }

    /// Hex-encoded invite bytes for display in dev tools / debugging.
    #[wasm_bindgen(getter, js_name = inviteHex)]
    pub fn invite_hex(&self) -> String {
        hex::encode(&self.invite_bytes)
    }

    /// Accept the scanner's PairResponse, verify it, derive the SAS the user
    /// should compare. Returns the 5-word SAS as a space-joined string.
    #[wasm_bindgen(js_name = receiveResponse)]
    pub fn receive_response(&mut self, response_bytes: &[u8]) -> Result<String, JsError> {
        self.inner.receive_response(response_bytes).map_err(pair_err)?;
        let sas = self
            .inner
            .sas()
            .ok_or_else(|| JsError::new("ol_pair_qr: SAS unavailable after response"))?;
        Ok(sas.display())
    }

    /// After the user confirms the SAS matches, complete the handshake.
    /// Returns `[confirm_bytes, chain_key_32bytes]` as a JS array.
    #[wasm_bindgen(js_name = confirm)]
    pub fn confirm(&mut self) -> Result<js_sys::Array, JsError> {
        let (confirm_bytes, chain_key) = self.inner.confirm().map_err(pair_err)?;
        let arr = js_sys::Array::new();
        arr.push(&js_sys::Uint8Array::from(&confirm_bytes[..]).into());
        arr.push(&js_sys::Uint8Array::from(chain_key.as_bytes().as_slice()).into());
        Ok(arr)
    }
}

// =============================================================================
// SCANNER  -  the device that READS the QR
// =============================================================================

/// Owned Scanner handle.
#[wasm_bindgen]
pub struct OlScanner {
    inner: Scanner,
    response_bytes: Vec<u8>,
}

#[wasm_bindgen]
impl OlScanner {
    /// Scan an invite (the bytes encoded in the QR), verify the signature,
    /// build a PairResponse. JS receives an OlScanner holding both the
    /// scanner state and the bytes to send back to the inviter.
    ///
    /// `now_unix`: scanner's wall-clock seconds-since-epoch. The invite is
    /// rejected if `expiry_unix <= now_unix`.
    #[wasm_bindgen]
    pub fn scan(invite_bytes: &[u8], now_unix: u64) -> Result<OlScanner, JsError> {
        let mut rng = OsRng;
        let signing = SigningKey::generate(&mut rng);
        let (scanner, response_bytes) =
            Scanner::scan(signing, invite_bytes, now_unix, &mut rng).map_err(pair_err)?;
        Ok(OlScanner {
            inner: scanner,
            response_bytes: response_bytes.to_vec(),
        })
    }

    /// Wire bytes to send back to the inviter (the PairResponse).
    #[wasm_bindgen(getter, js_name = responseBytes)]
    pub fn response_bytes(&self) -> Vec<u8> {
        self.response_bytes.clone()
    }

    /// Scanner-side SAS. Should match the inviter's SAS exactly if no MITM.
    #[wasm_bindgen(getter)]
    pub fn sas(&self) -> String {
        self.inner.sas().display()
    }

    /// Receive the inviter's PairConfirm; complete the handshake. Returns
    /// the 32-byte chain key.
    #[wasm_bindgen(js_name = receiveConfirm)]
    pub fn receive_confirm(&mut self, confirm_bytes: &[u8]) -> Result<Vec<u8>, JsError> {
        let chain_key: ChainKey = self
            .inner
            .receive_confirm(confirm_bytes)
            .map_err(pair_err)?;
        Ok(chain_key.as_bytes().to_vec())
    }
}

// =============================================================================
// FREE FUNCTIONS
// =============================================================================

/// Convenience: run a complete in-browser Inviter <-> Scanner round-trip for
/// the live demo card on the home page. Returns:
///   {
///     inviteBytes:   Uint8Array,
///     inviteHex:     String,
///     responseBytes: Uint8Array,
///     sasInviter:    String,  (5 words)
///     sasScanner:    String,  (5 words; must equal sasInviter)
///     confirmBytes:  Uint8Array,
///     chainKey:      Uint8Array, (32 bytes; both sides agree on this)
///     matched:       Boolean (sas equality)
///   }
#[wasm_bindgen(js_name = liveDemoRoundTrip)]
pub fn live_demo_round_trip() -> Result<JsValue, JsError> {
    let mut rng = OsRng;
    let inviter_sk = SigningKey::generate(&mut rng);
    let scanner_sk = SigningKey::generate(&mut rng);

    // Year 2030+: well beyond any reasonable demo session.
    let expiry: u64 = 1_900_000_000;
    let scope = CapabilityScope::from_bytes(b"demo:live")
        .map_err(|e| JsError::new(&format!("scope: {e:?}")))?;

    let mut inviter = Inviter::new(inviter_sk, &mut rng, expiry, scope);
    let invite_bytes = inviter.invite_bytes().to_vec();

    let (mut scanner, response_bytes) =
        Scanner::scan(scanner_sk, &invite_bytes, 100, &mut rng).map_err(pair_err)?;

    let sas_inviter = inviter.receive_response(&response_bytes).map_err(pair_err)?.clone();
    let sas_scanner = scanner.sas().clone();
    let matched = sas_inviter == sas_scanner;

    let (confirm_bytes, chain_key_i) = inviter.confirm().map_err(pair_err)?;
    let chain_key_s = scanner.receive_confirm(&confirm_bytes).map_err(pair_err)?;
    debug_assert_eq!(chain_key_i.as_bytes(), chain_key_s.as_bytes());

    let obj = js_sys::Object::new();
    set(&obj, "inviteBytes", &js_sys::Uint8Array::from(&invite_bytes[..]).into())?;
    set(&obj, "inviteHex",   &JsValue::from_str(&hex::encode(&invite_bytes)))?;
    set(&obj, "responseBytes", &js_sys::Uint8Array::from(&response_bytes[..]).into())?;
    set(&obj, "sasInviter", &JsValue::from_str(&sas_inviter.display()))?;
    set(&obj, "sasScanner", &JsValue::from_str(&sas_scanner.display()))?;
    set(&obj, "confirmBytes", &js_sys::Uint8Array::from(&confirm_bytes[..]).into())?;
    set(&obj, "chainKey", &js_sys::Uint8Array::from(chain_key_i.as_bytes().as_slice()).into())?;
    set(&obj, "matched", &JsValue::from_bool(matched))?;
    Ok(obj.into())
}

// =============================================================================
// helpers
// =============================================================================

fn pair_err(e: PairError) -> JsError {
    JsError::new(&format!("ol_pair_qr: {e:?}"))
}

fn set(o: &js_sys::Object, k: &str, v: &JsValue) -> Result<(), JsError> {
    js_sys::Reflect::set(o, &JsValue::from_str(k), v)
        .map(|_| ())
        .map_err(|e| JsError::new(&format!("set {k}: {e:?}")))
}
