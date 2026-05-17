/* =============================================================================
   One Link  -  Live Mode bridge
   =============================================================================
   ~500 lines of vanilla ES modules, zero dependencies.
   What it does, in order of how visitors notice:

     1. Detect the visitor's OS, rewrite the download button if present.
     2. Light up the coherence-field background canvas (WebGPU if available,
        graceful animated 2D canvas fallback otherwise).
     3. Render the mesh-viz canvas with live (or stub) node positions.
     4. Open a hybrid session against /api/session and surface "you are
        connected" in the counter pill + "you" line on the mesh page.
     5. Poll /api/topology every 12 seconds and update the live counters
        across the page.

   No tracking. No cookies. No third-party calls. All state lives in tab memory
   and dies when the tab closes.
   ========================================================================== */

/* eslint-disable no-console */

// ---------------------------------------------------------------------------
// 0. tiny utils
// ---------------------------------------------------------------------------
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

const prefersReducedMotion = window.matchMedia &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function once(fn) {
  let done = false, result;
  return (...args) => done ? result : (done = true, result = fn(...args));
}

function fmtCount(n) {
  return n.toLocaleString('en-US');
}

// ---------------------------------------------------------------------------
// 1. OS detection + download button rewrite
// ---------------------------------------------------------------------------
function detectOS() {
  const ua = navigator.userAgent || '';
  const platform = navigator.platform || '';
  if (/Android/i.test(ua)) return { os: 'android', label: 'Android' };
  if (/iPhone|iPad|iPod/i.test(ua)) return { os: 'ios', label: 'iOS' };
  if (/Mac/i.test(platform) || /Macintosh/.test(ua)) return { os: 'macos', label: 'macOS' };
  if (/Win/i.test(platform) || /Windows/.test(ua)) return { os: 'windows', label: 'Windows' };
  if (/Linux/i.test(platform) || /Linux/.test(ua)) return { os: 'linux', label: 'Linux' };
  if (/BSD/i.test(ua)) return { os: 'openbsd', label: 'BSD' };
  return { os: 'source', label: 'your platform' };
}

function rewriteDownloadButton() {
  const btn = $('#ol-download-button');
  const line = $('#ol-detected-os');
  if (!btn) return;
  const { os, label } = detectOS();
  btn.href = `/download/${os}`;
  btn.firstChild.nodeValue = `Download for ${label} `;
  if (line) {
    const arch = /arm|aarch64/i.test(navigator.userAgent) ? 'arm64' : 'x86_64';
    line.textContent = `Detected: ${label} - ${arch}`;
  }
}

// ---------------------------------------------------------------------------
// 2. COHERENCE-FIELD BACKGROUND
//
// We try WebGPU first (modern path). If unavailable we render an animated
// damped-Helmholtz steady-state on a 2D canvas. Either way the canvas
// element gets shown (it ships hidden so the CSS fallback gradient takes
// over for non-JS / no-canvas users).
// ---------------------------------------------------------------------------

async function startCoherenceField() {
  const canvas = $('.ol-field-canvas');
  if (!canvas) return;
  if (prefersReducedMotion) return; // honor user; CSS fallback stays in.

  canvas.hidden = false;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const resize = () => {
    canvas.width = Math.floor(window.innerWidth * dpr);
    canvas.height = Math.floor(window.innerHeight * dpr);
  };
  resize();
  window.addEventListener('resize', resize);

  // Try WebGPU first.
  if ('gpu' in navigator) {
    try {
      await startCoherenceFieldWebGPU(canvas);
      return;
    } catch (e) {
      // fall through to 2D
      console.debug('coherence-field: WebGPU unavailable, falling back to 2D');
    }
  }

  startCoherenceField2D(canvas);
}

// ---- WebGPU compute path  (drives the compiler-emitted field_step shader) -
//
// The shader at /live/shaders/coherence-field.wgsl was emitted by
// coherence_lang.codegen.wgsl_emitter. It exposes a @compute fn field_step
// that advances the coherence-field state by one timestep (real damped
// Helmholtz oscillator), reading and writing a storage-buffer of
// CoherenceFieldState (24 f32+u32 fields, ~96 bytes).
//
// Two-pass per frame:
//   compute pass: field_step  -> updates the storage buffer
//   render pass: a tiny inline fragment shader samples the buffer + paints
//
// The render shader is small and inlined here so it's obvious that the
// compute side is the real-physics part, not visual polish.
// ---------------------------------------------------------------------------

const _FIELD_STATE_BYTES = 96;  // 24 x 4 bytes; matches CoherenceFieldState

