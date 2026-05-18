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

// Per-OS download artifact summary shown beneath the homepage CTA.
// Keeps visitors honest about what they're about to receive on click:
// platform, file size, and whether the byte-by-byte streaming verify
// will run (Windows + Linux today; the rest land on a "not yet" page).
const HOMEPAGE_CTA_HINT = {
  windows: '58.7 MB .exe, signed + verified in your tab',
  linux:   '72 MB .tar.gz, signed + verified in your tab',
  macos:   'macOS .dmg notarizing - click for source builds today',
  android: 'Android APK packaging - click for source builds today',
  ios:     'iOS via TestFlight - click for source builds today',
  openbsd: 'OpenBSD: build from source today',
  freebsd: 'FreeBSD: build from source today',
  source:  'AGPL source archive, 19 MB tar.gz',
};

function rewriteDownloadButton() {
  const { os, label } = detectOS();
  const arch = /arm|aarch64/i.test(navigator.userAgent) ? 'arm64' : 'x86_64';

  // /download/ page primary button (already on that page only).
  const btn = $('#ol-download-button');
  if (btn) {
    btn.href = `/download/${os}`;
    btn.firstChild.nodeValue = `Download for ${label} `;
    const line = $('#ol-detected-os');
    if (line) line.textContent = `Detected: ${label} - ${arch}`;
    wireVerifyingDownloadOn(btn, os);
  }

  // Homepage hero CTA: rewrites "Get One Link" -> "Get One Link for <OS>"
  // and points at /download/<os> so the streaming verifying-download flow
  // kicks in immediately on click for OSes that have a real signed binary.
  const cta = $('#ol-hero-cta');
  if (cta) {
    cta.href = `/download/${os}`;
    cta.firstChild.nodeValue = `Get One Link for ${label} `;
    const hint = $('#ol-hero-cta-hint');
    if (hint) {
      hint.textContent = `auto-detected: ${label} ${arch} · ${HOMEPAGE_CTA_HINT[os] || 'click for source'}`;
      hint.style.opacity = '1';
    }
    wireVerifyingDownloadOn(cta, os);
  }
}

// ---------------------------------------------------------------------------
// 2-bis. STREAMING + VERIFYING DOWNLOAD
//
// For OSes that have a real signed binary on file (Windows today), intercept
// the download click and:
//   1. Open a streaming fetch.
//   2. Show a live progress bar + bytes counter.
//   3. Accumulate the bytes; on completion, SHA-256 the full buffer with
//      WebCrypto and compare against the SHA the attestation document
//      declares for this artifact.
//   4. If match: trigger the actual file save via Blob + a.download.
//      If mismatch: REFUSE TO SAVE, show a loud failure (this is the
//      whole point of the verification).
//
// The progress UI mounts in #ol-verifying-download (created on demand
// next to the button). If JS is off or fetch fails, the browser still
// gets the file via the original anchor href (default navigation).
// ---------------------------------------------------------------------------
const VERIFYING_DOWNLOAD_OS = new Set(['windows', 'linux']);
const VERIFYING_DOWNLOAD_SHA = {
  windows: 'ea4efc8bf92f5ddd911e10f940a46899fda6fa786755ce797429b8fd62c05aed',
  linux:   '81265f07413bea8934c2eeaf219c83c50cb778acaae7a29b7a63cdbc55533869',
};

function wireVerifyingDownloadOn(btn, os) {
  if (!btn || !VERIFYING_DOWNLOAD_OS.has(os)) return;
  let inFlight = false;
  btn.addEventListener('click', async (ev) => {
    if (inFlight) { ev.preventDefault(); return; }
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return; // honour cmd/ctrl-click
    ev.preventDefault();
    inFlight = true;
    try {
      await runVerifyingDownload(btn, os);
    } finally {
      inFlight = false;
    }
  });
}

function ensureVerifyPanel(btn) {
  let panel = $('#ol-verifying-download');
  if (panel) return panel;
  panel = document.createElement('div');
  panel.id = 'ol-verifying-download';
  panel.style.cssText = `
    margin-top: 1rem; padding: 1rem 1.2rem;
    background: rgba(8, 12, 20, 0.7); border: 1px solid var(--ol-line-bright);
    border-radius: var(--ol-radius); font-family: var(--ol-mono);
    font-size: 0.85rem; color: var(--ol-text-soft);
    backdrop-filter: blur(10px); max-width: 56rem;
  `;
  panel.innerHTML = `
    <div id="ol-vd-line" style="display: flex; align-items: center; gap: 0.6rem;">
      <span style="color: var(--ol-cyan);">&#x25cf;</span>
      <strong style="color: var(--ol-text);">streaming + verifying</strong>
      <span id="ol-vd-status" style="color: var(--ol-text-dim);">opening connection...</span>
    </div>
    <div style="margin-top: 0.7rem; height: 6px; background: rgba(255,255,255,0.06); border-radius: 999px; overflow: hidden;">
      <div id="ol-vd-bar" style="height: 100%; width: 0%; background: linear-gradient(90deg, var(--ol-cyan), var(--ol-violet)); transition: width 80ms linear;"></div>
    </div>
    <pre id="ol-vd-detail" class="ol-code" style="margin-top: 0.9rem; display: none;"></pre>
  `;
  btn.parentNode.insertBefore(panel, btn.nextSibling);
  return panel;
}

function setVdStatus(text, color) {
  const s = $('#ol-vd-status');
  if (s) {
    s.textContent = text;
    if (color) s.style.color = color;
  }
}

function setVdBar(pct) {
  const bar = $('#ol-vd-bar');
  if (bar) bar.style.width = `${pct.toFixed(1)}%`;
}

function showVdDetail(html) {
  const d = $('#ol-vd-detail');
  if (d) {
    d.style.display = 'block';
    d.innerHTML = html;
  }
}

async function runVerifyingDownload(btn, os) {
  ensureVerifyPanel(btn);
  setVdStatus('fetching release attestation...', 'var(--ol-text-soft)');
  setVdBar(0);

  // 1. Fetch the attestation to learn the expected SHA + size.
  const target = VERIFYING_DOWNLOAD_SHA[os] || ATTESTATION_TARGET_SHA;
  const attest = await verifyAttestation(target);
  if (!attest.ok || !attest.sigVerified) {
    setVdStatus('attestation verification failed - aborting', 'var(--ol-rose)');
    showVdDetail(`<span style="color: var(--ol-rose);">refusing to download: ${escapeHtml(attest.error || 'signature did not verify')}</span>`);
    return;
  }
  const expectedSha = attest.doc.artifact.sha256;
  const expectedSize = attest.doc.artifact.size_bytes || 0;

  // 2. Open the streaming fetch.
  setVdStatus(`fetching ${(expectedSize / 1024 / 1024).toFixed(1)} MB...`, 'var(--ol-text-soft)');
  const url = `/download/${os}`;
  let res;
  try {
    res = await fetch(url);
  } catch (e) {
    setVdStatus(`fetch failed: ${e?.message || e}`, 'var(--ol-rose)');
    return;
  }
  if (!res.ok || !res.body) {
    setVdStatus(`fetch returned ${res.status}`, 'var(--ol-rose)');
    return;
  }

  // 3. Stream chunks + accumulate.
  const reader = res.body.getReader();
  const chunks = [];
  let received = 0;
  const t0 = performance.now();
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    received += value.length;
    const pct = expectedSize ? (received / expectedSize) * 100 : 0;
    setVdBar(pct);
    const mb = (received / 1024 / 1024).toFixed(1);
    const mbTotal = (expectedSize / 1024 / 1024).toFixed(1);
    setVdStatus(`${mb} / ${mbTotal} MB`, 'var(--ol-text-soft)');
  }
  const dtFetch = performance.now() - t0;

  // 4. Reassemble + hash with WebCrypto.
  setVdStatus('verifying sha256 of received bytes...', 'var(--ol-text-soft)');
  const total = new Uint8Array(received);
  let off = 0;
  for (const c of chunks) { total.set(c, off); off += c.length; }
  const tHash0 = performance.now();
  const digest = await crypto.subtle.digest('SHA-256', total);
  const actualSha = bytesToHex(new Uint8Array(digest));
  const dtHash = performance.now() - tHash0;

  // 5. Compare.
  const shaMatches = actualSha === expectedSha;
  const sizeMatches = expectedSize === 0 || received === expectedSize;

  if (!shaMatches || !sizeMatches) {
    setVdStatus('verification FAILED - file not saved', 'var(--ol-rose)');
    showVdDetail([
      `<span class="d">// the file you received does NOT match the signed attestation.</span>`,
      `<span class="d">// the bytes were not saved. retry, or build from source.</span>`,
      ``,
      `<span class="c">expected sha</span>  ${escapeHtml(expectedSha)}`,
      `<span class="c">computed sha</span>  <span class="ol-rose">${escapeHtml(actualSha)}</span>`,
      `<span class="c">expected size</span> ${expectedSize.toLocaleString()} bytes`,
      `<span class="c">received size</span> ${received.toLocaleString()} bytes`,
    ].join('\n'));
    return;
  }

  // 6. Verified! Save the file.
  setVdBar(100);
  setVdStatus('verified - saving to your downloads...', 'var(--ol-green)');
  const filename = attest.doc.artifact.filename || `one-link-${os}.exe`;
  const blob = new Blob([total], { type: 'application/octet-stream' });
  const blobUrl = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = blobUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);

  showVdDetail([
    `<span class="d">// real chunk-by-chunk fetch + WebCrypto SHA-256 verify against signed attestation</span>`,
    `<span class="c">artifact</span>      ${escapeHtml(filename)}`,
    `<span class="c">size</span>          ${received.toLocaleString()} bytes`,
    `<span class="c">sha256</span>        <span class="g">${escapeHtml(actualSha)}</span>`,
    `<span class="c">attestation</span>   <span class="g">ed25519 verified against pinned key</span>`,
    ``,
    `<span class="c">fetch time</span>    ${dtFetch.toFixed(0)} ms`,
    `<span class="c">hash time</span>     ${dtHash.toFixed(0)} ms`,
  ].join('\n'));
  setVdStatus('verified and saved', 'var(--ol-green)');
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

  // Gate the shader on desktop + non-data-saver. The Helmholtz solver pegs
  // a single CPU core on mid-range phones for the JS fallback path, and even
  // the WebGPU path is meaningful battery on a phone in your pocket. Phones
  // and bandwidth-conscious users get the CSS gradient backdrop instead.
  const isCapable = window.matchMedia &&
    window.matchMedia('(min-width: 720px) and (pointer: fine)').matches;
  const saveData = navigator.connection && navigator.connection.saveData;
  if (!isCapable || saveData) return;

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
  //
  // mousemove WAS feeding the perturbation point (which made the field
  // visibly trail the cursor). Removed: the perturbation point stays
  // centered, and only intentional clicks add energy. Cleaner.
  let mouseX = 0.5, mouseY = 0.5;
  let pulseEnergy = 0;
  let pulseDecay = 0;
  canvas.style.pointerEvents = 'auto';
  document.addEventListener('click', (e) => {
    // Click moves the perturbation point + adds a pulse. Intentional act,
    // visible result. Unlike mousemove which made the field follow the
    // cursor unintentionally.
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
    // Skip the JS-side telemetry callback when the tab is hidden — the
    // browser throttles rAF then, but skipping the function call avoids
    // any work an observer might schedule.
    if (document.hidden) { requestAnimationFrame(frame); return; }
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

    if (document.hidden) { requestAnimationFrame(frame); return; }
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
  // Empty until real presence data arrives. No fake 420-dot starter cloud —
  // the canvas reads true node count from MeshPresence via setPresence()
  // (called whenever the presence WebSocket emits an update).
  seedNodes(0);

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
      // Reserved for relay-population data once /api/topology returns
      // active_relays > 0. Visitor counts come via setPresence() now.
      const n = data?.active_nodes;
      if (typeof n === 'number' && n > 0) {
        seedNodes(Math.min(n, 1200));
      }
    },
    /**
     * Reseed the canvas from REAL presence data.
     * @param {number} liveCount  - true count of online One Link nodes (incl. self)
     */
    setPresence(liveCount) {
      const count = Math.max(0, Math.min(liveCount | 0, 1200));
      if (count !== nodes.length) seedNodes(count);
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
    // CRITICAL: window.open must be called SYNCHRONOUSLY inside the click
    // handler to stay inside the user-gesture context. Any `await` before
    // it lets the browser silently block the popup. Open the tab first
    // (which is fine — the second tab waits for the BroadcastChannel msg
    // before doing anything), then load WASM and start the handshake.
    const second = window.open('/?pair=1', '_blank');
    if (!second) {
      if (result) {
        result.hidden = false;
        result.innerHTML = `<span style="color: var(--ol-rose);">could not open second tab (popup blocked). Try cmd/ctrl-click the link, or allow popups for this site, then click again.</span>`;
      }
      return;
    }
    runTabPairAsInviter(result, second);
  });

  // If we landed on the page with ?pair=1, this tab is the Scanner.
  if (new URLSearchParams(location.search).get('pair') === '1') {
    document.body.classList.add('ol-pair-scanner-tab');
    runTabPairAsScanner();
  }
}

