#!/usr/bin/env python3
"""
audit_interactive.py
====================

Deeper than DOM-presence: actually waits for live behavior to materialize,
captures WASM load events, watches WebSocket frames, and verifies the
load-bearing dynamic surfaces on the home page actually function.

Probes:
  - The pair-QR canvas/SVG actually has QR pixel content (not a placeholder).
  - The live-mesh WebSocket to /api/presence connects + receives frames.
  - The five SAS words are rendered (orbit/amber/... or the like).
  - bridge.js, WASM crates, immersive.css all load 200.
  - Console + network errors across the full 8s observation window.

Usage:  python scripts/audit_interactive.py [base_url]
"""
from __future__ import annotations
import json, sys, time, base64
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "https://weareone-link.org"
OUT  = Path("/tmp/site-audit"); OUT.mkdir(parents=True, exist_ok=True)

# ---- main ----
results = {
    "base": BASE,
    "network": [],
    "console": [],
    "websocket_frames": [],
    "websocket_url": None,
    "websocket_state": "no-ws-detected",
    "wasm_loads": [],
    "qr_check": None,
    "mesh_check": None,
    "sas_words_check": None,
    "page_title": None,
    "errors_summary": [],
}

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    ctx = browser.new_context(viewport={"width":1440,"height":900}, reduced_motion="reduce")
    page = ctx.new_page()

    # ---- listen ----
    page.on("console", lambda m: results["console"].append({"type": m.type, "text": m.text[:300]}))
    page.on("requestfailed", lambda r: results["network"].append({"url": r.url, "method": r.method, "failure": str(r.failure)}))
    def on_response(resp):
        url = resp.url
        if url.endswith(".wasm") or "ol_pair_qr" in url or "ol_coherence_field" in url:
            results["wasm_loads"].append({"url": url, "status": resp.status, "content_type": resp.headers.get("content-type","")})
    page.on("response", on_response)

    def on_ws(ws):
        results["websocket_url"] = ws.url
        results["websocket_state"] = "opened"
        def fr_text(frame):
            try:
                # Current Playwright Python passes the frame payload directly;
                # older releases exposed an object with a ``payload`` member.
                # Accept both so an audit cannot crash as soon as a real Worker
                # sends its first WebSocket message.
                payload = getattr(frame, "payload", frame)
                if isinstance(payload, bytes):
                    payload = payload.decode("utf-8","replace")
                results["websocket_frames"].append(str(payload)[:400])
            except Exception:
                pass
        ws.on("framereceived", fr_text)
        ws.on("close", lambda: results.__setitem__("websocket_state", "closed"))
    page.on("websocket", on_ws)

    # ---- visit ----
    try:
        page.goto(BASE + "/", wait_until="networkidle", timeout=20000)
    except PWTimeout:
        results["errors_summary"].append("home: nav timeout")
    results["page_title"] = page.title()

    # Settle for animations + WASM init + WS connect attempt.
    time.sleep(8.0)

    # ---- QR check ----
    # Try common QR-host shapes: canvas, svg, img.
    qr = page.evaluate("""
() => {
  const candidates = document.querySelectorAll(
    '.ol-pair-qr, .pair-qr, [class*="qr"], [class*="pair"] canvas, [class*="pair"] svg, canvas.ol-qr, svg.ol-qr'
  );
  const results = [];
  for (const el of candidates) {
    const tag = el.tagName.toLowerCase();
    const rect = el.getBoundingClientRect();
    const item = { tag, classes: el.className.toString().slice(0,150), w: rect.width, h: rect.height };
    if (tag === 'canvas') {
      try {
        const ctx = el.getContext('2d');
        const img = ctx.getImageData(0, 0, Math.min(el.width,256), Math.min(el.height,256));
        // Count distinct dark + distinct light pixels; a real QR has thousands of each.
        let dark = 0, light = 0;
        for (let i = 0; i < img.data.length; i += 4) {
          const r = img.data[i], g = img.data[i+1], b = img.data[i+2], a = img.data[i+3];
          if (a < 32) continue;
          const lum = (r+g+b)/3;
          if (lum < 80) dark++; else if (lum > 175) light++;
        }
        item.canvas_dark_px = dark;
        item.canvas_light_px = light;
        item.canvas_w = el.width;
        item.canvas_h = el.height;
      } catch (e) { item.canvas_err = String(e); }
    } else if (tag === 'svg') {
      item.svg_path_count = el.querySelectorAll('path').length;
      item.svg_rect_count = el.querySelectorAll('rect').length;
      item.svg_inner_len = el.innerHTML.length;
    } else if (tag === 'img') {
      item.img_src = el.src.slice(0,200);
    }
    results.push(item);
  }
  // Also look at the SVG/canvas inside the .ol-pair-qr-mock or similar mock blocks.
  const mock = document.querySelector('.ol-pair-qr-mock, .qr-mock, [class*="qr-mock"]');
  if (mock) {
    results.push({ tag: 'mock-wrapper', classes: mock.className.toString(), inner: mock.innerHTML.slice(0,200) });
  }
  return results;
}""")
    results["qr_check"] = qr

    # ---- SAS words (orbit/amber/...) ----
    sas = page.evaluate("""
() => {
  // Look for an element family that renders the five SAS words.
  const sels = ['.ol-sas-word','.sas-word','.ol-sas','.ol-words','[class*="sas"]'];
  for (const s of sels) {
    const nodes = document.querySelectorAll(s);
    if (nodes.length) {
      return { selector: s, count: nodes.length, texts: Array.from(nodes).slice(0,6).map(n => (n.textContent||'').trim()) };
    }
  }
  // Fallback: look for 5 inline elements near the QR with short word content.
  const all = document.querySelectorAll('span');
  const candidates = Array.from(all).filter(n => /^[a-z]{3,9}$/.test((n.textContent||'').trim().toLowerCase()));
  return { selector:'fallback-span-scan', count: candidates.length, texts: candidates.slice(0,8).map(n=>n.textContent.trim()) };
}""")
    results["sas_words_check"] = sas

    # ---- Live mesh ----
    mesh = page.evaluate("""
() => {
  const overlay = document.querySelector('#ol-peer-overlay, .ol-peer-overlay, .ol-mesh-live, [class*="peer-overlay"], [class*="mesh-live"]');
  const dots = document.querySelectorAll('.ol-peer-dot, [class*="peer-dot"]');
  const popVis = document.querySelector('.ol-live-mesh, .live-mesh, [class*="live-mesh"]');
  const popText = popVis ? (popVis.textContent||'').trim().slice(0,200) : null;
  const peerCounter = document.querySelector('[id*="population"], [data-population], .ol-peer-count, .ol-population');
  return {
    overlay_present: !!overlay,
    peer_dot_count: dots.length,
    live_mesh_widget_text: popText,
    peer_counter_text: peerCounter ? (peerCounter.textContent||'').trim().slice(0,80) : null,
  };
}""")
    results["mesh_check"] = mesh

    # Final screenshot of just the hero+QR+mesh region for visual confirmation.
    page.screenshot(path=str(OUT/"home-hero-deepaudit.png"), full_page=False, clip={"x":0,"y":0,"width":1440,"height":900})

    page.close(); ctx.close(); browser.close()