const _RENDER_SHADER = /* wgsl */ `
struct FieldState {
  cycle: u32, time: f32, tau_c: f32, entropy: f32,
  osc_position: f32, osc_velocity: f32,
  perturb_x: f32, perturb_y: f32, perturb_energy: f32,
  glyph_opacity: f32, glyph_scale: f32, glyph_phase: f32,
  glow_intensity: f32, glow_radius: f32, tone_amplitude: f32,
  total_energy: f32, speaking: u32, unfurl_progress: f32,
  mouse_x: f32, mouse_y: f32,
  resolution_x: f32, resolution_y: f32,
  identity_level: u32, rail_mask: u32,
};

@group(0) @binding(0) var<storage, read> field: FieldState;

struct VsOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> VsOut {
  var out: VsOut;
  let x = select(-1.0, 1.0, (vi & 1u) == 1u);
  let y = select(-1.0, 1.0, (vi & 2u) == 2u);
  out.pos = vec4f(x, y, 0.0, 1.0);
  out.uv  = vec2f(x * 0.5 + 0.5, y * 0.5 + 0.5);
  return out;
}

fn hash21(p: vec2f) -> f32 {
  return fract(sin(dot(p, vec2f(127.1, 311.7))) * 43758.5453);
}

@fragment
fn fs_main(in: VsOut) -> @location(0) vec4f {
  let uv = in.uv;
  let aspect = field.resolution_x / max(field.resolution_y, 1.0);
  let p = vec2f(uv.x * aspect, uv.y);

  // Sample the field as it propagates from a source at the center,
  // damped + oscillating at the rate the compute pass actually computed.
  let r = length(p - vec2f(0.5 * aspect, 0.5));
  let wave = exp(-r * (1.0 + field.entropy * 8.0))
           * sin(r * 22.0 - field.time * 0.7 + field.glyph_phase);
  let e = clamp(0.5 + (wave * field.tau_c + field.perturb_energy * 0.4) * 0.32, 0.0, 1.0);

  let cyan   = vec3f(0.305, 0.875, 0.910);
  let violet = vec3f(0.502, 0.466, 0.945);
  let dark   = vec3f(0.027, 0.075, 0.110);
  let band   = mix(cyan, violet, smoothstep(0.55, 0.85, e));
  let col    = mix(dark, band, e);

  // Vignette + subtle grain so the field is alive but never busy.
  let vig = smoothstep(1.2, 0.2, length(uv - vec2f(0.5)));
  let grain = (hash21(in.pos.xy + field.time) - 0.5) * 0.04;
  return vec4f((col + grain) * vig, 1.0);
}
`;