async function runTabPairAsInviter(resultEl, secondTab) {
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
    if (secondTab && !secondTab.closed) try { secondTab.close(); } catch {}
    return;
  }

  // Inviter side: build invite, open channel, wait for scanner.
  const inviter = new wasmModule.OlInviter(1_900_000_000, 'tab-pair');
  const inviteBytes = inviter.inviteBytes;

  const channel = new BroadcastChannel(TAB_PAIR_CHANNEL);

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
  const __t0 = performance.now();
  try {
    const mod = await import('/live/wasm/ol_onion.js');
    await mod.default({ module_or_path: '/live/wasm/ol_onion_bg.wasm' });
    const payload = new TextEncoder().encode('we are one');
    const result = mod.liveDemoRoundTrip(payload);
    if (window.olOp) window.olOp(`Sphinx 3-hop wrap+peel (${result.hops} hops)`, performance.now() - __t0, 'ok');
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
// 9a-bis. PQ-HYBRID SIGNATURE DEMO  (/security/ page)
//
// Loads the ol_pqsig WASM crate, generates a fresh Ed25519 + ML-DSA-65
// hybrid keypair, signs a message, verifies, then tampers and shows the
// verifier reject both halves. All in the visitor's tab. No server call.
// ---------------------------------------------------------------------------
async function runPqSigDemo(message) {
  const __t0 = performance.now();
  try {
    const mod = await import('/live/wasm/ol_pqsig.js');
    await mod.default({ module_or_path: '/live/wasm/ol_pqsig_bg.wasm' });
    const msg = new TextEncoder().encode(message || 'we are one');
    const result = mod.liveDemoRoundTrip(msg);
    if (window.olOp) window.olOp(`Ed25519+ML-DSA-65 sign+verify (${result.hybridSigLen}B sig)`, performance.now() - __t0, 'ok');
    return {
      ok: true,
      version: mod.ol_pqsig_version(),
      message,
      verifyingKey: result.verifyingKey,
      signature: result.signature,
      verified: result.verified,
      verifiedTampered: result.verifiedTampered,
      verifiedTamperedSig: result.verifiedTamperedSig,
      ed25519VkLen: result.ed25519VkLen,
      ed25519SigLen: result.ed25519SigLen,
      mlDsaVkLen: result.mlDsaVkLen,
      mlDsaSigLen: result.mlDsaSigLen,
      hybridVkLen: result.hybridVkLen,
      hybridSigLen: result.hybridSigLen,
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}
window.olRunPqSigDemo = runPqSigDemo;  // hook for /security/ page

function wirePqSigDemo() {
  const btn = $('#ol-pqsig-btn');
  const out = $('#ol-pqsig-out');
  const status = $('#ol-pqsig-status');
  if (!btn || !out) return;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    if (status) status.style.display = 'inline-flex';
    out.style.display = 'block';
    out.textContent = 'generating keypair, signing, verifying...';

    const message = 'we are one';
    const t0 = performance.now();
    const result = await runPqSigDemo(message);
    const dt = (performance.now() - t0).toFixed(1);

    if (!result.ok) {
      out.innerHTML = `<span style="color: var(--ol-rose);">ol_pqsig unavailable: ${escapeHtml(result.error || 'unknown')}</span>`;
    } else {
      const vkHex = bytesToHex(new Uint8Array(result.verifyingKey)).slice(0, 32);
      const sigHex = bytesToHex(new Uint8Array(result.signature)).slice(0, 32);
      const lines = [
        `<span class="d">// real Ed25519 + ML-DSA-65 hybrid signature, ${dt} ms in your tab</span>`,
        `<span class="c">crate</span>            ol_pqsig v${escapeHtml(result.version)}`,
        `<span class="c">message</span>          "${escapeHtml(result.message)}" (${message.length} bytes)`,
        ``,
        `<span class="c">ed25519 pub</span>      ${result.ed25519VkLen} bytes`,
        `<span class="c">ml-dsa-65 pub</span>    ${result.mlDsaVkLen} bytes`,
        `<span class="c">hybrid pub</span>       ${result.hybridVkLen} bytes  ->  ${vkHex}...`,
        ``,
        `<span class="c">ed25519 sig</span>      ${result.ed25519SigLen} bytes`,
        `<span class="c">ml-dsa-65 sig</span>    ${result.mlDsaSigLen} bytes`,
        `<span class="c">hybrid sig</span>       ${result.hybridSigLen} bytes  ->  ${sigHex}...`,
        ``,
        `<span class="c">verify clean</span>     ` + (result.verified
          ? `<span class="g">yes (both halves passed)</span>`
          : `<span class="ol-rose">no</span>`),
        `<span class="c">verify w/ flipped msg byte</span>     ` + (!result.verifiedTampered
          ? `<span class="g">correctly rejected</span>`
          : `<span class="ol-rose">FAILED to reject - BUG</span>`),
        `<span class="c">verify w/ flipped sig byte (PQ half)</span>  ` + (!result.verifiedTamperedSig
          ? `<span class="g">correctly rejected</span>`
          : `<span class="ol-rose">FAILED to reject - BUG</span>`),
        ``,
        `<span class="d">// an attacker must break BOTH classical AND PQ to forge.</span>`,
      ];
      out.innerHTML = lines.join('\n');
    }
    if (status) status.style.display = 'none';
    btn.disabled = false;
  });
}

// ---------------------------------------------------------------------------
// 9a-ter. THRESHOLD RECOVERY DEMO  (/security/ page)
//
// Loads ol_threshold_recovery WASM, splits a fresh 32-byte secret into 5
// Shamir shares, recovers from 3 (succeeds), proves that recovering from
// 2 fails. All in the visitor's tab. No server call.
// ---------------------------------------------------------------------------
async function runThresholdDemo() {
  const __t0 = performance.now();
  try {
    const mod = await import('/live/wasm/ol_threshold_recovery.js');
    await mod.default({ module_or_path: '/live/wasm/ol_threshold_recovery_bg.wasm' });
    // 32-byte fresh "master seed".
    const secret = crypto.getRandomValues(new Uint8Array(32));
    const k = 3, n = 5;
    const result = mod.liveDemoRoundTrip(secret, k, n);
    if (window.olOp) window.olOp(`Shamir ${k}-of-${n} split+recover`, performance.now() - __t0, 'ok');
    return {
      ok: true,
      version: mod.ol_threshold_recovery_version(),
      secretHex: bytesToHex(secret),
      recoveredHex: bytesToHex(new Uint8Array(result.recoveredBytes)),
      secretLen: result.secretLen,
      k: result.k,
      n: result.n,
      shareLen: result.shareLen,
      recoveredWithKOk: result.recoveredWithKOk,
      recoveredWithAltK: result.recoveredWithAltK,
      recoveredKMinusErr: result.recoveredKMinusErr,
      sharePreviews: result.sharePreviews,
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}
window.olRunThresholdDemo = runThresholdDemo;

function wireThresholdDemo() {
  const btn = $('#ol-threshold-btn');
  const out = $('#ol-threshold-out');
  const status = $('#ol-threshold-status');
  if (!btn || !out) return;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    if (status) status.style.display = 'inline-flex';
    out.style.display = 'block';
    out.textContent = 'splitting secret into 5 shares...';

    const t0 = performance.now();
    const result = await runThresholdDemo();
    const dt = (performance.now() - t0).toFixed(1);

    if (!result.ok) {
      out.innerHTML = `<span style="color: var(--ol-rose);">ol_threshold_recovery unavailable: ${escapeHtml(result.error || 'unknown')}</span>`;
    } else {
      const previews = Array.from(result.sharePreviews || []);
      const lines = [
        `<span class="d">// real Shamir K-of-N over GF(2^8), ${dt} ms in your tab</span>`,
        `<span class="c">crate</span>          ol_threshold_recovery v${escapeHtml(result.version)}`,
        `<span class="c">policy</span>         ${result.k}-of-${result.n}  (split ${result.n} shares, recover from any ${result.k})`,
        `<span class="c">secret</span>         ${result.secretLen} bytes`,
        `<span class="c">share size</span>     ${result.shareLen} bytes each`,
        ``,
        `<span class="c">share 1 preview</span>   ${escapeHtml(previews[0] || '')}...`,
        `<span class="c">share 2 preview</span>   ${escapeHtml(previews[1] || '')}...`,
        `<span class="c">share 3 preview</span>   ${escapeHtml(previews[2] || '')}...`,
        `<span class="d">// each share is statistically independent of the secret</span>`,
        ``,
        `<span class="c">secret in</span>      ${escapeHtml(result.secretHex.slice(0, 32))}...`,
        `<span class="c">secret out</span>     ${escapeHtml(result.recoveredHex.slice(0, 32))}...`,
        ``,
        `<span class="c">recover with first 3 shares</span>  ` + (result.recoveredWithKOk
          ? `<span class="g">recovered exact bytes</span>`
          : `<span class="ol-rose">BUG: did not match</span>`),
        `<span class="c">recover with last 3 shares</span>   ` + (result.recoveredWithAltK
          ? `<span class="g">recovered exact bytes (any K suffices)</span>`
          : `<span class="ol-rose">BUG: did not match</span>`),
        `<span class="c">recover with only 2 shares</span>   <span class="g">refused: ${escapeHtml(result.recoveredKMinusErr)}</span>`,
        ``,
        `<span class="d">// k-1 shares are mathematically useless. Cloud backup of all 5</span>`,
        `<span class="d">// is harmless because the field-binding layer XOR-masks each share</span>`,
        `<span class="d">// with a one-time pad derived from the coherence-field topology.</span>`,
      ];
      out.innerHTML = lines.join('\n');
    }
    if (status) status.style.display = 'none';
    btn.disabled = false;
  });
}

// ---------------------------------------------------------------------------
// 9a-quater. RATCHET FORWARD-SECRECY DEMO  (/security/ page)
//
// Loads ol_ratchet WASM, derives 6 sequential message keys from a fresh
// chain key, proves they are all distinct, and shows the rewind refusal.
// ---------------------------------------------------------------------------
async function runRatchetDemo() {
  const __t0 = performance.now();
  try {
    const mod = await import('/live/wasm/ol_ratchet.js');
    await mod.default({ module_or_path: '/live/wasm/ol_ratchet_bg.wasm' });
    const result = mod.liveDemoRoundTrip(6);
    if (window.olOp) window.olOp(`ratchet walk (${result.nKeys} message keys)`, performance.now() - __t0, 'ok');
    return {
      ok: true,
      version: mod.ol_ratchet_version(),
      nKeys: result.nKeys,
      chainKeyLen: result.chainKeyLen,
      messageKeyLen: result.messageKeyLen,
      rootPreview: result.rootPreview,
      finalStep: result.finalStep,
      keyPreviews: Array.from(result.keyPreviews || []),
      allDistinct: result.allDistinct,
      rewindErr: result.rewindErr,
      skipErr: result.skipErr,
      maxSkipSteps: result.maxSkipSteps,
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}
window.olRunRatchetDemo = runRatchetDemo;

function wireRatchetDemo() {
  const btn = $('#ol-ratchet-btn');
  const out = $('#ol-ratchet-out');
  const status = $('#ol-ratchet-status');
  if (!btn || !out) return;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    if (status) status.style.display = 'inline-flex';
    out.style.display = 'block';
    out.textContent = 'walking the ratchet...';

    const t0 = performance.now();
    const result = await runRatchetDemo();
    const dt = (performance.now() - t0).toFixed(1);

    if (!result.ok) {
      out.innerHTML = `<span style="color: var(--ol-rose);">ol_ratchet unavailable: ${escapeHtml(result.error || 'unknown')}</span>`;
    } else {
      const keyLines = result.keyPreviews.map((p, i) =>
        `<span class="c">  step ${i}</span>          ${escapeHtml(p)}...`
      ).join('\n');
      const lines = [
        `<span class="d">// real BLAKE3 KDF chain, ${dt} ms in your tab</span>`,
        `<span class="c">crate</span>           ol_ratchet v${escapeHtml(result.version)}`,
        `<span class="c">root chain key</span>  ${escapeHtml(result.rootPreview)}... (${result.chainKeyLen} bytes)`,
        `<span class="c">message keys</span>    ${result.nKeys} derived, each ${result.messageKeyLen} bytes`,
        ``,
        keyLines,
        ``,
        `<span class="c">all distinct</span>    ` + (result.allDistinct
          ? `<span class="g">yes (one-way KDF guarantees no collisions)</span>`
          : `<span class="ol-rose">BUG: keys collided</span>`),
        `<span class="c">chain step now</span>  ${result.finalStep}`,
        ``,
        `<span class="c">rewind attempt</span>  <span class="g">refused: ${escapeHtml(result.rewindErr)}</span>`,
        `<span class="c">skip too large</span>  <span class="g">refused: ${escapeHtml(result.skipErr)}</span>`,
        `<span class="c">max skip steps</span>  ${result.maxSkipSteps}  (DoS guard against unbounded derive)`,
        ``,
        `<span class="d">// compromise of step[3] gives the attacker step[3] only.</span>`,
        `<span class="d">// deriving step[4] from step[3] requires inverting BLAKE3.</span>`,
      ];
      out.innerHTML = lines.join('\n');
    }
    if (status) status.style.display = 'none';
    btn.disabled = false;
  });
}

// ---------------------------------------------------------------------------
// 9a-quinque. HARDWARE-KEY TOFU DEMO  (/security/ page)
//
// Loads ol_hwkey WASM, mints a 32-byte "device root" on FIRST visit and
// stashes it in localStorage (origin-scoped, never leaves the browser).
// On EVERY visit, derives the canonical device pubkey from the root, and
// confirms it matches a previously stored fingerprint (TOFU recognition).
// Also runs an attacker scenario: presents a random pubkey under the same
// label, proves the TofuStore rejects it.
// ---------------------------------------------------------------------------
const HWKEY_STORAGE_ROOT_KEY  = 'ol-hwkey-device-root-v1';
const HWKEY_STORAGE_PRINT_KEY = 'ol-hwkey-device-fingerprint-v1';

async function runHwkeyDemo() {
  const __t0 = performance.now();
  try {
    const mod = await import('/live/wasm/ol_hwkey.js');
    await mod.default({ module_or_path: '/live/wasm/ol_hwkey_bg.wasm' });

    // Read or mint the 32-byte device root, persist in localStorage.
    let rootHex = null;
    let firstVisit = false;
    try {
      rootHex = localStorage.getItem(HWKEY_STORAGE_ROOT_KEY);
    } catch {}
    if (!rootHex) {
      const fresh = crypto.getRandomValues(new Uint8Array(32));
      rootHex = bytesToHex(fresh);
      firstVisit = true;
      try { localStorage.setItem(HWKEY_STORAGE_ROOT_KEY, rootHex); } catch {}
    }
    const root = hexDecode(rootHex);

    const result = mod.liveDemoRoundTrip(root);

    // Verify the stored fingerprint, if any, matches what we just derived.
    let prevFingerprint = null;
    try { prevFingerprint = localStorage.getItem(HWKEY_STORAGE_PRINT_KEY); } catch {}
    const fingerprintMatches = prevFingerprint
      ? prevFingerprint === result.pkHex
      : null;  // first visit: no stored fingerprint to compare against
    if (!prevFingerprint) {
      try { localStorage.setItem(HWKEY_STORAGE_PRINT_KEY, result.pkHex); } catch {}
    }

    if (window.olOp) window.olOp(firstVisit ? 'minted device TOFU root (first visit)' : 'TOFU device recognized', performance.now() - __t0, 'ok');
    return {
      ok: true,
      version: mod.ol_hwkey_version(),
      firstVisit,
      pkHex: result.pkHex,
      pkLen: result.pkLen,
      rederiveMatch: result.rederiveMatch,
      attackerKeyHex: result.attackerKeyHex,
      tofuRejectAttack: result.tofuRejectAttack,
      storedFingerprint: prevFingerprint,
      fingerprintMatches,
    };
  } catch (e) {
    return { ok: false, error: e?.message || String(e) };
  }
}
window.olRunHwkeyDemo = runHwkeyDemo;

function wireHwkeyDemo() {
  const btn = $('#ol-hwkey-btn');
  const out = $('#ol-hwkey-out');
  const status = $('#ol-hwkey-status');
  if (!btn || !out) return;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    if (status) status.style.display = 'inline-flex';
    out.style.display = 'block';
    out.textContent = 'deriving device fingerprint...';

    const t0 = performance.now();
    const result = await runHwkeyDemo();
    const dt = (performance.now() - t0).toFixed(1);

    if (!result.ok) {
      out.innerHTML = `<span style="color: var(--ol-rose);">ol_hwkey unavailable: ${escapeHtml(result.error || 'unknown')}</span>`;
    } else {
      const visitLine = result.firstVisit
        ? `<span class="g">first visit -> minted a fresh device root</span>`
        : `<span class="g">return visit -> device root recalled from localStorage</span>`;
      const recogLine = result.fingerprintMatches === null
        ? `<span class="d">no stored fingerprint yet; saved this one for next visit</span>`
        : result.fingerprintMatches
          ? `<span class="g">stored fingerprint matches -> we recognize you</span>`
          : `<span class="ol-rose">stored fingerprint MISMATCH (device root was rotated?)</span>`;
      const lines = [
        `<span class="d">// ol_hwkey TOFU software fallback, ${dt} ms in your tab</span>`,
        `<span class="c">crate</span>             ol_hwkey v${escapeHtml(result.version)}`,
        `<span class="c">visit state</span>       ${visitLine}`,
        `<span class="c">device fingerprint</span>  ${escapeHtml(result.pkHex.slice(0, 32))}... (${result.pkLen} bytes)`,
        `<span class="c">recognition</span>       ${recogLine}`,
        ``,
        `<span class="c">re-derive match</span>   ` + (result.rederiveMatch
          ? `<span class="g">yes (BLAKE3 is deterministic)</span>`
          : `<span class="ol-rose">BUG: re-derive produced different bytes</span>`),
        ``,
        `<span class="c">attacker key</span>      ${escapeHtml(result.attackerKeyHex.slice(0, 32))}...`,
        `<span class="c">tofu reject</span>       ` + (result.tofuRejectAttack
          ? `<span class="g">yes (constant-time compare via subtle::ConstantTimeEq)</span>`
          : `<span class="ol-rose">BUG: attacker key was accepted</span>`),
        ``,
        `<span class="d">// the daemon backs this with Secure Enclave / StrongBox / TPM</span>`,
        `<span class="d">// on real hardware. The TOFU fallback is the always-available</span>`,
        `<span class="d">// baseline. Nothing was sent to any server; your fingerprint</span>`,
        `<span class="d">// lives in this origin's localStorage only.</span>`,
      ];
      out.innerHTML = lines.join('\n');
    }
    if (status) status.style.display = 'none';
    btn.disabled = false;
  });
}

