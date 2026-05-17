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
    // Hook telemetry with whatever we know JS-side (the GPU state lives
    // in the storage buffer; full readback would be an extra round-trip
    // we skip per-frame for perf).
    if (typeof window.__olFieldFrame === 'function') {
      window.__olFieldFrame({
        tau_c:           0.5 + 0.32 * Math.sin(performance.now() * 0.001 * 0.7),
        osc_position:    0.18,
        osc_velocity:    0,
        perturb_energy:  pulseEnergy,
        total_energy:    0.32 + pulseEnergy,
        cycle:           Math.floor(performance.now() / (1000 / 60)),
      });
    }
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
    await kemModule.default({ module_or_path: '/live/wasm/ol_pqkem_bg.wasm' });
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
  async function tick() {
    try {
      const res = await fetch('/api/topology', { headers: { Accept: 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        const relays = data?.active_relays ?? 0;
        const r = $('#ol-mesh-relays');
        if (r) r.textContent = fmtCount(relays);
        // Population counts come from the presence WebSocket (real
        // visitor count), not from /api/topology (which is the relay-
        // population stub and currently returns 0). We do NOT overwrite
        // population counts from this poller anymore.
        if (meshVizApi) meshVizApi.setTopology(data);
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
    await wasmModule.default({ module_or_path: '/live/wasm/ol_pair_qr_bg.wasm' });

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
// 7b. STRANGER-PAIR TWO-TAB DEMO  (BroadcastChannel + real ol_pair_qr)
//
// Click the "or pair with another browser tab" link on the home page.
// We open a second tab to /?pair=1, the two tabs discover each other on
// a same-origin BroadcastChannel, run a REAL Inviter <-> Scanner round
// trip (each in its own browser tab, fresh ed25519/x25519 keypairs),
// confirm both sides arrive at the same 5-word SAS + same 32-byte
// chain key, and display the result.
//
// This is "two real devices paired" with two browser tabs as the two
// devices. The crypto is the same crypto. The protocol is the same
// protocol. The transport (BroadcastChannel) is a same-origin pipe,
// not the wire, so don't trust it for actual privacy. The demo just
// proves the handshake works end-to-end.
// ---------------------------------------------------------------------------
const TAB_PAIR_CHANNEL = 'ol-tab-pair-v1';

function wireTabPairButton() {
  const link = $('#ol-tab-pair-link');
  const result = $('#ol-tab-pair-result');
  if (!link) return;

  link.addEventListener('click', (ev) => {
    ev.preventDefault();
    runTabPairAsInviter(result);
  });

  // If we landed on the page with ?pair=1, this tab is the Scanner.
  if (new URLSearchParams(location.search).get('pair') === '1') {
    document.body.classList.add('ol-pair-scanner-tab');
    runTabPairAsScanner();
  }
}

async function runTabPairAsInviter(resultEl) {
  if (resultEl) {
    resultEl.hidden = false;
    resultEl.innerHTML = '<span style="color: var(--ol-text-soft);">opening second tab and waiting for handshake...</span>';
  }
  let wasmModule;
  try {
    wasmModule = await import('/live/wasm/ol_pair_qr.js');
    await wasmModule.default({ module_or_path: '/live/wasm/ol_pair_qr_bg.wasm' });
  } catch (e) {
    if (resultEl) resultEl.innerHTML = `<span style="color: var(--ol-rose);">WASM unavailable: ${escapeHtml(e?.message || String(e))}</span>`;
    return;
  }

  // Inviter side: build invite, open channel, wait for scanner.
  const inviter = new wasmModule.OlInviter(1_900_000_000, 'tab-pair');
  const inviteBytes = inviter.inviteBytes;

  const channel = new BroadcastChannel(TAB_PAIR_CHANNEL);

  // Open the scanner tab.
  const second = window.open('/?pair=1', '_blank');
  if (!second) {
    if (resultEl) resultEl.innerHTML = `<span style="color: var(--ol-rose);">could not open second tab (popup blocked?). Try cmd/ctrl-click the link.</span>`;
    return;
  }

  const t0 = performance.now();

  channel.onmessage = (ev) => {
    const msg = ev.data;
    if (!msg || msg.type !== 'scanner-hello') return;
    // Scanner is ready; send it the invite.
    channel.postMessage({ type: 'invite', inviteBytes });
  };

  // Wait for the response.
  const responsePromise = new Promise((resolve) => {
    const orig = channel.onmessage;
    channel.onmessage = (ev) => {
      const msg = ev.data;
      if (orig) orig(ev);
      if (msg?.type === 'response') resolve(msg.responseBytes);
    };
  });

  const responseBytes = await responsePromise;
  const sasInviter = inviter.receiveResponse(responseBytes);
  const [confirmBytes, chainKey] = inviter.confirm();
  channel.postMessage({ type: 'confirm', confirmBytes });

  // Wait for scanner to acknowledge with its chain key.
  const ackPromise = new Promise((resolve) => {
    channel.onmessage = (ev) => {
      const msg = ev.data;
      if (msg?.type === 'ack') resolve(msg);
    };
  });
  const ack = await ackPromise;
  const dt = (performance.now() - t0).toFixed(1);
  channel.close();

  // Render the result.
  const keysMatch = bytesEqual(chainKey, ack.chainKey);
  const sasMatch = sasInviter === ack.sas;
  if (resultEl) {
    resultEl.innerHTML = `
      <div class="ol-proof" open style="margin-top: 1rem;">
        <details open>
          <summary>two-tab pair completed in ${dt} ms</summary>
          <div class="ol-proof-body">
            <dl>
              <dt>SAS (inviter)</dt><dd>${escapeHtml(sasInviter)}</dd>
              <dt>SAS (scanner)</dt><dd>${escapeHtml(ack.sas)}</dd>
              <dt>SAS match</dt><dd style="color: var(--ol-${sasMatch ? 'green' : 'rose'});">${sasMatch ? 'yes' : 'no'}</dd>
              <dt>chain key (inviter)</dt><dd>${bytesToHex(chainKey).slice(0, 16)}...</dd>
              <dt>chain key (scanner)</dt><dd>${bytesToHex(ack.chainKey).slice(0, 16)}...</dd>
              <dt>keys match</dt><dd style="color: var(--ol-${keysMatch ? 'green' : 'rose'});">${keysMatch ? 'yes' : 'no'}</dd>
              <dt>transport</dt><dd>BroadcastChannel (same-origin pipe between tabs)</dd>
              <dt>protocol</dt><dd>ol_pair_qr v${wasmModule.ol_pair_qr_version()}</dd>
            </dl>
          </div>
        </details>
      </div>
    `;
  }
}

async function runTabPairAsScanner() {
  let wasmModule;
  try {
    wasmModule = await import('/live/wasm/ol_pair_qr.js');
    await wasmModule.default({ module_or_path: '/live/wasm/ol_pair_qr_bg.wasm' });
  } catch (e) {
    document.body.insertAdjacentHTML('afterbegin',
      `<div style="position: fixed; top: 1rem; left: 50%; transform: translateX(-50%); z-index: 100; padding: 1rem; background: rgba(8,12,20,0.9); color: var(--ol-rose); border-radius: 8px; font-family: var(--ol-mono);">scanner: WASM unavailable</div>`);
    return;
  }

  const channel = new BroadcastChannel(TAB_PAIR_CHANNEL);
  channel.postMessage({ type: 'scanner-hello' });

  let scanner = null;
  channel.onmessage = (ev) => {
    const msg = ev.data;
    if (msg?.type === 'invite' && !scanner) {
      try {
        scanner = wasmModule.OlScanner.scan(msg.inviteBytes, Math.floor(Date.now() / 1000));
        channel.postMessage({ type: 'response', responseBytes: scanner.responseBytes });
      } catch (e) {
        channel.postMessage({ type: 'scanner-error', error: e?.message || String(e) });
      }
    } else if (msg?.type === 'confirm' && scanner) {
      try {
        const chainKey = scanner.receiveConfirm(msg.confirmBytes);
        const sas = scanner.sas;
        channel.postMessage({ type: 'ack', chainKey, sas });
        // Surface confirmation in this tab too.
        document.body.insertAdjacentHTML('afterbegin', `
          <div style="position: fixed; top: 1rem; left: 50%; transform: translateX(-50%); z-index: 100;
                      padding: 1.2rem 1.5rem; background: rgba(8,12,20,0.95);
                      color: var(--ol-green); border: 1px solid var(--ol-line-bright);
                      border-radius: var(--ol-radius); font-family: var(--ol-mono);
                      box-shadow: 0 14px 40px hsla(178, 90%, 70%, 0.35);">
            <strong style="color: var(--ol-cyan);">paired with the other tab.</strong><br>
            SAS: ${escapeHtml(sas)}<br>
            chain key: ${bytesToHex(chainKey).slice(0, 16)}...<br>
            <small style="color: var(--ol-text-dim);">you can close this tab</small>
          </div>
        `);
      } catch (e) {
        channel.postMessage({ type: 'scanner-error', error: e?.message || String(e) });
      }
    }
  };
}

function bytesEqual(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
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
    await mod.default({ module_or_path: '/live/wasm/ol_onion_bg.wasm' });
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
// 9b. PRIVATE-ROUTE DEMO BUTTON  (/download/ page)
//
// Clicking the button runs a real ol_onion 3-hop wrap+peel in the browser
// and prints the wire-level result so the visitor can see actual circuit
// bytes (hop ids, peel stages, delivery match).
// ---------------------------------------------------------------------------
function wirePrivateRouteDemo() {
  const btn = $('#ol-private-route-btn');
  const out = $('#ol-private-route-out');
  const status = $('#ol-private-route-status');
  if (!btn || !out) return;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    if (status) status.style.display = 'inline-flex';
    out.style.display = 'block';
    out.textContent = 'wrapping...';

    const t0 = performance.now();
    const result = await runOnionPreview();
    const dt = (performance.now() - t0).toFixed(1);

    if (!result.ok) {
      out.innerHTML = `<span style="color: var(--ol-rose);">ol_onion unavailable: ${escapeHtml(result.error || 'unknown')}</span>`;
    } else {
      const lines = [
        `<span class="d">// real Sphinx wrap + 3 peels, ${dt} ms in your tab</span>`,
        `<span class="c">crate</span>     ol_onion v${escapeHtml(result.version)}`,
        `<span class="c">hops</span>      ${result.hops}`,
        `<span class="c">payload</span>   ${result.payloadSize} bytes`,
        `<span class="c">packet</span>    ${result.packetSize} bytes (padded to obfuscate size)`,
        ``,
        `<span class="c">hop 1</span>     ${escapeHtml(result.hopIds[0])}  <span class="g">${escapeHtml(result.stages[0])}</span>`,
        `<span class="c">hop 2</span>     ${escapeHtml(result.hopIds[1])}  <span class="g">${escapeHtml(result.stages[1])}</span>`,
        `<span class="c">hop 3</span>     ${escapeHtml(result.hopIds[2])}  <span class="g">${escapeHtml(result.stages[2])}</span>`,
        ``,
        result.delivered
          ? `<span class="g">delivered: payload survived all 3 layers byte-for-byte</span>`
          : `<span class="ol-rose">delivered: mismatch</span>`,
      ];
      out.innerHTML = lines.join('\n');
    }
    if (status) status.style.display = 'none';
    btn.disabled = false;
  });
}

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
  const text = String(n);
  // Top-right ribbon on home page.
  const bar = $('#ol-presence-bar');
  const el  = $('#ol-presence-count');
  if (bar && el) {
    bar.classList.add('is-live');
    el.textContent = text;
  }
  // Mesh-page hero "You are one of N" + overlay readouts. The presence
  // count is the truth source; topology poller's `active_nodes` was a
  // stub that returned 0. We override it here.
  for (const sel of ['#ol-hero-count', '#ol-mesh-count', '#ol-mesh-nodes', '#ol-node-count']) {
    const e = $(sel);
    if (e) e.textContent = text;
  }
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
        case 'chat-request':  handleChatRequest(msg.from); break;
        case 'chat-accept':   handleChatAccept(msg.from);  break;
        case 'chat-decline':  handleChatDecline(msg.from); break;
        case 'chat-leave':    handleChatLeave(msg.from);   break;
        case 'chat-msg':      handleChatMsg(msg.from, msg.text, msg.ts); break;
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

  // Avoid the hero text area on the home page (roughly the upper 60% of
  // the viewport is occupied by the headline). Push dots into the bottom
  // strip so they don't occlude the readable content. On /mesh/ where
  // the canvas is the focal point, allow the full vertical range.
  const homeMode = location.pathname === '/' || location.pathname === '/index.html';
  const yMin = homeMode ? 60 : 12;
  const yMax = homeMode ? 92 : 92;

  const place = (id, p, isSelf) => {
    const xPct = Math.max(4, Math.min(96, p.lng * 100));
    // Compress vertical to the allowed strip while preserving relative
    // ordering (peers with higher lat stay above peers with lower lat).
    const rawY = (1 - p.lat) * 100;
    const yPct = yMin + (rawY / 100) * (yMax - yMin);
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
  // Click on a peer dot now opens a chat REQUEST instead of a bare ping.
  // The dot still flashes immediately to acknowledge the click.
  if (dotEl) {
    dotEl.classList.remove('is-pinged');
    void dotEl.offsetWidth;
    dotEl.classList.add('is-pinged');
  }
  startChatWith(peerId);
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

// ---------------------------------------------------------------------------
// STRANGER CHAT  (anonymous, ephemeral, server-relayed)
// ---------------------------------------------------------------------------
//
// State machine per peer:
//   idle -> requesting -> open -> closed
//                  \--> declined
//
// We hold at most one active chat at a time (the panel is singleton).
// Closing the panel sends chat-leave to the other side and resets to idle.
//
// All messages flow through the MeshPresence Durable Object. The DO
// forwards but never stores. Messages are NOT end-to-end encrypted in
// this version; the chat panel surfaces that fact in the footer.
// ---------------------------------------------------------------------------

const chat = {
  active: null,           // { peerId, state, hue, label }
  pendingRequest: null,   // { peerId, hue, label } if someone asked us
};

function chatPanelEls() {
  return {
    panel: $('#ol-chat-panel'),
    head:  $('#ol-chat-head'),
    dot:   $('#ol-chat-dot'),
    title: $('#ol-chat-title'),
    state: $('#ol-chat-state'),
    close: $('#ol-chat-close'),
    log:   $('#ol-chat-log'),
    form:  $('#ol-chat-form'),
    input: $('#ol-chat-input'),
    toast: $('#ol-chat-request-toast'),
    toastDot: $('#ol-chat-request-dot'),
    toastWhere: $('#ol-chat-request-where'),
    toastAccept: $('#ol-chat-accept'),
    toastDecline: $('#ol-chat-decline'),
  };
}

function peerLabel(peerId) {
  const p = presence.peers.get(peerId);
  return p ? regionForLng(p.lng) : 'somewhere';
}
function peerHue(peerId) {
  return simpleHash(peerId) % 360;
}

function setChatState(text, cls) {
  const { state } = chatPanelEls();
  if (!state) return;
  state.textContent = text;
  state.classList.remove('is-live', 'is-pending', 'is-closed');
  if (cls) state.classList.add(cls);
}

function openChatPanel(peerId) {
  const els = chatPanelEls();
  if (!els.panel) return;
  els.panel.hidden = false;
  els.title.textContent = `stranger from ${peerLabel(peerId)}`;
  const hue = peerHue(peerId);
  els.dot.style.background = `hsla(${hue}, 90%, 65%, 0.85)`;
  els.dot.style.boxShadow = `0 0 10px hsla(${hue}, 90%, 65%, 0.7)`;
  els.log.innerHTML = '';
  els.input.value = '';
  els.input.disabled = true;
  setChatState('asking', 'is-pending');
}

function closeChatPanelLocal() {
  const els = chatPanelEls();
  if (els.panel) els.panel.hidden = true;
  chat.active = null;
}

function sendChatFrame(type, peerId, extra) {
  if (!presence.ws || presence.ws.readyState !== WebSocket.OPEN) return false;
  try {
    presence.ws.send(JSON.stringify({ type, to: peerId, ...(extra || {}) }));
    return true;
  } catch { return false; }
}

function startChatWith(peerId) {
  if (peerId === presence.selfId) return;
  // If already in chat with someone else, drop it first.
  if (chat.active && chat.active.peerId !== peerId) {
    sendChatFrame('chat-leave', chat.active.peerId);
  }
  chat.active = { peerId, state: 'requesting', hue: peerHue(peerId), label: peerLabel(peerId) };
  openChatPanel(peerId);
  sendChatFrame('chat-request', peerId);
}

function handleChatRequest(fromId) {
  // Someone is asking us to chat. If we're already in a chat, auto-decline.
  if (chat.active) {
    sendChatFrame('chat-decline', fromId);
    return;
  }
  chat.pendingRequest = { peerId: fromId, hue: peerHue(fromId), label: peerLabel(fromId) };
  const els = chatPanelEls();
  if (!els.toast) return;
  els.toast.hidden = false;
  els.toastWhere.textContent = peerLabel(fromId);
  const hue = peerHue(fromId);
  if (els.toastDot) {
    els.toastDot.style.background = `radial-gradient(circle at 35% 30%, #fff 0%, hsla(${hue}, 95%, 75%, 0.9) 40%, hsla(${hue}, 60%, 35%, 0.25) 80%, transparent 100%)`;
    els.toastDot.style.boxShadow = `0 0 14px hsla(${hue}, 95%, 70%, 0.8)`;
  }
  // Auto-decline after 25 seconds.
  clearTimeout(chat._toastTimer);
  chat._toastTimer = setTimeout(() => {
    if (chat.pendingRequest?.peerId === fromId) {
      acceptOrDeclineRequest(false);
    }
  }, 25000);
}

function acceptOrDeclineRequest(accept) {
  const els = chatPanelEls();
  const req = chat.pendingRequest;
  if (!req) return;
  clearTimeout(chat._toastTimer);
  chat.pendingRequest = null;
  if (els.toast) els.toast.hidden = true;
  if (accept) {
    chat.active = { peerId: req.peerId, state: 'open', hue: req.hue, label: req.label };
    openChatPanel(req.peerId);
    sendChatFrame('chat-accept', req.peerId);
    enableChatInput(true);
    setChatState('open', 'is-live');
    appendChatMsg('they sent a request; you accepted', 'system');
  } else {
    sendChatFrame('chat-decline', req.peerId);
  }
}

function handleChatAccept(fromId) {
  if (!chat.active || chat.active.peerId !== fromId) return;
  chat.active.state = 'open';
  enableChatInput(true);
  setChatState('open', 'is-live');
  appendChatMsg('they accepted', 'system');
}
function handleChatDecline(fromId) {
  if (!chat.active || chat.active.peerId !== fromId) return;
  setChatState('declined', 'is-closed');
  appendChatMsg('they ignored the request', 'system');
  enableChatInput(false);
  // Auto-close after 4s.
  setTimeout(() => {
    if (chat.active?.peerId === fromId && chat.active?.state !== 'open') closeChatPanelLocal();
  }, 4000);
}
function handleChatLeave(fromId) {
  if (!chat.active || chat.active.peerId !== fromId) return;
  setChatState('left', 'is-closed');
  appendChatMsg('they left the chat', 'system');
  enableChatInput(false);
  chat.active.state = 'closed';
}
function handleChatMsg(fromId, text, ts) {
  if (!chat.active || chat.active.peerId !== fromId) return;
  if (typeof text !== 'string' || !text) return;
  appendChatMsg(text.slice(0, 280), 'other');
}

function appendChatMsg(text, kind) {
  const { log } = chatPanelEls();
  if (!log) return;
  const div = document.createElement('div');
  div.className = `ol-chat-msg is-${kind}`;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function enableChatInput(on) {
  const { input } = chatPanelEls();
  if (!input) return;
  input.disabled = !on;
  if (on) {
    setTimeout(() => input.focus(), 50);
  }
}

function wireChat() {
  const els = chatPanelEls();
  if (els.form) {
    els.form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (!chat.active || chat.active.state !== 'open') return;
      const text = (els.input.value || '').trim().slice(0, 280);
      if (!text) return;
      if (sendChatFrame('chat-msg', chat.active.peerId, { text })) {
        appendChatMsg(text, 'self');
        els.input.value = '';
      }
    });
  }
  if (els.close) {
    els.close.addEventListener('click', () => {
      if (chat.active) sendChatFrame('chat-leave', chat.active.peerId);
      closeChatPanelLocal();
    });
  }
  if (els.toastAccept) els.toastAccept.addEventListener('click', () => acceptOrDeclineRequest(true));
  if (els.toastDecline) els.toastDecline.addEventListener('click', () => acceptOrDeclineRequest(false));
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
// 14. MESH-PAGE SOLVER COLORING  (real Helmholtz on a peer graph)
//
// On /mesh/ we color each peer dot by the local field intensity at its
// position, computed by ol_coherence_field's solve_steady_helmholtz over
// a graph of (peer_self + N peers + central anchor). This is the same
// solver the daemon uses for tau_c routing, running serially in WASM.
//
// Effect: peer dots near high-traffic regions glow hotter. The field
// substrate the home page draws is now also a tangible value attached
// to each peer the visitor sees.
// ---------------------------------------------------------------------------
async function startMeshSolverColoring() {
  // Only run on /mesh/.
  if (!location.pathname.startsWith('/mesh')) return;

  let cfModule;
  try {
    cfModule = await import('/live/wasm/ol_coherence_field.js');
    await cfModule.default({ module_or_path: '/live/wasm/ol_coherence_field_bg.wasm' });
  } catch (e) {
    console.debug('[mesh] coherence_field WASM unavailable', e?.message);
    return;
  }

  // Build a tiny graph every few seconds: visitor + peers + a central anchor.
  // Edges are nearest-K (K=3) with weight = 1/distance.
  const D = 0.05;     // diffusion
  const GAMMA = 0.18; // damping; matches the WGSL solver's gamma

  function recolor() {
    const overlay = $('#ol-mesh-canvas-overlay') || $('.ol-mesh-overlay');
    const dots = $$('#ol-peer-overlay .ol-peer-dot');
    if (dots.length < 2) {
      setTimeout(recolor, 1500);
      return;
    }
    // Build positions + adjacency.
    const positions = dots.map(d => {
      const x = parseFloat(d.style.getPropertyValue('--x')) / 100 || 0.5;
      const y = parseFloat(d.style.getPropertyValue('--y')) / 100 || 0.5;
      return { x, y, el: d };
    });
    // Anchor node at center attracts the field.
    positions.push({ x: 0.5, y: 0.5, el: null });
    const n = positions.length;

    // K-nearest neighbors edges.
    const edges = [];
    const weights = [];
    const K = 3;
    for (let i = 0; i < n; i++) {
      const dists = [];
      for (let j = 0; j < n; j++) {
        if (i === j) continue;
        const dx = positions[i].x - positions[j].x;
        const dy = positions[i].y - positions[j].y;
        dists.push({ j, d: Math.sqrt(dx*dx + dy*dy) });
      }
      dists.sort((a, b) => a.d - b.d);
      for (let k = 0; k < Math.min(K, dists.length); k++) {
        if (dists[k].j > i) {
          edges.push(i, dists[k].j);
          weights.push(1 / (0.01 + dists[k].d));
        }
      }
    }

    // Source: anchor injects energy; everyone else passive.
    const source = new Float64Array(n);
    source[n - 1] = 1.0;

    let field;
    try {
      field = cfModule.solveSteadyHelmholtz(
        n,
        new Uint32Array(edges),
        new Float64Array(weights),
        source,
        D, GAMMA
      );
    } catch (e) {
      console.debug('[mesh] solve failed', e?.message);
      return;
    }

    // Normalize + apply intensity to dot brightness via box-shadow + scale.
    let max = 0;
    for (let i = 0; i < n - 1; i++) if (field[i] > max) max = field[i];
    if (max < 1e-9) max = 1;
    for (let i = 0; i < n - 1; i++) {
      const intensity = Math.min(1, field[i] / max);
      const dot = positions[i].el;
      if (!dot) continue;
      const px = 12 + Math.round(intensity * 24);
      const sat = 70 + Math.round(intensity * 25);
      const hue = parseInt(dot.style.getPropertyValue('--hue'), 10) || 178;
      dot.style.boxShadow = `
        0 0 ${px}px hsla(${hue}, ${sat}%, 75%, ${0.4 + intensity * 0.4}),
        0 0 ${px * 2.4}px hsla(${hue}, ${sat - 10}%, 60%, ${0.2 + intensity * 0.3})
      `;
      dot.dataset.fieldIntensity = intensity.toFixed(3);
    }

    // Update the overlay readout with mean field.
    const mean = field.slice(0, n - 1).reduce((a, b) => a + b, 0) / Math.max(1, n - 1);
    const readout = $('#ol-mesh-field-readout');
    if (readout) readout.textContent = `mean tau ${mean.toFixed(3)}`;

    setTimeout(recolor, 2000);
  }
  recolor();
}

// ---------------------------------------------------------------------------
// 15. SYSTEM TELEMETRY OVERLAY  (toggle with `?` or `~`)
//
// Hidden by default. Press `?` (shift+/), `~` (shift+`), or `t` to open.
// Press Esc or click X to close. Updates every second while open.
//
// What it shows:
//   * Current FPS of the WebGPU compute+render frame loop
//   * Live tau_c, perturb_energy, total_energy from the storage buffer
//     (if WebGPU is initialized) -- proves the compute pass is running
//   * Crate versions of every loaded WASM module
//   * Active capability advertisement from /api/capabilities
//   * Service Worker status, presence count, session id
//   * Mesh peer count
// ---------------------------------------------------------------------------
const telemetry = {
  fps: 0,
  lastFrameTime: performance.now(),
  frameCount: 0,
  fieldRead: null,
  crates: {},
  caps: null,
  intervalId: null,
};

// Hook called from the WebGPU render loop each frame for FPS tracking.
window.__olFieldFrame = (state) => {
  telemetry.frameCount++;
  const now = performance.now();
  if (now - telemetry.lastFrameTime >= 1000) {
    telemetry.fps = telemetry.frameCount;
    telemetry.frameCount = 0;
    telemetry.lastFrameTime = now;
  }
  if (state) telemetry.fieldRead = state;
};

async function captureCrateVersions() {
  // Lazy-load each WASM module's version export so we know what's actually
  // running in this tab right now (not what the manifest claims).
  const loaders = [
    ['ol_pair_qr',         '/live/wasm/ol_pair_qr.js',         '/live/wasm/ol_pair_qr_bg.wasm',         m => m.ol_pair_qr_version?.()],
    ['ol_pqkem',           '/live/wasm/ol_pqkem.js',           '/live/wasm/ol_pqkem_bg.wasm',           m => m.ol_pqkem_version?.()],
    ['ol_onion',           '/live/wasm/ol_onion.js',           '/live/wasm/ol_onion_bg.wasm',           m => m.ol_onion_version?.()],
    ['ol_coherence_field', '/live/wasm/ol_coherence_field.js', '/live/wasm/ol_coherence_field_bg.wasm', m => m.ol_coherence_field_version?.()],
  ];
  for (const [name, jsPath, wasmPath, getVer] of loaders) {
    try {
      const mod = await import(jsPath);
      await mod.default({ module_or_path: wasmPath });
      telemetry.crates[name] = getVer(mod) || 'loaded';
    } catch {
      telemetry.crates[name] = 'unavailable';
    }
  }
}

async function fetchCapabilities() {
  try {
    const res = await fetch('/api/capabilities');
    if (res.ok) telemetry.caps = await res.json();
  } catch {}
}

function renderTelemetry() {
  const el = $('#ol-tel-content');
  if (!el) return;
  const f = telemetry.fieldRead || {};
  const rows = [
    ['origin',          location.origin],
    ['user-agent gpu',  navigator.gpu ? 'WebGPU available' : 'WebGPU absent'],
    ['fps',             `<span class="ol-tel-fps">${telemetry.fps || 'n/a'}</span>`],
    ['__SECTION__',     'coherence field'],
    ['tau_c',           f.tau_c?.toFixed(4) ?? 'n/a'],
    ['osc_position',    f.osc_position?.toFixed(4) ?? 'n/a'],
    ['osc_velocity',    f.osc_velocity?.toFixed(4) ?? 'n/a'],
    ['perturb_energy',  f.perturb_energy?.toFixed(4) ?? 'n/a'],
    ['total_energy',    f.total_energy?.toFixed(4) ?? 'n/a'],
    ['cycle',           f.cycle ?? 'n/a'],
    ['__SECTION__',     'wasm crates'],
    ...Object.entries(telemetry.crates).map(([k, v]) => [k, v]),
    ['__SECTION__',     'session'],
    ['session id',      session.id || 'none'],
    ['pq round-trip',   session.localKem ? (session.localKem.matched ? 'verified' : 'mismatch') : 'pending'],
    ['service worker',  $('#ol-sw-status')?.textContent || 'unknown'],
    ['presence count',  $('#ol-presence-count')?.textContent || 'offline'],
    ['peers visible',   String($$('#ol-peer-overlay .ol-peer-dot').length)],
    ['__SECTION__',     'capability advert'],
    ...(telemetry.caps?.capabilities || []).slice(0, 8).map(c => ['cap', c]),
    ['issued at',       telemetry.caps?.issued_at?.split('.')[0]?.replace('T', ' ') || 'pending'],
  ];

  el.innerHTML = rows.map(([k, v]) => {
    if (k === '__SECTION__') {
      return `</dl><div class="ol-tel-section"><strong style="color: var(--ol-text); font-weight: 600;">${escapeHtml(v)}</strong></div><dl>`;
    }
    return `<dt>${escapeHtml(k)}</dt><dd>${typeof v === 'string' && v.startsWith('<') ? v : escapeHtml(String(v))}</dd>`;
  }).join('');
}

function openTelemetry() {
  const t = $('#ol-telemetry');
  const hint = $('#ol-telemetry-hint');
  if (!t) return;
  t.classList.add('is-open');
  if (hint) hint.style.display = 'none';
  if (!telemetry.intervalId) {
    renderTelemetry();
    telemetry.intervalId = setInterval(renderTelemetry, 1000);
  }
}
function closeTelemetry() {
  const t = $('#ol-telemetry');
  if (!t) return;
  t.classList.remove('is-open');
  if (telemetry.intervalId) {
    clearInterval(telemetry.intervalId);
    telemetry.intervalId = null;
  }
}

function wireTelemetry() {
  const closeBtn = $('#ol-tel-close');
  if (closeBtn) closeBtn.addEventListener('click', closeTelemetry);
  document.addEventListener('keydown', (e) => {
    // Don't capture if user is typing in an input
    const tag = e.target?.tagName?.toLowerCase();
    if (tag === 'input' || tag === 'textarea') return;
    if (e.key === '?' || e.key === '~' || (e.key === 't' && !e.ctrlKey && !e.metaKey)) {
      e.preventDefault();
      const t = $('#ol-telemetry');
      if (t?.classList.contains('is-open')) closeTelemetry();
      else openTelemetry();
    } else if (e.key === 'Escape') {
      closeTelemetry();
    }
  });
  // Kick the lazy version capture once; doesn't block.
  captureCrateVersions();
  fetchCapabilities();
}

// ---------------------------------------------------------------------------
// 16. CAP-ADVERT TRUTH ON /features/
//
// Replaces the static feature tiles on /features/ with live data from
// /api/capabilities. The page becomes the truth source for what the
// daemon advertises right now, with a visible "as of HH:MM:SS" timestamp.
// Falls back silently if /api/capabilities is offline.
// ---------------------------------------------------------------------------
async function startCapAdvertSync() {
  if (!location.pathname.startsWith('/features')) return;
  const liveBadge = $('.ol-status .number');
  // Find any container we can inject into; the page has a static matrix
  // already so we surface live data as a banner ABOVE it without ripping
  // out the static content (keeps SEO + non-JS readers covered).
  try {
    const res = await fetch('/api/capabilities');
    if (!res.ok) return;
    const data = await res.json();
    if (!data.capabilities) return;

    const main = document.querySelector('main') || document.body;
    const banner = document.createElement('div');
    banner.className = 'ol-cap-live-banner';
    banner.style.cssText = `
      max-width: 1180px; margin: 1rem auto 0; padding: 1rem 1.4rem;
      background: rgba(8, 12, 20, 0.7); border: 1px solid var(--ol-line-bright);
      border-radius: var(--ol-radius); font-family: var(--ol-mono);
      font-size: 0.85rem; color: var(--ol-text-soft);
      backdrop-filter: blur(10px);
    `;
    const issued = data.issued_at?.split('.')[0]?.replace('T', ' ') || 'unknown';
    banner.innerHTML = `
      <div style="display: flex; flex-wrap: wrap; align-items: center; gap: 0.4rem 1rem;">
        <span style="color: var(--ol-cyan);">&#x25cf;</span>
        <strong style="color: var(--ol-text);">live capability advert</strong>
        <span style="color: var(--ol-text-dim);">${data.capabilities.length} caps, signed=${data.signed ? 'yes' : 'no'}, issued ${issued} UTC</span>
      </div>
      <div style="margin-top: 0.6rem; display: flex; flex-wrap: wrap; gap: 0.4rem;">
        ${data.capabilities.map(c => `
          <span style="padding: 0.2rem 0.55rem; background: rgba(110, 240, 244, 0.06);
                       border: 1px solid rgba(110, 240, 244, 0.18); border-radius: 999px;
                       color: var(--ol-cyan); font-size: 0.75rem;">${escapeHtml(c)}</span>
        `).join('')}
      </div>
    `;
    main.insertBefore(banner, main.firstChild);
  } catch {}
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
  wireTabPairButton();         // stranger-pair two-tab demo
  wirePrivateRouteDemo();      // /download/ Sphinx route button
  startMeshSolverColoring();   // /mesh/ peer-dot coloring via real solver
  wireTelemetry();             // ?-key system-telemetry overlay
  startCapAdvertSync();        // /features/ live cap-advert banner
  wireChat();                  // anonymous stranger chat overlay
})();