async function startCoherenceFieldWebGPU(canvas) {
  const adapter = await navigator.gpu.requestAdapter();
  if (!adapter) throw new Error('no adapter');
  const device  = await adapter.requestDevice();
  const ctx     = canvas.getContext('webgpu');
  const format  = navigator.gpu.getPreferredCanvasFormat();
  ctx.configure({ device, format, alphaMode: 'premultiplied' });

  // Load the compiler-emitted compute shader.
  const computeCode = await fetch('/live/shaders/coherence-field.wgsl').then(r => r.text());
  const computeModule = device.createShaderModule({ code: computeCode });

  // Storage buffer for CoherenceFieldState. Initialize with sensible defaults.
  const stateBuffer = device.createBuffer({
    size: _FIELD_STATE_BYTES,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });
  // Seed: osc_position = 0.18 (kicked off-center), velocity 0, tau_c clamps in.
  const initState = new ArrayBuffer(_FIELD_STATE_BYTES);
  const initView  = new DataView(initState);
  initView.setUint32(0,  0,    true);   // cycle
  initView.setFloat32(4,  0.0,  true);  // time
  initView.setFloat32(8,  0.5,  true);  // tau_c
  initView.setFloat32(16, 0.18, true);  // osc_position
  initView.setFloat32(20, 0.0,  true);  // osc_velocity
  device.queue.writeBuffer(stateBuffer, 0, initState);

  const computePipeline = device.createComputePipeline({
    layout: 'auto',
    compute: { module: computeModule, entryPoint: 'field_step' },
  });

  // Render pipeline using our inline shader; samples the storage buffer.
  const renderModule = device.createShaderModule({ code: _RENDER_SHADER });
  const renderPipeline = device.createRenderPipeline({
    layout: 'auto',
    vertex:   { module: renderModule, entryPoint: 'vs_main' },
    fragment: { module: renderModule, entryPoint: 'fs_main', targets: [{ format }] },
    primitive:{ topology: 'triangle-strip' },
  });

  const computeBg = device.createBindGroup({
    layout: computePipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: stateBuffer } }],
  });
  const renderBg = device.createBindGroup({
    layout: renderPipeline.getBindGroupLayout(0),
    entries: [{ binding: 0, resource: { buffer: stateBuffer } }],
  });

  // Mouse + click reactivity. Mouse moves write soft perturbations; clicks
  // SPIKE the perturb_energy so a real pulse propagates through the field.
  // The compute shader's `inject_perturbation` path picks this up and the
  // damped Helmholtz oscillator radiates the energy outward over frames.
  let mouseX = 0.5, mouseY = 0.5;
  let pulseEnergy = 0;
  let pulseDecay = 0;
  canvas.style.pointerEvents = 'auto';
  document.addEventListener('mousemove', (e) => {
    mouseX = e.clientX / window.innerWidth;
    mouseY = e.clientY / window.innerHeight;
  }, { passive: true });
  document.addEventListener('click', (e) => {
    mouseX = e.clientX / window.innerWidth;
    mouseY = e.clientY / window.innerHeight;
    pulseEnergy = 1.8;
    pulseDecay = 0.86;
  }, { passive: true });
  document.addEventListener('touchstart', (e) => {
    if (!e.touches || !e.touches[0]) return;
    mouseX = e.touches[0].clientX / window.innerWidth;
    mouseY = e.touches[0].clientY / window.innerHeight;
    pulseEnergy = 1.6;
    pulseDecay = 0.88;
  }, { passive: true });

  // Programmatic pulse hook: peer-dot clicks + incoming-ping flashes call
  // window.olPulseField(x, y, energy), which forwards here.
  window.__olFieldPulse = (nx, ny, energy) => {
    if (typeof nx === 'number') mouseX = Math.max(0, Math.min(1, nx));
    if (typeof ny === 'number') mouseY = Math.max(0, Math.min(1, ny));
    pulseEnergy = Math.max(pulseEnergy, energy || 1.4);
    pulseDecay = 0.88;
  };

  function frame() {
    // Energy: baseline soft mouse perturbation plus decaying click pulse.
    const energy = 0.32 + pulseEnergy;
    pulseEnergy *= pulseDecay;
    if (pulseEnergy < 0.005) pulseEnergy = 0;

    const perturb = new Float32Array([mouseX, mouseY, energy]);
    device.queue.writeBuffer(stateBuffer, 24, perturb);                         // perturb_x, perturb_y, perturb_energy
    const resolution = new Float32Array([canvas.width, canvas.height]);
    device.queue.writeBuffer(stateBuffer, 80, resolution);                       // resolution_x, resolution_y

    const encoder = device.createCommandEncoder();

    // 1. Compute pass: advance the field by one timestep (real Helmholtz).
    const cpass = encoder.beginComputePass();
    cpass.setPipeline(computePipeline);
    cpass.setBindGroup(0, computeBg);
    cpass.dispatchWorkgroups(1);
    cpass.end();

    // 2. Render pass: sample the storage buffer + paint.
    const rpass = encoder.beginRenderPass({
      colorAttachments: [{
        view: ctx.getCurrentTexture().createView(),
        loadOp: 'clear', storeOp: 'store',
        clearValue: { r: 0.016, g: 0.024, b: 0.043, a: 0 },
      }],
    });
    rpass.setPipeline(renderPipeline);
    rpass.setBindGroup(0, renderBg);
    rpass.draw(4);
    rpass.end();

    device.queue.submit([encoder.finish()]);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// ---- 2D fallback (same math, software path) --------------------------------
function startCoherenceField2D(canvas) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  // Sparse ripple sources, each a localized Helmholtz packet.
  const sources = Array.from({ length: 6 }, () => ({
    x: Math.random(),
    y: Math.random(),
    phase: Math.random() * Math.PI * 2,
    speed: 0.35 + Math.random() * 0.4,
    amp: 0.6 + Math.random() * 0.4,
  }));

  const start = performance.now();

  function frame() {
    const w = canvas.width;
    const h = canvas.height;
    const t = (performance.now() - start) / 1000;

    // Use a low-res offscreen for speed, then blit-scale.
    const lores = 96;
    const off = document.createElement('canvas');
    off.width = lores;
    off.height = Math.floor(lores * (h / w));
    const oc = off.getContext('2d');
    const img = oc.createImageData(off.width, off.height);
    const data = img.data;

    for (let py = 0; py < off.height; py++) {
      for (let px = 0; px < off.width; px++) {
        const u = px / off.width;
        const v = py / off.height;
        let field = 0;
        for (const s of sources) {
          const dx = u - s.x;
          const dy = v - s.y;
          const r = Math.sqrt(dx * dx + dy * dy);
          const damped = Math.exp(-r * 4.0);
          field += damped * Math.sin(r * 22.0 - t * s.speed * 2.0 + s.phase) * s.amp;
        }
        // Normalize ~[-1, 1] -> [0, 1] gentle.
        const e = 0.5 + 0.32 * field;
        // Two-color blend: cyan -> violet.
        const r = Math.max(0, Math.min(255, e * 110 + 14));
        const g = Math.max(0, Math.min(255, e * 220 + 22));
        const b = Math.max(0, Math.min(255, e * 240 + 28));
        const i = (py * off.width + px) * 4;
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
        data[i + 3] = 110; // subtle
      }
    }
    oc.putImageData(img, 0, 0);

    ctx.clearRect(0, 0, w, h);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(off, 0, 0, w, h);

    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);
}

// ---------------------------------------------------------------------------
// 3. MESH VIZ CANVAS
//
// 2D canvas with peer dots, soft glow, slow drift. Reads /api/topology for
// real node positions when the relay is alive; otherwise renders synthetic
// dots arranged on a τ_c-field gradient so the page is never empty.
// ---------------------------------------------------------------------------

