#!/usr/bin/env python3
"""Surgical probe of the homepage runtime: capture EVERY console message,
EVERY response (not just .wasm), and directly test that the WASM modules
import + the WS connects from inside the page context."""
import sys, time, json
from playwright.sync_api import sync_playwright

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "https://weareone-link.org"
events = []
def log(k, v=""): events.append({"t": round(time.time()*1000), "k": k, "v": v})

with sync_playwright() as p:
    b = p.chromium.launch(headless=True)
    # No reduced-motion this time; let everything run.
    ctx = b.new_context(viewport={"width":1440,"height":900})
    page = ctx.new_page()
    page.on("console", lambda m: log(f"console.{m.type}", m.text[:400]))
    page.on("pageerror", lambda e: log("pageerror", str(e)[:400]))
    page.on("requestfailed", lambda r: log("requestfail", f"{r.method} {r.url} :: {r.failure}"))
    page.on("response", lambda r: log("resp", f"{r.status} {r.url}") if any(
        s in r.url for s in ["/live/", "/api/", ".wasm"]) else None)
    page.on("websocket", lambda ws: (log("ws.open", ws.url),
        ws.on("framereceived", lambda f: log("ws.frame", str(f.payload)[:200])),
        ws.on("close", lambda: log("ws.close",""))))

    log("nav.start")
    page.goto(BASE + "/", wait_until="domcontentloaded", timeout=20000)
    log("nav.domloaded")
    time.sleep(10)  # let everything try
    log("done-wait")

    # Manually probe import + WS from inside page context.
    probe = page.evaluate("""
async () => {
  const out = {};
  try {
    const m = await import('/live/wasm/ol_pair_qr.js');
    out.qr_import_ok = true;
    try { await m.default({ module_or_path: '/live/wasm/ol_pair_qr_bg.wasm' }); out.qr_wasm_init_ok = true; } catch (e) { out.qr_wasm_init_err = String(e); }
    if (out.qr_wasm_init_ok && m.liveDemoRoundTrip) {
      try { const r = m.liveDemoRoundTrip(); out.qr_round_trip_matched = r.matched; out.qr_invite_bytes = r.inviteBytes.length; }
      catch (e) { out.qr_round_trip_err = String(e); }
    }
  } catch (e) { out.qr_import_err = String(e); }
  try {
    const url = (location.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + location.host + '/api/presence';
    const ws = new WebSocket(url);
    out.ws_url = url;
    await new Promise((res) => {
      const t = setTimeout(() => res('timeout'), 4000);
      ws.onopen = () => { out.ws_opened = true; ws.send(JSON.stringify({type:'hello', protocol:1, geo:{lat:0.5,lng:0.5}})); clearTimeout(t); res('open'); };
      ws.onerror = (e) => { out.ws_err = String(e); clearTimeout(t); res('err'); };
      ws.onmessage = (e) => { out.ws_first_msg = String(e.data).slice(0,200); };
      ws.onclose = (e) => { out.ws_close = e.code + ' ' + e.reason; clearTimeout(t); res('close'); };
    });
    setTimeout(() => ws.close(), 50);
  } catch (e) { out.ws_setup_err = String(e); }
  return out;
}
""")
    log("probe.result", json.dumps(probe))

    page.close(); ctx.close(); b.close()

import pathlib
p = pathlib.Path("/tmp/site-audit/probe_home.json")
p.write_text(json.dumps(events, indent=2), encoding="utf-8")
# Pretty print
for e in events:
    print(f"  {e['k']:18} | {str(e['v'])[:200]}")