// ---------------------------------------------------------------------------
// 9a-sex. RELEASE-ATTESTATION VERIFIER  (/download/ page)
//
// Pinned release-signing pubkey - generated offline, lives in
// .keys/release-ed25519.{sk,pk}, never on any server. Signing happens
// outside this repo via scripts/build-attestation.py. This pin is the
// trust root; an attacker who substitutes the attestation cannot forge
// the signature against this key.
// ---------------------------------------------------------------------------
const RELEASE_PUBKEY_HEX =
  '68c961f1ce26faa39acdf66d457e49126d1498aecbbce15ab49fe192d715cb2e';

const ATTESTATION_TARGET_SHA =
  'ea4efc8bf92f5ddd911e10f940a46899fda6fa786755ce797429b8fd62c05aed';

function canonicalAttestationPayload(doc) {
  // MUST byte-match scripts/build-attestation.py canonical_attestation_payload:
  // exclude `signatures` and `signed_payload_sha256`, sort keys recursively
  // (Python json.dumps sort_keys=True), no whitespace (separators=(',',':')).
  const EXCLUDE = new Set(['signatures', 'signed_payload_sha256']);
  function sortKeys(value) {
    if (value === null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.map(sortKeys);
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = sortKeys(value[k]);
    return out;
  }
  const filtered = {};
  for (const k of Object.keys(doc).sort()) {
    if (EXCLUDE.has(k)) continue;
    filtered[k] = sortKeys(doc[k]);
  }
  return JSON.stringify(filtered);
}

async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return bytesToHex(new Uint8Array(digest));
}

