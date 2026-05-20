/* =============================================================================
   One Link  -  /share/ page logic
   =============================================================================
   Drop a file -> WebCrypto AES-GCM-256 seal in the browser -> POST ciphertext
   to /api/share -> get a short id back -> assemble URL with the key in the
   URL fragment (browsers never send fragments to servers, so the key stays
   on the client side end-to-end).
   Recipient visits /share/<id>#k=...&iv=...&n=... -> fetch ciphertext from
   /api/share/<id> -> decrypt in browser -> trigger download. The worker
   deletes the object from R2 after the first successful fetch.

   Limits:
     * max 25 MB plaintext (worker rejects larger ciphertext server-side too)
     * 24h TTL enforced by R2 metadata + worker time check
     * key NEVER leaves the browser

   License: AGPL-3.0-or-later
   ========================================================================== */

const $ = (sel, root = document) => root.querySelector(sel);

const MAX_BYTES = 25 * 1024 * 1024;

// ----- shared helpers -----
function b64encode(u8) {
  let s = '';
  // chunk to avoid call-stack blowup on big buffers
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, u8.subarray(i, i + CHUNK));
  }
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64decode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
}
function fmtBytes(n) {
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / (1024 * 1024)).toFixed(1) + ' MB';
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}
function parseFragment() {
  const f = new URLSearchParams(location.hash.replace(/^#/, ''));
  return {
    k: f.get('k'),
    iv: f.get('iv'),
    n: f.get('n'),
    t: f.get('t') || 'application/octet-stream',
  };
}
function getShareIdFromPath() {
  const m = location.pathname.match(/^\/share\/([A-Za-z0-9_-]+)\/?$/);
  return m ? m[1] : null;
}

// =============================================================================
// SENDER
// =============================================================================
async function initSender() {
  const drop = $('#ol-drop-zone');
  const file = $('#ol-share-file');
  const status = $('#ol-share-status');
  const proof = $('#ol-share-proof');
  const proofDl = $('#ol-share-proof-dl');
  if (!drop) return;

  drop.addEventListener('click', () => file.click());
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); file.click(); }
  });
  ['dragover', 'dragenter'].forEach(t =>
    drop.addEventListener(t, e => { e.preventDefault(); drop.classList.add('is-hover'); })
  );
  ['dragleave', 'drop'].forEach(t =>
    drop.addEventListener(t, () => drop.classList.remove('is-hover'))
  );
  drop.addEventListener('drop', (e) => {
    e.preventDefault();
    if (e.dataTransfer?.files?.[0]) handleFile(e.dataTransfer.files[0]);
  });
  file.addEventListener('change', () => {
    if (file.files?.[0]) handleFile(file.files[0]);
  });

  async function handleFile(f) {
    if (f.size > MAX_BYTES) {
      status.hidden = false;
      status.innerHTML = `<span class="ol-share-err">${fmtBytes(f.size)} is over the ${fmtBytes(MAX_BYTES)} limit.</span>`;
      return;
    }

    status.hidden = false;
    status.innerHTML = `<span class="ol-share-pending">sealing <strong>${escapeHtml(f.name)}</strong> (${fmtBytes(f.size)})...</span>`;

    try {
      const t0 = performance.now();

      // Read the file.
      const plaintext = new Uint8Array(await f.arrayBuffer());

      // Generate fresh AES-GCM-256 key + 96-bit IV.
      const keyBytes = crypto.getRandomValues(new Uint8Array(32));
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const cryptoKey = await crypto.subtle.importKey(
        'raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt']
      );

      // Seal.
      const ciphertextBuf = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv }, cryptoKey, plaintext
      );
      const ct = new Uint8Array(ciphertextBuf);
      const dtSeal = performance.now() - t0;

      status.innerHTML = `<span class="ol-share-pending">uploading ${fmtBytes(ct.length)} of ciphertext...</span>`;

      // Upload ciphertext to /api/share.
      const tUp0 = performance.now();
      const res = await fetch('/api/share', {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: ct,
      });
      const dtUp = performance.now() - tUp0;

      if (!res.ok) {
        const err = await res.text();
        status.innerHTML = `<span class="ol-share-err">upload failed (${res.status}): ${escapeHtml(err.slice(0, 200))}</span>`;
        return;
      }
      const { id, expires_at } = await res.json();

      // Build the share URL with key + iv + name + type in the fragment.
      const frag = new URLSearchParams({
        k: b64encode(keyBytes),
        iv: b64encode(iv),
        n: f.name,
        t: f.type || 'application/octet-stream',
      });
      const shareUrl = `${location.origin}/share/${id}#${frag.toString()}`;

      if (window.olOp) window.olOp(`encrypted + uploaded (${fmtBytes(ct.length)})`, dtSeal + dtUp, 'ok');

      // Render the success state.
      status.innerHTML = `
        <div class="ol-share-success">
          <p class="ol-share-success-headline"><strong>Share this link with one person.</strong></p>
          <div class="ol-share-url-row">
            <input type="text" id="ol-share-url" class="ol-share-url" readonly value="${escapeHtml(shareUrl)}">
            <button type="button" class="btn btn-primary" id="ol-share-copy">Copy</button>
          </div>
          <p class="ol-share-meta">
            ${fmtBytes(f.size)} plaintext, ${fmtBytes(ct.length)} ciphertext &middot;
            expires ${new Date(expires_at).toLocaleString()} &middot;
            deletes after first download
          </p>
        </div>
      `;

      // Copy button
      $('#ol-share-copy')?.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(shareUrl);
          $('#ol-share-copy').textContent = 'Copied';
          setTimeout(() => { $('#ol-share-copy').textContent = 'Copy'; }, 1800);
        } catch {}
      });

      // Proof panel
      proof.hidden = false;
      proofDl.innerHTML = `
        <dt>cipher</dt><dd>AES-GCM-256 (WebCrypto)</dd>
        <dt>key</dt><dd>256 bits, generated in your tab, never sent to server</dd>
        <dt>iv</dt><dd>${b64encode(iv).slice(0, 18)}... (96-bit, single-use)</dd>
        <dt>plaintext</dt><dd>${fmtBytes(f.size)}</dd>
        <dt>ciphertext</dt><dd>${fmtBytes(ct.length)} (overhead: ${ct.length - f.size} bytes auth tag)</dd>
        <dt>seal time</dt><dd>${dtSeal.toFixed(1)} ms</dd>
        <dt>upload time</dt><dd>${dtUp.toFixed(1)} ms</dd>
        <dt>server sees</dt><dd>ciphertext + R2 object id (nothing else)</dd>
        <dt>retention</dt><dd>self-deletes on first download, or in 24 hours</dd>
      `;
    } catch (err) {
      status.innerHTML = `<span class="ol-share-err">failed: ${escapeHtml(err?.message || String(err))}</span>`;
    }
  }
}