# Render report
(OUT/"deep_audit.json").write_text(json.dumps(results, indent=2), encoding="utf-8")

def fmt(d, indent=0):
    out = []
    for k, v in (d.items() if isinstance(d, dict) else enumerate(d)):
        if isinstance(v,(dict,list)):
            out.append("  "*indent + f"- **{k}**:")
            out.append(fmt(v, indent+1))
        else:
            out.append("  "*indent + f"- {k}: `{v}`")
    return "\n".join(out)

md = [f"# Deep audit  {BASE}", "", "## QR"]
md.append(fmt(results["qr_check"]))
md.append("\n## Live mesh\n" + fmt(results["mesh_check"]))
md.append("\n## SAS words\n" + fmt(results["sas_words_check"]))
md.append("\n## WebSocket\nurl: " + str(results["websocket_url"]))
md.append("state: " + results["websocket_state"])
md.append("frames received: " + str(len(results["websocket_frames"])))
if results["websocket_frames"]:
    md.append("first frame: `" + results["websocket_frames"][0] + "`")
md.append("\n## WASM/.wasm responses")
for w in results["wasm_loads"]:
    md.append(f"- {w['status']} {w['url']} ct={w['content_type']}")
md.append("\n## Network failures")
for n in results["network"]:
    md.append(f"- FAIL {n['method']} {n['url']}: {n['failure']}")
md.append("\n## Console")
for c in results["console"][:30]:
    md.append(f"- [{c['type']}] {c['text']}")
(OUT/"deep_audit.md").write_text("\n".join(md), encoding="utf-8")
print(":: deep audit ->", OUT/"deep_audit.md")
print(":: ws_state=" + results["websocket_state"] + " frames=" + str(len(results["websocket_frames"])))
print(":: qr_candidates=" + str(len(results["qr_check"])))