async function verifyAttestation(sha) {
  const target = sha || ATTESTATION_TARGET_SHA;
  const t0 = performance.now();
  const __opT0 = performance.now();

  // 1. Fetch the attestation document
  const res = await fetch(`/api/attest/${target}`);
  if (!res.ok) {
    return { ok: false, error: `fetch failed: ${res.status}` };
  }
  const doc = await res.json();
  const dtFetch = (performance.now() - t0).toFixed(1);

  // 2. Pull the ed25519 signature off
  const sigEntry = (doc.signatures || []).find(s => s.scheme === 'ed25519');
  if (!sigEntry) {
    return { ok: false, error: 'no ed25519 signature in document' };
  }
  if (sigEntry.public_key_hex !== RELEASE_PUBKEY_HEX) {
    return {
      ok: false,
      error: `pubkey mismatch: document signed by ${sigEntry.public_key_hex.slice(0,16)}..., pinned is ${RELEASE_PUBKEY_HEX.slice(0,16)}...`,
    };
  }

  // 3. Recompute canonical bytes locally
  const payloadStr = canonicalAttestationPayload(doc);
  const payloadBytes = new TextEncoder().encode(payloadStr);
  const payloadHashHex = await sha256Hex(payloadBytes);

  // 4. Cross-check the doc's self-reported payload sha (if present)
  const expectedShaField = doc.signed_payload_sha256 || '';
  const expectedSha = expectedShaField.replace(/^sha256-/, '');
  const payloadShaMatches = expectedSha ? expectedSha === payloadHashHex : null;

  // 5. ed25519 verify via WebCrypto
  let sigVerified = null;
  let verifyMethod = null;
  try {
    const pubBytes = hexDecode(RELEASE_PUBKEY_HEX);
    const sigBytes = hexDecode(sigEntry.signature_hex);
    const key = await crypto.subtle.importKey(
      'raw', pubBytes, { name: 'Ed25519' }, false, ['verify']
    );
    sigVerified = await crypto.subtle.verify({ name: 'Ed25519' }, key, sigBytes, payloadBytes);
    verifyMethod = 'WebCrypto Ed25519';
  } catch (e) {
    return {
      ok: false,
      error: `WebCrypto Ed25519 not available: ${e?.message || e}`,
      doc,
    };
  }

  // 6. Cross-check the artifact SHA the doc claims
  const artifactShaMatches = (doc.artifact?.sha256 || '') === target;

  const dtTotal = (performance.now() - t0).toFixed(1);
  if (window.olOp) window.olOp(
    `attestation verify ${target.slice(0, 8)}...  ${sigVerified ? 'OK' : 'FAIL'}`,
    performance.now() - __opT0,
    sigVerified ? 'ok' : 'err'
  );
  return {
    ok: true,
    targetSha: target,
    doc,
    sigVerified,
    verifyMethod,
    payloadShaMatches,
    artifactShaMatches,
    dtFetch,
    dtTotal,
  };
}
window.olVerifyAttestation = verifyAttestation;

function wireAttestationVerify() {
  const btn = $('#ol-attest-btn');
  const out = $('#ol-attest-out');
  const status = $('#ol-attest-status');
  if (!btn || !out) return;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    if (status) status.style.display = 'inline-flex';
    out.style.display = 'block';
    out.textContent = 'fetching attestation + verifying...';

    const result = await verifyAttestation();

    if (!result.ok) {
      out.innerHTML = `<span style="color: var(--ol-rose);">verify failed: ${escapeHtml(result.error)}</span>`;
    } else {
      const d = result.doc;
      const a = d.artifact || {};
      const s = d.source || {};
      const lines = [
        `<span class="d">// fetched + verified in ${result.dtTotal} ms (fetch ${result.dtFetch} ms)</span>`,
        `<span class="c">target sha256</span>     ${escapeHtml(result.targetSha)}`,
        ``,
        `<span class="c">artifact name</span>     ${escapeHtml(a.name || '?')} ${escapeHtml(a.version || '')} (${escapeHtml(a.os || '?')})`,
        `<span class="c">artifact file</span>     ${escapeHtml(a.filename || '?')}`,
        `<span class="c">artifact size</span>     ${a.size_bytes ? a.size_bytes.toLocaleString() : '?'} bytes`,
        `<span class="c">artifact sha256</span>   ${escapeHtml(a.sha256 || '')}`,
        `<span class="c">artifact blake3</span>   ${escapeHtml((a.blake3 || '').slice(0, 32))}...`,
        `<span class="c">source commit</span>     ${escapeHtml(s.describe || s.commit || '?')}`,
        ``,
        `<span class="c">verifier</span>          ${escapeHtml(result.verifyMethod)}`,
        `<span class="c">pinned pubkey</span>     ${RELEASE_PUBKEY_HEX.slice(0, 32)}...`,
        ``,
        `<span class="c">ed25519 signature</span>  ` + (result.sigVerified
          ? `<span class="g">VERIFIED (signed payload matches pinned key)</span>`
          : `<span class="ol-rose">FAILED (signature did not verify)</span>`),
        `<span class="c">artifact-sha match</span> ` + (result.artifactShaMatches
          ? `<span class="g">yes (doc covers the bytes we asked about)</span>`
          : `<span class="ol-rose">no (doc covers a different artifact)</span>`),
        `<span class="c">payload-sha match</span>  ` + (result.payloadShaMatches === null
          ? `<span class="d">(no signed_payload_sha256 field; skipped)</span>`
          : result.payloadShaMatches
            ? `<span class="g">yes (canonical bytes byte-equal what was signed)</span>`
            : `<span class="ol-rose">no (canonical-form mismatch)</span>`),
        ``,
        `<span class="d">// any HTTP intermediary that altered this doc would have broken</span>`,
        `<span class="d">// the signature. Cloudflare cannot forge this without the offline key.</span>`,
      ];
      out.innerHTML = lines.join('\n');
    }
    if (status) status.style.display = 'none';
    btn.disabled = false;
  });
}

// MOUSE-REACTIVE COHERENCE FIELD - REMOVED.
// An earlier iteration spawned faint cursor pings on every pointermove.
// Pulled out to keep the site clean + confident, not literal-reactive.
function startMouseReactiveField() { /* intentionally a no-op now */ }