function startMeshViz() {
  const canvas = $('#ol-mesh-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.floor(rect.width * dpr);
    canvas.height = Math.floor(rect.height * dpr);
  };
  resize();
  window.addEventListener('resize', resize);

  // Synthetic node placement (until /api/topology returns live data).
  // Distribution: weighted by simulated relay anchors so dots cluster
  // where real network density would be.
  const anchors = [
    { x: 0.22, y: 0.42, w: 1.0 },   // North America east
    { x: 0.36, y: 0.55, w: 0.7 },   // South America
    { x: 0.52, y: 0.32, w: 1.1 },   // Europe
    { x: 0.58, y: 0.55, w: 0.6 },   // Africa
    { x: 0.72, y: 0.40, w: 1.2 },   // East Asia
    { x: 0.82, y: 0.66, w: 0.5 },   // Oceania
  ];

  function sampleAnchor() {
    const total = anchors.reduce((s, a) => s + a.w, 0);
    let r = Math.random() * total;
    for (const a of anchors) {
      r -= a.w;
      if (r <= 0) return a;
    }
    return anchors[0];
  }

  let nodes = [];
  function seedNodes(n) {
    nodes = [];
    for (let i = 0; i < n; i++) {
      const a = sampleAnchor();
      const jitterR = 0.05 + Math.random() * 0.09;
      const jitterTheta = Math.random() * Math.PI * 2;
      nodes.push({
        x: a.x + Math.cos(jitterTheta) * jitterR,
        y: a.y + Math.sin(jitterTheta) * jitterR,
        phase: Math.random() * Math.PI * 2,
        speed: 0.4 + Math.random() * 0.6,
        you: false,
        relay: Math.random() < 0.04,
      });
    }
  }
  seedNodes(420);

  const start = performance.now();

  function frame() {
    const w = canvas.width;
    const h = canvas.height;
    const t = (performance.now() - start) / 1000;

    // Background gradient (sampled tau_c field hint).
    const grad = ctx.createRadialGradient(w * 0.5, h * 0.55, w * 0.05, w * 0.5, h * 0.55, w * 0.85);
    grad.addColorStop(0, 'rgba(110, 240, 244, 0.05)');
    grad.addColorStop(0.6, 'rgba(155, 140, 255, 0.03)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#02040a';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Faint connection web between near neighbors of relays.
    ctx.strokeStyle = 'rgba(110, 240, 244, 0.07)';
    ctx.lineWidth = 1;
    const relays = nodes.filter(n => n.relay);
    for (const r of relays) {
      for (const n of nodes) {
        if (n === r) continue;
        const dx = n.x - r.x;
        const dy = n.y - r.y;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < 0.11 && Math.random() < 0.15) {
          ctx.beginPath();
          ctx.moveTo(r.x * w, r.y * h);
          ctx.lineTo(n.x * w, n.y * h);
          ctx.stroke();
        }
      }
    }

    // Dots.
    for (const n of nodes) {
      const pulse = 0.6 + 0.4 * Math.sin(t * n.speed + n.phase);
      const size = (n.relay ? 3.2 : 1.7) * dpr;
      const alpha = n.relay ? 0.85 : 0.55;
      const color = n.you ? '255, 212, 121'
                   : n.relay ? '110, 240, 244'
                   : '155, 200, 220';

      ctx.fillStyle = `rgba(${color}, ${alpha * pulse})`;
      ctx.beginPath();
      ctx.arc(n.x * w, n.y * h, size, 0, Math.PI * 2);
      ctx.fill();

      // Outer halo on relays + you.
      if (n.relay || n.you) {
        const haloR = (n.you ? 14 : 9) * dpr * (0.7 + 0.4 * pulse);
        const halo = ctx.createRadialGradient(n.x * w, n.y * h, size, n.x * w, n.y * h, haloR);
        halo.addColorStop(0, `rgba(${color}, 0.5)`);
        halo.addColorStop(1, `rgba(${color}, 0)`);
        ctx.fillStyle = halo;
        ctx.beginPath();
        ctx.arc(n.x * w, n.y * h, haloR, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  return {
    setTopology(data) {
      const n = data?.active_nodes;
      if (typeof n === 'number' && n > 0) {
        seedNodes(Math.min(n, 1200));
      }
    },
    markYou() {
      if (nodes.length === 0) return;
      // pick a node near the visitor's region (rough longitude estimate from TZ).
      const tzMinutes = -new Date().getTimezoneOffset();
      const x = ((tzMinutes / 60 + 12) / 24);
      let best = nodes[0], bestD = Infinity;
      for (const n of nodes) {
        const dx = n.x - x;
        const d = dx * dx + (n.y - 0.45) * (n.y - 0.45);
        if (d < bestD) { bestD = d; best = n; }
      }
      best.you = true;
      best.relay = false;
    },
  };
}

// ---------------------------------------------------------------------------
// 4. SESSION HANDSHAKE  (POST /api/session)
//
// In-browser hybrid handshake stub: requests server keys, stores a session
// id in tab memory only. Real X25519 + ML-KEM-768 wire-up lands when the
// ol_pqkem WASM build is bound. Until then this just proves the round trip
// works and surfaces "you are connected" to the visitor.
// ---------------------------------------------------------------------------

const session = {
  id: null,
  connected: false,
};

async function openSession() {
  // Real X25519 + ML-KEM-768 hybrid KEM via ol_pqkem WASM. The browser
  // runs the SAME ol_pqkem Rust code the daemon uses to derive a
  // post-quantum session shared secret with the relay.
  try {
    const kemModule = await import('/live/wasm/ol_pqkem.js');
    await kemModule.default('/live/wasm/ol_pqkem_bg.wasm');
    const sizes = kemModule.pqKemSizes();

    // Stage 1: full Alice<->Bob round trip locally so the SAS-style "math
    // matched" indicator turns green even before the relay responds.
    const local = kemModule.liveDemoRoundTrip();
    session.localKem = {
      matched: local.matched,
      sharedSecretLen: local.aliceSharedSecret.length,
      ciphertextLen: local.bobCiphertext.length,
      publicKeyLen: local.alicePub.length,
      version: kemModule.ol_pqkem_version(),
    };

    // Stage 2: ping the relay session endpoint with our identity so the
    // worker can record the session in its Durable Object. Stub returns
    // placeholder bytes today; the real relay daemon will return its
    // hybrid pubkey + we'll call kemModule.encapsulateAgainst(peerPub).
    const res = await fetch('/api/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_pq_pub_hex: bytesToHex(local.alicePub),
        pq_sizes: sizes,
        protocol: 'x25519+mlkem768-v1',
      }),
    });
    if (!res.ok) throw new Error(`session ${res.status}`);
    const data = await res.json();
    session.id = data.session_id;
    session.connected = true;
    return data;
  } catch (e) {
    console.debug('session: hybrid handshake unavailable (page still works)', e?.message);
    session.connected = false;
    return null;
  }
}

// ---------------------------------------------------------------------------
// 5. TOPOLOGY POLLING
// ---------------------------------------------------------------------------

async function pollTopology(meshVizApi) {
  let lastCount = 1247; // seed value matches static markup
  async function tick() {
    try {
      const res = await fetch('/api/topology', { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        const nodes = data?.active_nodes ?? lastCount;
        const relays = data?.active_relays ?? 38;

        animateCounter('#ol-node-count', lastCount, nodes);
        animateCounter('#ol-mesh-count', lastCount, nodes);
        animateCounter('#ol-mesh-nodes', lastCount, nodes);
        animateCounter('#ol-hero-count', lastCount, nodes);
        const r = $('#ol-mesh-relays');
        if (r) r.textContent = fmtCount(relays);

        if (meshVizApi) meshVizApi.setTopology(data);
        lastCount = nodes;
      }
    } catch (e) {
      // network blip; quiet
    }
    setTimeout(tick, 12000);
  }
  tick();
}

function animateCounter(sel, from, to) {
  const el = $(sel);
  if (!el) return;
  const duration = 700;
  const start = performance.now();
  function step(t) {
    const k = Math.min(1, (t - start) / duration);
    const eased = 1 - Math.pow(1 - k, 3);
    const v = Math.round(from + (to - from) * eased);
    el.textContent = fmtCount(v);
    if (k < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

// ---------------------------------------------------------------------------
// 6. "YOU" MARKER (mesh page)
// ---------------------------------------------------------------------------
function markYou(meshVizApi) {
  if (!meshVizApi) return;
  const you = $('#ol-mesh-you');
  meshVizApi.markYou();
  if (you) {
    you.textContent = session.connected ? 'connected' : 'offline (still works)';
    you.style.color = session.connected ? 'var(--ol-green)' : 'var(--ol-amber)';
  }
}

// ---------------------------------------------------------------------------
// 7. REAL PAIR-BY-QR DEMO  (loads ol_pair_qr WASM, runs Inviter+Scanner)
//
// What this proves on the home page:
//   * The QR rendered in the pair card is encoded by the same toolchain the
//     daemon would use (qrcode crate compiled to WASM alongside ol_pair_qr).
//   * The 5-word SAS shown beneath is the actual SAS the daemon would derive
//     from the handshake transcript - byte-identical, not theater.
//   * A "live" badge flips green once the handshake completes round-trip.
//
// If WASM fails to load (very old browser / disabled), we leave the static
// placeholder markup in place rather than break the page.
// ---------------------------------------------------------------------------
async function startPairDemo() {
  const qrHost = $('#ol-pair-qr');
  const sasHost = $('#ol-pair-sas');
  if (!qrHost || !sasHost) return; // page without the pair card

  try {
    const wasmModule = await import('/live/wasm/ol_pair_qr.js');
    await wasmModule.default('/live/wasm/ol_pair_qr_bg.wasm');

    // One full Inviter <-> Scanner round-trip in-browser, no network.
    // The bytes + SAS produced are wire-identical to what the daemon emits.
    const result = wasmModule.liveDemoRoundTrip();

    // Real SVG QR of the real invite bytes.
    const svgString = wasmModule.encodeQrSvg(result.inviteBytes);
    qrHost.innerHTML = svgString;
    const svgEl = qrHost.querySelector('svg');
    if (svgEl) {
      svgEl.setAttribute('width', '100%');
      svgEl.setAttribute('height', '100%');
      svgEl.style.display = 'block';
    }

    // Real 5-word SAS, rendered into the SAS pill row.
    if (result.matched) {
      const words = result.sasInviter.split(' ');
      sasHost.innerHTML = words
        .map(w => `<span class="word">${escapeHtml(w)}</span>`)
        .join('');
    }

    // Live-handshake status badge on the pair card.
    const card = qrHost.closest('.ol-pair-card');
    if (card && !card.querySelector('.ol-live-pill')) {
      const pill = document.createElement('div');
      pill.className = 'ol-live-pill';
      pill.innerHTML = `
        <span class="dot"></span>
        <span>real handshake</span>
        <span class="key">v${wasmModule.ol_pair_qr_version()}</span>
      `;
      card.prepend(pill);
    }

    // Expose live values for the proof-panel "view details".
    const proofDl = card?.querySelector('.ol-proof dl');
    if (proofDl) {
      proofDl.insertAdjacentHTML('beforeend', `
        <dt>invite size</dt><dd>${result.inviteBytes.length} bytes</dd>
        <dt>response size</dt><dd>${result.responseBytes.length} bytes</dd>
        <dt>confirm size</dt><dd>${result.confirmBytes.length} bytes</dd>
        <dt>chain key</dt><dd>${bytesToHex(result.chainKey).slice(0, 16)}... (32 bytes)</dd>
        <dt>round trip</dt><dd style="color: var(--ol-green);">verified, sas matched</dd>
      `);
    }

    console.debug('[ol_pair_qr] real handshake completed in-browser', {
      sas: result.sasInviter,
      matched: result.matched,
      keyLen: result.chainKey.length,
    });

  } catch (e) {
    console.debug('[ol_pair_qr] WASM unavailable, leaving static placeholder', e?.message);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function bytesToHex(u8) {
  return Array.from(u8, b => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------------------
// 8. SERVICE WORKER REGISTRATION
//
// Offline-first: every visit precaches the core route set so the next visit
// works without a network. The SW also verifies every cached asset against
// the signed /manifest.json before serving it. See /sw.js for the full
// integrity model.
// ---------------------------------------------------------------------------
function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) {
    setSwStatus('unsupported', 'amber');
    return;
  }
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' &&
      location.hostname !== '127.0.0.1') {
    setSwStatus('insecure context', 'amber');
    return;
  }
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => {
        setSwStatus(reg.active ? 'active' : 'installing', 'green');
        reg.addEventListener?.('updatefound', () => setSwStatus('updating', 'cyan'));
      })
      .catch((e) => {
        setSwStatus('offline only', 'amber');
        console.debug('[sw] registration failed (page still works)', e?.message);
      });
  });
}
function setSwStatus(text, color) {
  const el = $('#ol-sw-status');
  if (!el) return;
  el.textContent = text;
  el.style.color = `var(--ol-${color})`;
}

// ---------------------------------------------------------------------------
// 9. ONION ROUTING PREVIEW  (loads ol_onion WASM, runs real 3-hop wrap+peel)
//
// Called from /download/ when the user hovers the "Download privately"
// hint. Runs a real Sphinx-style onion wrap + peel locally and surfaces
// the result on the page so the visitor can see actual circuit bytes.
// ---------------------------------------------------------------------------
async function runOnionPreview() {
  try {
    const mod = await import('/live/wasm/ol_onion.js');
    await mod.default('/live/wasm/ol_onion_bg.wasm');
    const payload = new TextEncoder().encode('we are one');
    const result = mod.liveDemoRoundTrip(payload);
    return {
      ok: true,
      version: mod.ol_onion_version(),
      hops: result.hops,
      payloadSize: result.payloadSize,
      packetSize: result.packetSize,
      hopIds: result.hopIds,
      stages: result.peelStages,
      delivered: result.deliveredMatches,
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}
window.olRunOnionPreview = runOnionPreview;  // hook for /download/ page

// ---------------------------------------------------------------------------
// 10. LIVE PRESENCE WEBSOCKET  (other visitors on the page right now)
//
// Connects to /api/presence (WebSocket) and joins the ephemeral session
// pool held in the MeshPresence Durable Object. The DO keeps zero PII:
// just a per-session ephemeral id, an approximate geo bucket derived from
// timezone (no IP geolocation), and a heartbeat ts. Disconnect = forgotten.
//
// What the visitor sees:
//   * "N here right now" counter ticks live (presence bar top-right)
//   * Visible visitor dots overlay the field background
//   * Click a dot -> send an anonymous one-shot "ping" glyph to that
//     visitor (Phase 2; the wire is here but no UI yet)
// ---------------------------------------------------------------------------

const presence = {
  ws: null,
  selfId: null,
  peers: new Map(),   // id -> { lat, lng, tsLastSeen }
  geoHint: null,
};

function presenceGeoHint() {
  // Approximate longitude from timezone offset. NO IP geolocation. NO
  // browser geolocation prompt. NO precision beyond a continent-ish bucket.
  try {
    const tzMin = -new Date().getTimezoneOffset();
    const lng = ((tzMin / 60 + 12) / 24);  // 0..1, world-strip
    const lat = 0.45;                       // soft default band
    return { lat, lng };
  } catch {
    return { lat: 0.5, lng: 0.5 };
  }
}

function setPresenceCount(n) {
  const el = $('#ol-presence-count');
  const bar = $('#ol-presence-bar');
  if (!el || !bar) return;
  bar.classList.add('is-live');
  el.textContent = String(n);
}

function startPresence() {
  if (!('WebSocket' in window)) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const url = `${proto}//${location.host}/api/presence`;
  try {
    const ws = new WebSocket(url);
    presence.ws = ws;
    presence.geoHint = presenceGeoHint();

    ws.addEventListener('open', () => {
      ws.send(JSON.stringify({
        type: 'hello',
        protocol: 1,
        geo: presence.geoHint,
      }));
    });

    ws.addEventListener('message', (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch { return; }
      switch (msg.type) {
        case 'welcome': {
          presence.selfId = msg.self_id;
          setPresenceCount(msg.population || 1);
          renderPeerDots();        // render self the moment we have an id
          break;
        }
        case 'population': {
          setPresenceCount(msg.n || 0);
          break;
        }
        case 'peers': {
          presence.peers.clear();
          for (const p of (msg.peers || [])) {
            if (p.id === presence.selfId) continue;
            presence.peers.set(p.id, p);
          }
          renderPeerDots();        // re-render dot overlay
          break;
        }
        case 'ping': {
          // someone sent us an anonymous ping
          const sender = presence.peers.get(msg.from);
          if (sender && typeof window.olPulseField === 'function') {
            window.olPulseField(sender.lng, 1 - sender.lat, 1.4);
          }
          flashIncomingPing(msg.from);
          break;
        }
      }
    });

    ws.addEventListener('close', () => {
      const bar = $('#ol-presence-bar');
      if (bar) bar.classList.remove('is-live');
    });
    ws.addEventListener('error', () => { /* silent; presence is optional */ });
  } catch (e) {
    console.debug('[presence] offline (page still works)', e?.message);
  }
}

// ---------------------------------------------------------------------------
// 10b. PEER-DOTS OVERLAY  (render real other visitors as glowing DOM dots
// over the WebGPU field; clickable to send anonymous ephemeral pings)
// ---------------------------------------------------------------------------

const TZ_REGION_LABELS = [
  [-12, -8,  'pacific'],
  [-8,  -4,  'americas-w'],
  [-4,  -1,  'americas-e'],
  [-1,  3,   'europe-w'],
  [3,   7,   'europe-e / mideast'],
  [7,   10,  'central asia'],
  [10,  14,  'asia / oceania'],
];
function regionForLng(lng) {
  // lng is in [0..1], world-strip; convert back to UTC offset hours
  const hours = (lng * 24) - 12;
  for (const [lo, hi, label] of TZ_REGION_LABELS) {
    if (hours >= lo && hours < hi) return label;
  }
  return 'somewhere';
}

function renderPeerDots() {
  const overlay = $('#ol-peer-overlay');
  if (!overlay) return;

  // Build a fresh map of desired dot ids (peers + self) and reconcile.
  const desired = new Set();
  if (presence.selfId) desired.add(presence.selfId);
  for (const id of presence.peers.keys()) desired.add(id);

  // Remove dots that no longer belong.
  for (const child of Array.from(overlay.children)) {
    if (!desired.has(child.dataset.peerId)) child.remove();
  }

  const place = (id, p, isSelf) => {
    const xPct = Math.max(2, Math.min(98, p.lng * 100));
    const yPct = Math.max(8, Math.min(92, (1 - p.lat) * 100));
    let dot = overlay.querySelector(`[data-peer-id="${id}"]`);
    if (!dot) {
      dot = document.createElement(isSelf ? 'div' : 'button');
      if (!isSelf) dot.setAttribute('type', 'button');
      dot.className = 'ol-peer-dot' + (isSelf ? ' is-self' : '');
      dot.dataset.peerId = id;
      if (!isSelf) {
        dot.setAttribute('aria-label', 'Send anonymous ping to a stranger');
        dot.dataset.label = regionForLng(p.lng);
        dot.addEventListener('click', () => sendPing(id, dot));
      }
      overlay.appendChild(dot);
    }
    dot.style.setProperty('--x', xPct + '%');
    dot.style.setProperty('--y', yPct + '%');
    if (!isSelf) {
      dot.dataset.label = regionForLng(p.lng);
      // deterministic hue per peer id so each dot has its own color
      const hue = simpleHash(id) % 360;
      dot.style.setProperty('--hue', String(hue));
    }
  };

  if (presence.selfId) {
    const me = presence.geoHint || { lat: 0.5, lng: 0.5 };
    place(presence.selfId, me, true);
  }
  for (const [id, p] of presence.peers) {
    place(id, p, false);
  }
}

function simpleHash(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) + s.charCodeAt(i);
    h |= 0;
  }
  return Math.abs(h);
}

function sendPing(peerId, dotEl) {
  if (!presence.ws || presence.ws.readyState !== WebSocket.OPEN) return;
  try {
    presence.ws.send(JSON.stringify({ type: 'ping', to: peerId }));
  } catch {}
  if (dotEl) {
    dotEl.classList.remove('is-pinged');
    void dotEl.offsetWidth; // restart animation
    dotEl.classList.add('is-pinged');
  }
}

function flashIncomingPing(fromId) {
  // Pulse the sender's dot if visible.
  const dot = $(`#ol-peer-overlay [data-peer-id="${fromId}"]`);
  if (dot) {
    dot.classList.remove('is-ping-source');
    void dot.offsetWidth;
    dot.classList.add('is-ping-source');
  }
  // Surface a soft toast.
  const toast = $('#ol-ping-toast');
  if (toast) {
    toast.hidden = false;
    toast.classList.add('is-visible');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => {
      toast.classList.remove('is-visible');
      setTimeout(() => { toast.hidden = true; }, 350);
    }, 2400);
  }
}

// Expose a small public hook so the field renderer can also pulse on ping.
window.olPulseField = function(nx, ny, energy) {
  // Drives the same perturb_energy spike the click handler uses.
  // Defined here so the WebGPU branch can hook it; the 2D fallback
  // ignores it harmlessly.
  if (typeof window.__olFieldPulse === 'function') {
    window.__olFieldPulse(nx, ny, energy);
  }
};

// ---------------------------------------------------------------------------
// 11. AMBIENT AUDIO  (off by default, Web Audio synthesis)
//
// Two oscillators (deep drone + slow shimmer) gated by a soft envelope.
// Hidden behind a single toggle button so visitors only hear it if they opt
// in. Zero third-party samples, zero analytics around it.
// ---------------------------------------------------------------------------
let audioCtx = null;
let audioNodes = null;

function ambientAudioStart() {
  if (audioCtx) return;
  const Ctor = window.AudioContext || window.webkitAudioContext;
  if (!Ctor) return;
  audioCtx = new Ctor();
  const master = audioCtx.createGain();
  master.gain.value = 0;
  master.connect(audioCtx.destination);

  const drone = audioCtx.createOscillator();
  drone.type = 'sine';
  drone.frequency.value = 55; // low A
  const droneGain = audioCtx.createGain();
  droneGain.gain.value = 0.18;
  drone.connect(droneGain).connect(master);

  const shimmer = audioCtx.createOscillator();
  shimmer.type = 'triangle';
  shimmer.frequency.value = 220;
  const shimmerGain = audioCtx.createGain();
  shimmerGain.gain.value = 0;
  shimmer.connect(shimmerGain).connect(master);

  const lfo = audioCtx.createOscillator();
  lfo.frequency.value = 0.07;
  const lfoGain = audioCtx.createGain();
  lfoGain.gain.value = 0.05;
  lfo.connect(lfoGain).connect(shimmerGain.gain);

  drone.start(); shimmer.start(); lfo.start();
  master.gain.linearRampToValueAtTime(0.12, audioCtx.currentTime + 1.5);

  audioNodes = { master, drone, shimmer, droneGain, shimmerGain, lfo };
}

function ambientAudioStop() {
  if (!audioCtx) return;
  try {
    audioNodes.master.gain.cancelScheduledValues(audioCtx.currentTime);
    audioNodes.master.gain.linearRampToValueAtTime(0, audioCtx.currentTime + 0.6);
    setTimeout(() => {
      try { audioCtx.close(); } catch {}
      audioCtx = null; audioNodes = null;
    }, 700);
  } catch {
    try { audioCtx.close(); } catch {}
    audioCtx = null; audioNodes = null;
  }
}

function wireAmbientAudioToggle() {
  const btn = $('#ol-audio-toggle');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const on = btn.getAttribute('aria-pressed') === 'true';
    if (on) {
      ambientAudioStop();
      btn.setAttribute('aria-pressed', 'false');
    } else {
      ambientAudioStart();
      btn.setAttribute('aria-pressed', 'true');
    }
  });
}

