// =============================================================================
// ol_coherence_field_wasm  -  WASM bindings for One Link coherence field
// =============================================================================
//
// Wraps the production `ol_coherence_field` crate so the browser can solve a
// real Helmholtz equation on a small peer-graph in-tab. The math here is
// BYTE-IDENTICAL to what the daemon computes for tau_c routing decisions on
// the real mesh: the only difference is that the browser uses the serial
// matvec path (rayon cfg-gated out for wasm32). For small graphs (hundreds
// of peers) that is the daemon's chosen path anyway.
//
// Exposed entry: a minimal `coherenceFieldStep(n, edges_flat, weights, ...)`
// that takes a flat-encoded adjacency + edge weights + source vector and
// returns the Helmholtz steady-state at every node. JS uses this to colour
// peer dots by their local field intensity.
//
// License: AGPL-3.0-or-later
// =============================================================================

#![forbid(unsafe_code)]

use wasm_bindgen::prelude::*;

use ol_coherence_field::{solve_helmholtz, CgConfig, GraphLaplacian};

#[wasm_bindgen(start)]
pub fn _init() {
    #[cfg(feature = "debug-panic")]
    console_error_panic_hook::set_once();
}

#[wasm_bindgen]
pub fn ol_coherence_field_version() -> String {
    ol_coherence_field::VERSION.to_string()
}

/// Solve the steady-state Helmholtz equation
///
///     (D L + gamma I) phi = source
///
/// on a small peer graph with the same solver the daemon uses for tau_c
/// routing. Returns the field values at every node, length `n_nodes`.
///
/// `edges_flat` is a Uint32Array of `[u, v, u, v, ...]` pairs.
/// `edge_weights` is a Float64Array of the same length as the pair count
/// (so `edges_flat.len() / 2`).
/// `source` is a Float64Array of length `n_nodes`.
#[wasm_bindgen(js_name = solveSteadyHelmholtz)]
pub fn solve_steady_helmholtz(
    n_nodes: u32,
    edges_flat: &[u32],
    edge_weights: &[f64],
    source: &[f64],
    diffusion: f64,
    gamma: f64,
) -> Result<Vec<f64>, JsError> {
    let n = n_nodes as usize;
    if source.len() != n {
        return Err(JsError::new(&format!(
            "source length {} != n_nodes {}",
            source.len(),
            n
        )));
    }
    if edges_flat.len() % 2 != 0 {
        return Err(JsError::new("edges_flat length must be even"));
    }
    let n_edges = edges_flat.len() / 2;
    if edge_weights.len() != n_edges {
        return Err(JsError::new(&format!(
            "edge_weights length {} != edge pairs {}",
            edge_weights.len(),
            n_edges
        )));
    }

    let mut graph = GraphLaplacian::new(n);
    for i in 0..n_edges {
        graph
            .add_edge(
                edges_flat[2 * i] as usize,
                edges_flat[2 * i + 1] as usize,
                edge_weights[i],
            )
            .map_err(|e| JsError::new(&format!("graph edge {i}: {e:?}")))?;
    }

    let cfg = CgConfig::default();
    let result = solve_helmholtz(&graph, diffusion, gamma, source, cfg)
        .map_err(|e| JsError::new(&format!("solve: {e:?}")))?;

    Ok(result.field)
}