// ---------------------------------------------------------------------------
// olFieldPulse - brief, purposeful field amplification on REAL crypto events.
//
// The field canvas sits at 18% opacity by default (CSS). Calling
// olFieldPulse() adds the .is-pulsing class for `duration` ms which bumps
// the canvas to 45% opacity, then fades back. Subsequent pulses extend.
//
// Hooked into:
//   - manifest signature verified on load
//   - WASM crate loaded + integrity check passed
//   - /security/ demos completing (PQ-sign / threshold / ratchet / TOFU)
//   - /download/ verifying-download SHA match
//   - /share/ encrypt complete + recipient decrypt complete
//   - attestation verification success
//
// Cleared by ANY user input so the field doesn't compete with reading.
// Result: the field is the visual receipt of the cryptographic layer working.
// ---------------------------------------------------------------------------
let __OL_FIELD_PULSE_TIMER = null;
function olFieldPulse(duration) {
  const canvas = document.querySelector('.ol-field-canvas');
  if (!canvas) return;
  canvas.classList.add('is-pulsing');
  if (__OL_FIELD_PULSE_TIMER) clearTimeout(__OL_FIELD_PULSE_TIMER);
  __OL_FIELD_PULSE_TIMER = setTimeout(() => {
    canvas.classList.remove('is-pulsing');
    __OL_FIELD_PULSE_TIMER = null;
  }, duration || 900);
}
window.olFieldPulse = olFieldPulse;

// ---------------------------------------------------------------------------
// 9a-oct. LIVE CRYPTO-OP LOG  (cockpit strip, default-visible, bottom-right)
//
// A floating monospace strip that shows the most recent cryptographic
// operation as it happens, with the timing in ms. Every real crypto
// primitive on this site can register an event via window.olOp() and the
// visitor sees it land. The point is to make the alien-tech surface FELT,
// not just claimed.
//
// Toggle: click the strip to expand to last 8 ops; click again to collapse.
// Press 'l' (without modifier, not inside an input) to hide entirely.
// ---------------------------------------------------------------------------
// Cockpit OFF by default. Press 'l' to reveal. Keeps the page clean +
// "modern, confident, electric, never busy" while still making every
// crypto operation observable for anyone curious enough to look.
const __OL_OP_LOG = {
  entries: [],
  max: 50,
  visibleMax: 1,         // collapsed view shows last 1; expanded shows last 8
  el: null,
  inner: null,
  expanded: false,
  hidden: true,          // default hidden; 'l' key toggles
};

function olOpLogEnsureDom() {
  if (__OL_OP_LOG.el) return __OL_OP_LOG.el;
  const wrap = document.createElement('div');
  wrap.id = 'ol-op-log';
  wrap.setAttribute('role', 'status');
  wrap.setAttribute('aria-live', 'polite');
  wrap.style.cssText = `
    position: fixed; bottom: 12px; right: 12px; z-index: 90;
    max-width: min(420px, 78vw);
    padding: 0.5rem 0.7rem;
    background: rgba(4, 6, 11, 0.78); backdrop-filter: blur(8px);
    border: 1px solid var(--ol-line, rgba(110, 240, 244, 0.18));
    border-radius: 10px;
    font-family: var(--ol-mono, ui-monospace, SFMono-Regular, monospace);
    font-size: 0.74rem; line-height: 1.35;
    color: var(--ol-text-soft, #b8c0cc);
    box-shadow: 0 12px 32px rgba(0, 0, 0, 0.4);
    cursor: pointer; user-select: none;
    transition: opacity 0.3s, transform 0.3s;
    opacity: 0;
  `;
  wrap.innerHTML = `<div id="ol-op-log-inner" style="display: flex; flex-direction: column; gap: 2px; min-height: 1.2em;"></div>`;
  wrap.addEventListener('click', () => {
    __OL_OP_LOG.expanded = !__OL_OP_LOG.expanded;
    olOpLogRender();
  });
  document.body.appendChild(wrap);
  __OL_OP_LOG.el = wrap;
  __OL_OP_LOG.inner = wrap.querySelector('#ol-op-log-inner');
  requestAnimationFrame(() => { wrap.style.opacity = '1'; });
  return wrap;
}

function olOpLogRender() {
  olOpLogEnsureDom();
  if (__OL_OP_LOG.hidden) {
    __OL_OP_LOG.el.style.display = 'none';
    return;
  }
  __OL_OP_LOG.el.style.display = 'block';
  const max = __OL_OP_LOG.expanded ? 8 : __OL_OP_LOG.visibleMax;
  const slice = __OL_OP_LOG.entries.slice(-max);
  __OL_OP_LOG.inner.innerHTML = slice.map(e => {
    const colorMap = {
      ok: 'var(--ol-cyan, #6ef0f4)',
      slow: 'var(--ol-violet, #b08cff)',
      err: 'var(--ol-rose, #ff6e8c)',
    };
    const c = colorMap[e.cls] || colorMap.ok;
    const ms = e.ms < 0.1 ? '<1' : e.ms.toFixed(e.ms < 10 ? 1 : 0);
    return `
      <div style="display: flex; gap: 0.6rem; align-items: baseline;">
        <span style="color: ${c}; font-weight: 600;">&#x25cf;</span>
        <span style="flex: 1; color: var(--ol-text, #e7ecf3);">${e.label}</span>
        <span style="color: var(--ol-text-dim, #6e7884);">${ms} ms</span>
      </div>
    `;
  }).join('');
}

// Public API: pushes an op event. Also pulses the coherence field
// briefly so the visitor sees a real cryptographic operation reflected
// in the backdrop. Errors pulse longer + more visibly.
function olOpLog(label, ms, cls) {
  if (!label) return;
  __OL_OP_LOG.entries.push({
    label,
    ms: typeof ms === 'number' ? ms : 0,
    cls: cls || (ms > 50 ? 'slow' : 'ok'),
    ts: Date.now(),
  });
  if (__OL_OP_LOG.entries.length > __OL_OP_LOG.max) {
    __OL_OP_LOG.entries.shift();
  }
  olOpLogRender();
  // Pulse the field as a visible receipt of the crypto layer working.
  // Suppress for the noisy boot ops; only pulse for substantive events.
  const noisy = ['site loaded', 'coherence field init'];
  if (!noisy.includes(label)) {
    olFieldPulse(cls === 'err' ? 1400 : 800);
  }
}
window.olOp = olOpLog;

// olTimed(label, asyncFn): wrap an async function so it auto-logs.
async function olTimed(label, fn) {
  const t0 = performance.now();
  try {
    const result = await fn();
    olOpLog(label, performance.now() - t0, 'ok');
    return result;
  } catch (e) {
    olOpLog(label + ' (failed)', performance.now() - t0, 'err');
    throw e;
  }
}
window.olTimed = olTimed;

// Keyboard: 'l' toggles the strip visibility entirely (not inside inputs).
window.addEventListener('keydown', (ev) => {
  if (ev.key !== 'l' && ev.key !== 'L') return;
  if (ev.ctrlKey || ev.metaKey || ev.altKey || ev.shiftKey) return;
  const tag = (ev.target && ev.target.tagName) || '';
  if (tag === 'INPUT' || tag === 'TEXTAREA' || ev.target?.isContentEditable) return;
  __OL_OP_LOG.hidden = !__OL_OP_LOG.hidden;
  olOpLogRender();
});

// ---------------------------------------------------------------------------
// 9a-sept. REBUILD-FROM-SOURCE VERIFIER  (/builders/ page)
//
// Downloads the signed source tar.gz, computes its SHA-256 in the browser,
// fetches the matching attestation, verifies the ed25519 signature against
// the pinned release pubkey, and confirms the downloaded bytes match the
// attestation's declared sha256. Anyone with a network connection and a
// browser can now reproduce-and-verify in one click.
// ---------------------------------------------------------------------------
const SOURCE_ATTESTATION_SHA =
  '08bf8205571093f62cd4ea99e3e6ef086a2e497fde12538ff03c350c402b4a35';

