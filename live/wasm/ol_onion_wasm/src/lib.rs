// =============================================================================
// ol_onion_wasm  -  WASM bindings for One Link onion routing
// =============================================================================
//
// Browser-side wrapper for the production ol_onion crate. The "private
// download" preview on /download/ uses this to demonstrate a real 3-hop
// Sphinx-style onion wrap, locally in the visitor's tab, with no network
// call. The wire bytes produced are byte-identical to what the daemon
// would emit for a real onion-routed transfer.
//
// License: AGPL-3.0-or-later
// =============================================================================

#![forbid(unsafe_code)]

use rand_core::OsRng;
use rand_core::RngCore;
use wasm_bindgen::prelude::*;
use x25519_dalek::{PublicKey as X25519PublicKey, StaticSecret as X25519StaticSecret};

use ol_onion::{
    build_onion, peel_one_layer, Circuit, HopDescriptor, OnionError, OnionPacket, PeelOutcome,
    HOP_ID_LEN, MAX_USER_PAYLOAD, ONION_PACKET_SIZE,
};

#[wasm_bindgen(start)]
pub fn _init() {
    #[cfg(feature = "debug-panic")]
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn ol_onion_version() -> String {
    ol_onion::VERSION.to_string()
}

/// Constants exposed for the UI to display.
#[wasm_bindgen(js_name = onionMaxUserPayload)]
pub fn onion_max_user_payload() -> u32 {
    MAX_USER_PAYLOAD as u32
}

#[wasm_bindgen(js_name = onionPacketSize)]
pub fn onion_packet_size() -> u32 {
    ONION_PACKET_SIZE as u32
}

// =============================================================================
// LIVE DEMO  -  full 3-hop onion wrap + peel, locally in the browser
// =============================================================================
//
// Generates 3 ephemeral hops with fresh X25519 keypairs, wraps a small
// payload in 3 nested AEAD layers, then peels each layer to prove the
// math holds. Returns metrics for the UI:
//
//   {
//     hops:            3,
//     payloadSize:     <bytes>,
//     packetSize:      <bytes>,
//     hopIds:          [hex, hex, hex],
//     hopPubkeys:      [hex, hex, hex],
//     peelStages:      ["forward", "forward", "deliver"],
//     deliveredHex:    <hex of recovered payload>,
//     deliveredMatches: true|false
//   }
//
// The visible result on the page: when the user clicks "Try private
// download," we show that a real circuit was built, the packet survived
// 3 peels, and the inner payload arrived intact at the destination.
// =============================================================================

#[wasm_bindgen(js_name = liveDemoRoundTrip)]
pub fn live_demo_round_trip(payload: &[u8]) -> Result<JsValue, JsError> {
    if payload.len() > MAX_USER_PAYLOAD {
        return Err(JsError::new(&format!(
            "payload too large: {} > {}",
            payload.len(),
            MAX_USER_PAYLOAD
        )));
    }

    let mut rng = OsRng;

    // --- generate 3 ephemeral hops ---
    let mut hop_secrets: Vec<X25519StaticSecret> = Vec::with_capacity(3);
    let mut hop_descriptors: Vec<HopDescriptor> = Vec::with_capacity(3);
    let mut hop_ids_hex: Vec<String> = Vec::with_capacity(3);
    let mut hop_pubkeys_hex: Vec<String> = Vec::with_capacity(3);

    for _ in 0..3 {
        let sk = X25519StaticSecret::random_from_rng(&mut rng);
        let pk = X25519PublicKey::from(&sk).to_bytes();
        let mut id = [0u8; HOP_ID_LEN];
        rng.fill_bytes(&mut id);
        hop_ids_hex.push(hex::encode(id));
        hop_pubkeys_hex.push(hex::encode(pk));
        hop_descriptors.push(HopDescriptor::new(id, pk));
        hop_secrets.push(sk);
    }

    let circuit = Circuit::new(hop_descriptors)
        .map_err(|e| JsError::new(&format!("ol_onion circuit: {e:?}")))?;

    // --- wrap ---
    let packet: OnionPacket =
        build_onion(&circuit, payload, &mut rng)
            .map_err(|e| JsError::new(&format!("ol_onion wrap: {e:?}")))?;

    // --- peel 3 layers in sequence ---
    let mut current_bytes: Vec<u8> = packet.encode();
    let mut peel_stages: Vec<&'static str> = Vec::with_capacity(3);
    let mut delivered: Option<Vec<u8>> = None;

    for sk in hop_secrets.iter() {
        let current_packet = OnionPacket::decode(&current_bytes)
            .map_err(|e| JsError::new(&format!("ol_onion parse: {e:?}")))?;
        match peel_one_layer(sk, &current_packet) {
            Ok(PeelOutcome::Forward { next_hop: _, inner_packet_bytes }) => {
                peel_stages.push("forward");
                current_bytes = inner_packet_bytes;
            }
            Ok(PeelOutcome::Deliver { payload: payload_bytes }) => {
                peel_stages.push("deliver");
                delivered = Some(payload_bytes.to_vec());
                break;
            }
            Err(e) => return Err(JsError::new(&format!("ol_onion peel: {e:?}"))),
        }
    }

    let delivered_bytes = delivered.unwrap_or_default();
    let delivered_matches = delivered_bytes.as_slice() == payload;

    // --- assemble JS object ---
    let obj = js_sys::Object::new();
    set(&obj, "hops", &JsValue::from_f64(3.0))?;
    set(&obj, "payloadSize", &JsValue::from_f64(payload.len() as f64))?;
    set(&obj, "packetSize", &JsValue::from_f64(ONION_PACKET_SIZE as f64))?;
    set(&obj, "hopIds", &str_vec_to_js(&hop_ids_hex))?;
    set(&obj, "hopPubkeys", &str_vec_to_js(&hop_pubkeys_hex))?;
    set(
        &obj,
        "peelStages",
        &str_vec_to_js(&peel_stages.iter().map(|s| s.to_string()).collect::<Vec<_>>()),
    )?;
    set(&obj, "deliveredHex", &JsValue::from_str(&hex::encode(&delivered_bytes)))?;
    set(&obj, "deliveredMatches", &JsValue::from_bool(delivered_matches))?;
    Ok(obj.into())
}

fn str_vec_to_js(v: &[String]) -> JsValue {
    let arr = js_sys::Array::new();
    for s in v {
        arr.push(&JsValue::from_str(s));
    }
    arr.into()
}

fn set(o: &js_sys::Object, k: &str, v: &JsValue) -> Result<(), JsError> {
    js_sys::Reflect::set(o, &JsValue::from_str(k), v)
        .map(|_| ())
        .map_err(|e| JsError::new(&format!("set {k}: {e:?}")))
}