// =============================================================================
// RECEIVER
// =============================================================================
async function initReceiver() {
  const id = getShareIdFromPath();
  if (!id) return;

  const sender = $('#ol-share-sender');
  const recv = $('#ol-share-receiver');
  const recvStatus = $('#ol-recv-status');
  const recvBtn = $('#ol-recv-download');
  const recvHeadline = $('#ol-recv-headline');
  const recvLede = $('#ol-recv-lede');
  if (sender) sender.hidden = true;
  if (recv) recv.hidden = false;

  const frag = parseFragment();
  if (!frag.k || !frag.iv) {
    recvHeadline.textContent = 'This link is broken.';
    recvLede.textContent = 'The decryption key is missing from the URL. You may need to ask the sender for a fresh link.';
    recvBtn.disabled = true;
    return;
  }
  if (frag.n) recvHeadline.textContent = `${frag.n} is waiting for you.`;

  recvBtn.addEventListener('click', async () => {
    recvBtn.disabled = true;
    recvStatus.hidden = false;
    recvStatus.innerHTML = '<span class="ol-share-pending">fetching ciphertext...</span>';

    try {
      const res = await fetch(`/api/share/${id}`);
      if (!res.ok) {
        if (res.status === 404) {
          recvStatus.innerHTML = '<span class="ol-share-err">file is gone. either someone already downloaded it, or 24 hours passed.</span>';
        } else {
          recvStatus.innerHTML = `<span class="ol-share-err">fetch failed: ${res.status}</span>`;
        }
        return;
      }
      const ct = new Uint8Array(await res.arrayBuffer());

      recvStatus.innerHTML = '<span class="ol-share-pending">decrypting...</span>';

      const keyBytes = b64decode(frag.k);
      const iv = b64decode(frag.iv);
      const cryptoKey = await crypto.subtle.importKey(
        'raw', keyBytes, { name: 'AES-GCM' }, false, ['decrypt']
      );

      const plaintextBuf = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv }, cryptoKey, ct
      );

      // Trigger browser download with the original filename + type.
      const blob = new Blob([plaintextBuf], { type: frag.t });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = frag.n || 'download.bin';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      recvStatus.innerHTML = `<span class="ol-share-success-text">${escapeHtml(frag.n || 'file')} decrypted and saved. server has been told to delete the ciphertext.</span>`;
      if (window.olOp) window.olOp(`fetched + decrypted (${escapeHtml(frag.n || 'file').slice(0, 32)})`, undefined, 'ok');
    } catch (err) {
      recvBtn.disabled = false;
      recvStatus.innerHTML = `<span class="ol-share-err">decrypt failed: ${escapeHtml(err?.message || String(err))}</span>`;
      if (window.olOp) window.olOp('share decrypt failed', undefined, 'err');
    }
  });
}

(async function main() {
  if (getShareIdFromPath()) {
    initReceiver();
  } else {
    initSender();
  }
})();