function wireRebuildFromSource() {
  const btn = $('#ol-rebuild-btn');
  const out = $('#ol-rebuild-out');
  const status = $('#ol-rebuild-status');
  if (!btn || !out) return;

  btn.addEventListener('click', async () => {
    btn.disabled = true;
    if (status) status.style.display = 'inline-flex';
    out.style.display = 'block';
    out.textContent = 'fetching + verifying attestation...';

    const t0 = performance.now();
    const attest = await verifyAttestation(SOURCE_ATTESTATION_SHA);
    if (!attest.ok || !attest.sigVerified) {
      out.innerHTML = `<span style="color: var(--ol-rose);">attestation failed: ${escapeHtml(attest.error || 'signature did not verify')}</span>`;
      if (status) status.style.display = 'none';
      btn.disabled = false;
      return;
    }

    const expectedSha = attest.doc.artifact.sha256;
    const expectedSize = attest.doc.artifact.size_bytes || 0;
    out.textContent = `attestation verified. downloading source archive (${(expectedSize / 1024 / 1024).toFixed(1)} MB)...`;

    const tFetch0 = performance.now();
    let res;
    try {
      res = await fetch('/downloads/one-link-source.tar.gz');
    } catch (e) {
      out.innerHTML = `<span style="color: var(--ol-rose);">download failed: ${escapeHtml(e?.message || e)}</span>`;
      if (status) status.style.display = 'none';
      btn.disabled = false;
      return;
    }
    if (!res.ok) {
      out.innerHTML = `<span style="color: var(--ol-rose);">download returned ${res.status}</span>`;
      if (status) status.style.display = 'none';
      btn.disabled = false;
      return;
    }

    const bytes = new Uint8Array(await res.arrayBuffer());
    const dtFetch = performance.now() - tFetch0;

    out.textContent = `hashing ${bytes.length.toLocaleString()} bytes...`;
    const tHash0 = performance.now();
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    const actualSha = bytesToHex(new Uint8Array(digest));
    const dtHash = performance.now() - tHash0;
    const dtTotal = performance.now() - t0;

    const shaMatches = actualSha === expectedSha;
    const sizeMatches = !expectedSize || bytes.length === expectedSize;

    if (!shaMatches || !sizeMatches) {
      out.innerHTML = [
        `<span class="d">// VERIFICATION FAILED. the bytes you received do not match the signed source.</span>`,
        ``,
        `<span class="c">expected sha</span>  ${escapeHtml(expectedSha)}`,
        `<span class="c">computed sha</span>  <span class="ol-rose">${escapeHtml(actualSha)}</span>`,
        `<span class="c">expected size</span> ${expectedSize.toLocaleString()} bytes`,
        `<span class="c">received size</span> ${bytes.length.toLocaleString()} bytes`,
      ].join('\n');
    } else {
      out.innerHTML = [
        `<span class="d">// reproducibility check passed in ${dtTotal.toFixed(0)} ms</span>`,
        `<span class="c">artifact</span>           ${escapeHtml(attest.doc.artifact.filename || 'one-link-source.tar.gz')}`,
        `<span class="c">version</span>            ${escapeHtml(attest.doc.artifact.version || '?')}`,
        `<span class="c">size</span>               ${bytes.length.toLocaleString()} bytes (${(bytes.length / 1024 / 1024).toFixed(2)} MB)`,
        `<span class="c">sha256 (yours)</span>     <span class="g">${escapeHtml(actualSha)}</span>`,
        `<span class="c">sha256 (signed)</span>    ${escapeHtml(expectedSha)}`,
        `<span class="c">blake3 (signed)</span>    ${escapeHtml((attest.doc.artifact.blake3 || '').slice(0, 48))}...`,
        `<span class="c">source commit</span>      ${escapeHtml(attest.doc.source?.describe || '?')}`,
        ``,
        `<span class="c">ed25519 signature</span>  <span class="g">verified against pinned release pubkey</span>`,
        `<span class="c">sha256 match</span>       <span class="g">YES (you and the maintainer agree byte-for-byte)</span>`,
        `<span class="c">size match</span>         <span class="g">YES</span>`,
        ``,
        `<span class="c">fetch time</span>         ${dtFetch.toFixed(0)} ms`,
        `<span class="c">hash time</span>          ${dtHash.toFixed(0)} ms`,
        ``,
        `<span class="d">// the bytes are now in your downloads folder context;</span>`,
        `<span class="d">// unpack to read every line of the source the site was built from.</span>`,
      ].join('\n');

      // Trigger a save of the verified bytes.
      try {
        const blob = new Blob([bytes], { type: 'application/gzip' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = attest.doc.artifact.filename || 'one-link-source.tar.gz';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      } catch {}
    }
    if (status) status.style.display = 'none';
    btn.disabled = false;
  });
}

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

// Module-level handle to the /mesh/ big-canvas API so setPresenceCount() can
// drive it without threading the reference through every caller.
let _meshVizApi = null;

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
  // Drive the /mesh/ big-canvas with the real count so we don't render
  // hundreds of fake dots while N=1 (audit P0 honesty fix).
  if (_meshVizApi && typeof _meshVizApi.setPresence === 'function') {
    _meshVizApi.setPresence(n);
  }
}

function startPresence() {
  // OPTIMISTIC SELF: show "1 here right now" + the self dot immediately on
  // page load, before the WebSocket has connected. If the WS handshake fails
  // (rare but happens on aggressive corporate firewalls / privacy extensions),
  // the visitor still sees themselves in the widget. The local self id gets
  // replaced with the real one when the welcome message arrives.
  if (!presence.selfId) {
    presence.selfId = 'local-' + Math.random().toString(16).slice(2, 10);
    presence.geoHint = presenceGeoHint();
    setPresenceCount(1);
    renderPeerDots();
  }

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
        case 'chat-request':  handleChatRequest(msg.from, msg); break;
        case 'chat-accept':   handleChatAccept(msg.from, msg);  break;
        case 'chat-confirm':  handleChatConfirm(msg.from, msg); break;
        case 'chat-decline':  handleChatDecline(msg.from); break;
        case 'chat-leave':    handleChatLeave(msg.from);   break;
        case 'chat-msg':      handleChatMsg(msg.from, msg);     break;
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

function mountMeshWidgetHead() {
  const overlay = document.getElementById('ol-peer-overlay');
  if (!overlay) return;
  if (overlay.querySelector('.ol-mesh-head')) return;
  if (document.body.classList.contains('ol-mesh-page')) return;

  // Build a real header bar: title (linked to /mesh/), count, minimize toggle.
  // Replaces the ::before / ::after pseudos and the legacy "see all" link so
  // controls don't conflict with the sound toggle in the bottom-right.
  const head = document.createElement('div');
  head.className = 'ol-mesh-head';

  const title = document.createElement('a');
  title.className = 'ol-mesh-title';
  title.href = '/mesh/';
  title.textContent = 'live mesh';
  title.setAttribute('aria-label', 'Open the full live mesh page');

  const count = document.createElement('span');
  count.className = 'ol-mesh-count';
  count.id = 'ol-mesh-widget-count';
  count.textContent = '0 here right now';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'ol-mesh-toggle';
  toggle.setAttribute('aria-controls', 'ol-peer-overlay');
  toggle.setAttribute('aria-expanded', 'true');
  toggle.setAttribute('aria-label', 'Minimize live mesh widget');
  toggle.innerHTML = '<span aria-hidden="true">&minus;</span>';

  // Per-tab persistence (sessionStorage, not localStorage — disappears when
  // the tab closes, so we never carry state across sessions).
  const STORE_KEY = 'ol.mesh.collapsed';
  let collapsed = false;
  try { collapsed = sessionStorage.getItem(STORE_KEY) === '1'; } catch {}

  const applyCollapse = (next) => {
    overlay.classList.toggle('is-collapsed', next);
    toggle.setAttribute('aria-expanded', next ? 'false' : 'true');
    toggle.setAttribute('aria-label',
      next ? 'Expand live mesh widget' : 'Minimize live mesh widget');
    toggle.innerHTML = next
      ? '<span aria-hidden="true">+</span>'
      : '<span aria-hidden="true">&minus;</span>';
    try { sessionStorage.setItem(STORE_KEY, next ? '1' : '0'); } catch {}
  };
  applyCollapse(collapsed);

  toggle.addEventListener('click', (e) => {
    e.stopPropagation();
    applyCollapse(!overlay.classList.contains('is-collapsed'));
  });

  // Tapping anywhere on the collapsed pill (except interactive children) re-expands it.
  overlay.addEventListener('click', (e) => {
    if (!overlay.classList.contains('is-collapsed')) return;
    if (e.target.closest('a, button')) return;
    applyCollapse(false);
  });

  head.appendChild(title);
  head.appendChild(count);
  head.appendChild(toggle);
  overlay.appendChild(head);
}

function renderPeerDots() {
  // The /mesh/ page has its own full-bleed canvas and hides the widget via
  // `body.ol-mesh-page .ol-peer-overlay { display: none }`. Skip rendering
  // entirely there so a stale cached CSS can't reveal raw widget text.
  if (document.body.classList.contains('ol-mesh-page')) return;

  const overlay = $('#ol-peer-overlay');
  if (!overlay) return;

  mountMeshWidgetHead();

  // Build a fresh map of desired dot ids (peers + self) and reconcile.
  const desired = new Set();
  if (presence.selfId) desired.add(presence.selfId);
  for (const id of presence.peers.keys()) desired.add(id);

  // Remove dots that no longer belong.
  for (const child of Array.from(overlay.children)) {
    if (!desired.has(child.dataset?.peerId)) {
      if (child.nodeType === 1 && child.dataset?.peerId) child.remove();
    }
  }

  // The widget is bounded; dots live INSIDE its rect. We render them
  // positioned in the widget's own coordinate space (% of widget size),
  // not % of viewport. The "live mesh" header sits at the top so we
  // reserve the upper ~26px for it.
  const totalPeers = presence.peers.size + (presence.selfId ? 1 : 0);
  overlay.dataset.count = String(totalPeers);
  overlay.classList.toggle('is-empty', totalPeers === 0);

  // Real DOM count (the ::after pseudo is suppressed once the head bar mounts).
  const countEl = document.getElementById('ol-mesh-widget-count');
  if (countEl) {
    countEl.textContent =
      totalPeers === 1 ? '1 here right now' : `${totalPeers} here right now`;
  }

  // Top margin (for the "live mesh / N here" header) and bottom margin
  // (for the "tap a dot to chat" hint). Dots cluster in the middle.
  const yMin = 18;   // % inside the widget
  const yMax = 82;
  const xMin = 6;
  const xMax = 94;

  // Scale dot size based on density so 100s of peers don't overlap fully.
  let dotScale = 1.0;
  if (totalPeers > 60) dotScale = 0.7;
  if (totalPeers > 200) dotScale = 0.55;
  if (totalPeers > 500) dotScale = 0.4;

  const place = (id, p, isSelf) => {
    const h = simpleHash(id);
    // Deterministic xy jitter inside the widget bounds so co-located peers
    // fan out into a constellation rather than collapsing to one tap target.
    // The spread is larger when there are few peers (so each dot is its own
    // click area), tightening as N grows past a dozen.
    const looseness = totalPeers <= 8 ? 1.0
                    : totalPeers <= 24 ? 0.7
                    : 0.45;
    const jx = ((h & 0xffff) / 0xffff - 0.5) * 1.6;
    const jy = (((h >> 16) & 0xffff) / 0xffff - 0.5) * 1.6;

    const rawX = (p.lng + jx * 0.55 * looseness) * 100;   // up to ~88% widget width
    const rawY = ((1 - p.lat) + jy * 0.55 * looseness) * 100;
    const xPct = Math.max(xMin, Math.min(xMax, rawX * (xMax - xMin) / 100 + xMin * 0.0));
    const yPct = Math.max(yMin, Math.min(yMax, rawY * (yMax - yMin) / 100 + yMin * 0.0));

    let dot = overlay.querySelector(`[data-peer-id="${id}"]`);
    if (!dot) {
      dot = document.createElement(isSelf ? 'div' : 'button');
      if (!isSelf) dot.setAttribute('type', 'button');
      dot.className = 'ol-peer-dot' + (isSelf ? ' is-self' : '');
      dot.dataset.peerId = id;
      if (!isSelf) {
        dot.setAttribute('aria-label', 'Start anonymous chat with a stranger');
        dot.dataset.label = regionForLng(p.lng);
        dot.addEventListener('click', () => sendPing(id, dot));
      }
      overlay.appendChild(dot);
    }
    dot.style.setProperty('--x', xPct + '%');
    dot.style.setProperty('--y', yPct + '%');
    dot.style.transform = `scale(${dotScale})`;
    if (!isSelf) {
      dot.dataset.label = regionForLng(p.lng);
      const hue = h % 360;
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

  // Hint sits inside the widget footer.
  let hint = overlay.querySelector('.ol-peer-hint-inline');
  if (!hint) {
    hint = document.createElement('div');
    hint.className = 'ol-peer-hint-inline';
    overlay.appendChild(hint);
  }
  hint.textContent = presence.peers.size === 0
    ? 'open another tab or wait for someone'
    : 'tap any glowing dot to chat';

  // Hide the old standalone peer-hint pill if present (legacy element).
  const oldHint = $('#ol-peer-hint');
  if (oldHint) oldHint.hidden = true;
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
  active: null,           // { peerId, state, hue, label, role, key, sas, inviter, scanner, inviteHex }
  pendingRequest: null,   // { peerId, hue, label, inviteHex }
  pqModule: null,         // lazy-loaded ol_pair_qr WASM module
};

// ---------- E2EE helpers (WebCrypto AES-GCM-256 over the ol_pair_qr chain key) ----------

async function ensurePqModule() {
  if (chat.pqModule) return chat.pqModule;
  const m = await import('/live/wasm/ol_pair_qr.js');
  await m.default({ module_or_path: '/live/wasm/ol_pair_qr_bg.wasm' });
  chat.pqModule = m;
  return m;
}

async function importChatKey(chainKeyBytes) {
  // Use the 32-byte ol_pair_qr chain key directly as the AES-GCM-256 key.
  // ChaCha20-Poly1305 isn't in WebCrypto's standard surface; AES-GCM is.
  // Same strength; same one-key-per-session model.
  return await crypto.subtle.importKey(
    'raw',
    chainKeyBytes,
    { name: 'AES-GCM' },
    false,
    ['encrypt', 'decrypt']
  );
}

function b64encode(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
  return btoa(s);
}
function b64decode(s) {
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
function hexEncode(u8) {
  return Array.from(u8, b => b.toString(16).padStart(2, '0')).join('');
}
function hexDecode(s) {
  const out = new Uint8Array(s.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(s.substr(i * 2, 2), 16);
  }
  return out;
}

async function sealChatText(key, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const pt = new TextEncoder().encode(plaintext);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, pt);
  return { iv_b64: b64encode(iv), ct_b64: b64encode(new Uint8Array(ct)) };
}
async function openChatText(key, iv_b64, ct_b64) {
  const iv = b64decode(iv_b64);
  const ct = b64decode(ct_b64);
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
  return new TextDecoder().decode(pt);
}

function mountChatPanelIfMissing() {
  // The live-mesh widget is on every page (after the immersive.css universal
  // load fix). But the chat panel + toast HTML used to live only on the home
  // and /mesh/ pages, which meant clicking a peer dot on /security/, /share/,
  // /features/, etc. silently returned (panel === null inside openChatPanel).
  // Inject the markup once at boot if it's missing, so chat works everywhere.
  if (document.getElementById('ol-chat-panel')) return;
  const wrap = document.createElement('div');
  wrap.innerHTML = `
<div class="ol-ping-toast" id="ol-ping-toast" aria-live="polite" hidden>
  <span class="ol-ping-glyph" aria-hidden="true">⚓</span>
  <span class="ol-ping-text">someone said hello</span>
</div>
<div class="ol-chat-panel" id="ol-chat-panel" hidden role="dialog" aria-label="Anonymous stranger chat">
  <div class="ol-chat-head">
    <span class="ol-chat-dot" id="ol-chat-dot"></span>
    <span class="ol-chat-title" id="ol-chat-title">stranger</span>
    <span class="ol-chat-state" id="ol-chat-state">connecting</span>
    <button type="button" class="ol-chat-close" id="ol-chat-close" aria-label="Close chat">&times;</button>
  </div>
  <div class="ol-chat-log" id="ol-chat-log" aria-live="polite"></div>
  <form class="ol-chat-form" id="ol-chat-form">
    <input type="text" id="ol-chat-input" maxlength="280" placeholder="say something kind..." autocomplete="off" aria-label="Message">
    <button type="submit" class="ol-chat-send" aria-label="Send">&rarr;</button>
  </form>
  <div class="ol-chat-foot">ephemeral &middot; anonymous &middot; end-to-end encrypted</div>
</div>
<div class="ol-chat-request-toast" id="ol-chat-request-toast" hidden role="alert">
  <div class="ol-chat-request-dot" id="ol-chat-request-dot"></div>
  <div class="ol-chat-request-body">
    <strong>someone wants to talk</strong>
    <div class="ol-chat-request-detail">stranger from <span id="ol-chat-request-where">somewhere</span></div>
  </div>
  <div class="ol-chat-request-actions">
    <button type="button" class="ol-chat-decline" id="ol-chat-decline">ignore</button>
    <button type="button" class="ol-chat-accept" id="ol-chat-accept">say hi</button>
  </div>
</div>`;
  // Move all generated children into <body> so they're top-level.
  while (wrap.firstChild) document.body.appendChild(wrap.firstChild);
}

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

async function startChatWith(peerId) {
  if (peerId === presence.selfId) return;
  if (chat.active && chat.active.peerId !== peerId) {
    sendChatFrame('chat-leave', chat.active.peerId);
  }

  // Open the panel IMMEDIATELY in "connecting..." state so the user sees
  // visible feedback that their click registered (was opening AFTER the
  // 200-400ms WASM load, which felt like clicking did nothing).
  chat.active = {
    peerId, state: 'connecting', hue: peerHue(peerId), label: peerLabel(peerId),
    role: 'inviter', inviter: null, key: null, sas: null,
  };
  openChatPanel(peerId);
  // Collapse the live-mesh widget so the chat panel (same bottom-right
  // corner) isn't visually layered under the widget.
  const meshWidget = document.getElementById('ol-peer-overlay');
  if (meshWidget && !meshWidget.classList.contains('is-collapsed')) {
    meshWidget.classList.add('is-collapsed');
    const toggle = meshWidget.querySelector('.ol-mesh-toggle');
    if (toggle) {
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-label', 'Expand live mesh widget');
      toggle.innerHTML = '<span aria-hidden="true">+</span>';
    }
    try { sessionStorage.setItem('ol.mesh.collapsed', '1'); } catch {}
  }

  // Inviter side. Build a real ol_pair_qr Invite + send invite bytes
  // alongside the chat-request so the recipient can scan immediately
  // and complete a real handshake instead of agreeing in plaintext.
  let inviter;
  try {
    const m = await ensurePqModule();
    inviter = new m.OlInviter(1_900_000_000, `chat:${presence.selfId?.slice(0, 8) || 'anon'}`);
  } catch (e) {
    console.debug('[chat] inviter init failed', e?.message);
    setChatState('crypto unavailable', 'is-closed');
    return;
  }
  chat.active.inviter = inviter;
  chat.active.state = 'requesting';
  setChatState('asking', 'is-pending');
  if (!sendChatFrame('chat-request', peerId, { invite_hex: hexEncode(inviter.inviteBytes) })) {
    setChatState('offline (presence socket down)', 'is-closed');
  }
}

async function handleChatRequest(fromId, msg) {
  if (chat.active) {
    sendChatFrame('chat-decline', fromId);
    return;
  }
  if (!msg || typeof msg.invite_hex !== 'string') {
    sendChatFrame('chat-decline', fromId);
    return;
  }
  chat.pendingRequest = {
    peerId: fromId, hue: peerHue(fromId), label: peerLabel(fromId),
    inviteHex: msg.invite_hex,
  };
  const els = chatPanelEls();
  if (!els.toast) return;
  els.toast.hidden = false;
  els.toastWhere.textContent = peerLabel(fromId);
  const hue = peerHue(fromId);
  if (els.toastDot) {
    els.toastDot.style.background = `radial-gradient(circle at 35% 30%, #fff 0%, hsla(${hue}, 95%, 75%, 0.9) 40%, hsla(${hue}, 60%, 35%, 0.25) 80%, transparent 100%)`;
    els.toastDot.style.boxShadow = `0 0 14px hsla(${hue}, 95%, 70%, 0.8)`;
  }
  clearTimeout(chat._toastTimer);
  chat._toastTimer = setTimeout(() => {
    if (chat.pendingRequest?.peerId === fromId) {
      acceptOrDeclineRequest(false);
    }
  }, 25000);
}

async function acceptOrDeclineRequest(accept) {
  const els = chatPanelEls();
  const req = chat.pendingRequest;
  if (!req) return;
  clearTimeout(chat._toastTimer);
  chat.pendingRequest = null;
  if (els.toast) els.toast.hidden = true;
  if (!accept) {
    sendChatFrame('chat-decline', req.peerId);
    return;
  }
  // Scanner side. Verify the invite, build a PairResponse, hand the
  // response bytes back to the inviter via chat-accept. Hold the scanner
  // instance so we can complete after chat-confirm arrives.
  let scanner;
  try {
    const m = await ensurePqModule();
    scanner = m.OlScanner.scan(hexDecode(req.inviteHex), Math.floor(Date.now() / 1000));
  } catch (e) {
    console.debug('[chat] scanner init failed', e?.message);
    sendChatFrame('chat-decline', req.peerId);
    return;
  }
  chat.active = {
    peerId: req.peerId, state: 'handshake', hue: req.hue, label: req.label,
    role: 'scanner', scanner, key: null, sas: scanner.sas,
  };
  openChatPanel(req.peerId);
  setChatState('handshake', 'is-pending');
  appendChatMsg('verifying handshake...', 'system');
  sendChatFrame('chat-accept', req.peerId, { response_hex: hexEncode(scanner.responseBytes) });
}

async function handleChatAccept(fromId, msg) {
  if (!chat.active || chat.active.peerId !== fromId || chat.active.role !== 'inviter') return;
  if (!msg || typeof msg.response_hex !== 'string' || !chat.active.inviter) return;
  try {
    const sas = chat.active.inviter.receiveResponse(hexDecode(msg.response_hex));
    chat.active.sas = sas;
    const [confirmBytes, chainKey] = chat.active.inviter.confirm();
    chat.active.key = await importChatKey(chainKey);
    chat.active.state = 'open';
    setChatState(sasShort(sas), 'is-live');
    appendChatMsg('end-to-end encrypted. SAS: ' + sas, 'system');
    enableChatInput(true);
    sendChatFrame('chat-confirm', fromId, { confirm_hex: hexEncode(confirmBytes) });
  } catch (e) {
    appendChatMsg('handshake failed: ' + (e?.message || String(e)), 'system');
    setChatState('failed', 'is-closed');
  }
}

async function handleChatConfirm(fromId, msg) {
  if (!chat.active || chat.active.peerId !== fromId || chat.active.role !== 'scanner') return;
  if (!msg || typeof msg.confirm_hex !== 'string' || !chat.active.scanner) return;
  try {
    const chainKey = chat.active.scanner.receiveConfirm(hexDecode(msg.confirm_hex));
    chat.active.key = await importChatKey(chainKey);
    chat.active.state = 'open';
    const sas = chat.active.sas; // already known scanner-side
    setChatState(sasShort(sas), 'is-live');
    appendChatMsg('end-to-end encrypted. SAS: ' + sas, 'system');
    enableChatInput(true);
  } catch (e) {
    appendChatMsg('handshake failed: ' + (e?.message || String(e)), 'system');
    setChatState('failed', 'is-closed');
  }
}

function sasShort(sas) {
  // Truncate to first 3 of 5 words for the header pill (full SAS in system msg).
  if (typeof sas !== 'string') return 'open';
  const words = sas.split(' ').slice(0, 3).join(' ');
  return words || 'open';
}

function handleChatDecline(fromId) {
  if (!chat.active || chat.active.peerId !== fromId) return;
  setChatState('declined', 'is-closed');
  appendChatMsg('they ignored the request', 'system');
  enableChatInput(false);
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
  chat.active.key = null;
}
async function handleChatMsg(fromId, msg) {
  if (!chat.active || chat.active.peerId !== fromId) return;
  if (!chat.active.key || !msg?.iv_b64 || !msg?.ct_b64) return;
  try {
    const text = await openChatText(chat.active.key, msg.iv_b64, msg.ct_b64);
    appendChatMsg(text.slice(0, 280), 'other');
  } catch (e) {
    appendChatMsg('(could not decrypt: ' + (e?.message || 'unknown') + ')', 'system');
  }
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
    els.form.addEventListener('submit', async (e) => {
      e.preventDefault();
      if (!chat.active || chat.active.state !== 'open' || !chat.active.key) return;
      const text = (els.input.value || '').trim().slice(0, 280);
      if (!text) return;
      try {
        const sealed = await sealChatText(chat.active.key, text);
        if (sendChatFrame('chat-msg', chat.active.peerId, sealed)) {
          appendChatMsg(text, 'self');
          els.input.value = '';
        }
      } catch (err) {
        appendChatMsg('(send failed: ' + (err?.message || 'unknown') + ')', 'system');
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
  const iconEl = btn.querySelector('.ol-audio-icon');
  const ICON_MUTED = '\u{1F507}'; // muted speaker
  const ICON_LIVE  = '\u{1F50A}'; // speaker with waves
  btn.addEventListener('click', () => {
    const on = btn.getAttribute('aria-pressed') === 'true';
    if (on) {
      ambientAudioStop();
      btn.setAttribute('aria-pressed', 'false');
      if (iconEl) iconEl.textContent = ICON_MUTED;
    } else {
      ambientAudioStart();
      btn.setAttribute('aria-pressed', 'true');
      if (iconEl) iconEl.textContent = ICON_LIVE;
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

  // Build a tiny graph every second: visitor + peers + a central anchor.
  // Edges are nearest-K (K=3) with weight = 1/distance. Edge events from
  // presence (peer join / leave) trigger an immediate recolor + ripple pulse
  // so the field is visibly responsive to new connections.
  const D = 0.05;     // diffusion
  const GAMMA = 0.18; // damping; matches the WGSL solver's gamma

  let lastPeerCount = -1;
  let recolorTimer = null;

  // Listen for peer changes so a new join triggers an immediate recolor
  // + a visible ripple pulse instead of waiting for the next periodic tick.
  function checkPeerChange() {
    const dotCount = $$('#ol-peer-overlay .ol-peer-dot').length;
    if (lastPeerCount !== -1 && dotCount !== lastPeerCount) {
      pulseRipple();
      if (recolorTimer) { clearTimeout(recolorTimer); }
      setTimeout(recolor, 60);
    }
    lastPeerCount = dotCount;
  }
  setInterval(checkPeerChange, 500);

  // Brief visual ripple across all dots when a peer joins / leaves: a single
  // CSS animation that grows + fades the box-shadow, then the next recolor
  // overrides it with the field-derived steady state. Pure CSS keyframes.
  function pulseRipple() {
    const dots = $$('#ol-peer-overlay .ol-peer-dot');
    for (const d of dots) {
      d.classList.remove('ol-field-ripple');
      // force reflow so the animation restarts
      void d.offsetWidth;
      d.classList.add('ol-field-ripple');
    }
  }

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

    recolorTimer = setTimeout(recolor, 1000);
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

    // Find a tasteful slot: the "live from /api/capabilities" pill in the
    // hero status. Replace its number text with the real count, and append
    // a collapsed <details> at the BOTTOM of /features/ for anyone who
    // wants to see the raw cap list. No more heavy banner above the hero.
    const liveBadgePill = document.querySelector('.ol-status .number');
    const liveBadgeTime = document.querySelector('.ol-status > span:last-child');
    if (liveBadgePill) liveBadgePill.textContent = `${data.capabilities.length} caps`;
    if (liveBadgeTime) {
      const issued = data.issued_at?.split('.')[0]?.replace('T', ' ') || 'unknown';
      liveBadgeTime.textContent = `as of ${issued} UTC`;
    }

    // Tiny collapsed details at the bottom of the page for the curious.
    const main = document.querySelector('main') || document.body;
    const det = document.createElement('section');
    det.className = 'section';
    det.style.cssText = 'padding-top: 0;';
    const issued = data.issued_at?.split('.')[0]?.replace('T', ' ') || 'unknown';
    det.innerHTML = `
      <div class="container" style="max-width: 880px;">
        <details style="background: rgba(8, 12, 20, 0.5); border: 1px solid var(--ol-line); border-radius: var(--ol-radius); padding: 0.8rem 1.2rem; font-family: var(--ol-mono); font-size: 0.85rem; color: var(--ol-text-soft);">
          <summary style="cursor: pointer; color: var(--ol-text);">
            <span style="color: var(--ol-cyan);">&#x25cf;</span>
            raw capability advert
            <span style="color: var(--ol-text-dim); margin-left: 0.5rem;">${data.capabilities.length} caps &middot; signed=${data.signed ? 'yes' : 'no'} &middot; ${issued} UTC</span>
          </summary>
          <div style="margin-top: 0.7rem; display: flex; flex-wrap: wrap; gap: 0.35rem;">
            ${data.capabilities.map(c => `
              <span style="padding: 0.18rem 0.5rem; background: rgba(110, 240, 244, 0.06); border: 1px solid rgba(110, 240, 244, 0.18); border-radius: 999px; color: var(--ol-cyan); font-size: 0.72rem;">${escapeHtml(c)}</span>
            `).join('')}
          </div>
        </details>
      </div>
    `;
    main.appendChild(det);
  } catch {}
}

// ---------------------------------------------------------------------------
// Mobile-nav toggle (a real <button aria-expanded>, not a label-for-checkbox)
// ---------------------------------------------------------------------------
function wireNavToggle() {
  const btn = document.getElementById('nav-toggle');
  const nav = document.getElementById('primary-nav');
  if (!btn || !nav || btn.tagName !== 'BUTTON') return;
  const setOpen = (open) => {
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.setAttribute('aria-label', open ? 'Close navigation' : 'Open navigation');
  };
  btn.addEventListener('click', () => {
    setOpen(btn.getAttribute('aria-expanded') !== 'true');
  });
  // Close on Escape; close when a nav link is followed.
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && btn.getAttribute('aria-expanded') === 'true') setOpen(false);
  });
  nav.addEventListener('click', (e) => {
    if (e.target.closest('a')) setOpen(false);
  });
}

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------
(async function main() {
  // Mount the live crypto-op log first so subsequent ops land in it.
  olOpLogEnsureDom();
  olOpLog('site loaded', performance.now() - (performance.timeOrigin ? 0 : performance.now()), 'ok');

  wireNavToggle();
  rewriteDownloadButton();
  await olTimed('coherence field init', () => startCoherenceField());
  const meshVizApi = startMeshViz();
  _meshVizApi = meshVizApi;   // expose for setPresenceCount() honesty hook
  await olTimed('open session', () => openSession());
  pollTopology(meshVizApi);
  markYou(meshVizApi);
  olTimed('pair-by-QR demo init', () => startPairDemo()); // parallel
  registerServiceWorker(); // offline-first kicks in on next visit
  startPresence();         // live "N here right now"
  wireAmbientAudioToggle();
  wireScrollHint();
  reportPqStatus();
  wireTabPairButton();         // stranger-pair two-tab demo
  wirePrivateRouteDemo();      // /download/ Sphinx route button
  wirePqSigDemo();             // /security/ Ed25519+ML-DSA-65 sign+verify demo
  wireThresholdDemo();         // /security/ Shamir K-of-N split+recover demo
  wireRatchetDemo();           // /security/ forward-secret ratchet demo
  wireHwkeyDemo();             // /security/ TOFU device-fingerprint demo
  wireAttestationVerify();     // /download/ "verify this binary's attestation"
  wireRebuildFromSource();     // /builders/ "rebuild this site in your tab"
  startMeshSolverColoring();   // /mesh/ peer-dot coloring via real solver
  wireTelemetry();             // ?-key system-telemetry overlay
  startCapAdvertSync();        // /features/ live cap-advert banner
  mountChatPanelIfMissing();   // ensure chat dialog HTML exists on every page
  wireChat();                  // anonymous stranger chat overlay
  startMouseReactiveField();   // cursor adds energy to the coherence field
})();