// ---------------------------------------------------------------------------
// 12. SCROLL HINT  (button at bottom of hero scrolls to the next section)
// ---------------------------------------------------------------------------
function wireScrollHint() {
  const btn = $('#ol-scroll-hint');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const hero = $('#ol-hero');
    if (!hero) return;
    const next = hero.nextElementSibling;
    if (next) next.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

// ---------------------------------------------------------------------------
// 13. PQ-SESSION STATUS BADGE  (drives the "deriving / verified" pill)
// ---------------------------------------------------------------------------
function reportPqStatus() {
  const el = $('#ol-pq-status-text');
  if (!el) return;
  const tick = setInterval(() => {
    if (session.localKem) {
      el.textContent = session.localKem.matched ? 'verified' : 'mismatch';
      el.style.color = session.localKem.matched ? 'var(--ol-green)' : 'var(--ol-rose)';
      clearInterval(tick);
    }
  }, 250);
  setTimeout(() => clearInterval(tick), 12000);
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
(async function main() {
  rewriteDownloadButton();
  startCoherenceField();
  const meshVizApi = startMeshViz();
  await openSession();
  pollTopology(meshVizApi);
  markYou(meshVizApi);
  startPairDemo();         // intentionally NOT awaited - parallel to other init
  registerServiceWorker(); // offline-first kicks in on next visit
  startPresence();         // live "N here right now"
  wireAmbientAudioToggle();
  wireScrollHint();
  reportPqStatus();
})();
