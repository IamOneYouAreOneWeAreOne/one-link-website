#!/usr/bin/env python3
"""
audit_live.py
=============

Headless audit of weareone-link.org. Captures full-page screenshots at
desktop + mobile viewports, collects console errors, network failures, and
verifies that key DOM markers (the SmartScreen heads-up panel, /roadmap/
sections, /verify-download/ drop zone, footer language switcher) are
present and styled.

Usage:  python scripts/audit_live.py [base_url]
Default base_url: https://weareone-link.org

Outputs:
  /tmp/site-audit/<page>-<viewport>.png      full-page screenshots
  /tmp/site-audit/report.json                machine-readable findings
  /tmp/site-audit/report.md                  human-readable findings
"""
from __future__ import annotations

import json
import sys
import time
from pathlib import Path
from playwright.sync_api import sync_playwright, TimeoutError as PWTimeout

BASE = sys.argv[1].rstrip("/") if len(sys.argv) > 1 else "https://weareone-link.org"
OUT  = Path("/tmp/site-audit")
OUT.mkdir(exist_ok=True, parents=True)

# Pages to capture + per-page DOM-presence checks.
PAGES = [
    ("home",            "/",
        ["header.site-header", "h1", ".site-footer", "a[href='/roadmap/']", "a[href='/verify-download/']"]),
    ("how-it-works",    "/how-it-works/",
        ["h1", ".ol-grid", ".site-footer"]),
    ("features",        "/features/",
        ["h1", ".ol-grid", "code"]),
    ("security",        "/security/",
        ["h1", ".ol-grid", "#ol-verify-site-btn"]),
    ("share",           "/share/",
        ["h1", ".site-footer"]),
    ("download",        "/download/",
        ["h1", ".ol-warning-panel", ".ol-warning-tile", ".ol-warning-icon",
         "a[href='/verify-download/']", "a[href='/roadmap/']", "#ol-download"]),
    ("verify-download", "/verify-download/",
        ["h1", "#ol-verify-drop", "#ol-verify-file", "#ol-verify-result"]),
    ("roadmap",         "/roadmap/",
        ["h1", ".ol-grid", ".site-footer", "a[href='/changelog/']"]),
    ("transparency",    "/transparency/",
        ["h1", ".ol-grid", "pre"]),
    ("audits",          "/audits/",
        ["h1", ".ol-grid"]),
    ("mesh",            "/mesh/",
        ["h1", "canvas, svg, .ol-grid"]),
    ("changelog",       "/changelog/",
        ["h1", "section.section"]),
    ("404",             "/404",
        ["h1"]),
    # i18n spot checks
    ("es-home",         "/es/",                ["h1", ".site-footer", "a[href='/es/roadmap/']"]),
    ("es-download",     "/es/download/",       ["h1", ".ol-warning-panel"]),
    ("fr-roadmap",      "/fr/roadmap/",        ["h1", ".ol-grid"]),
    ("de-verify",       "/de/verify-download/",["h1", "#ol-verify-drop"]),
]

VIEWPORTS = [
    ("desktop", 1440, 900),
    ("mobile",   390, 844),
]

results = []

def check_present(page, selectors):
    found, missing = [], []
    for sel in selectors:
        try:
            if page.query_selector(sel):
                found.append(sel)
            else:
                missing.append(sel)
        except Exception as e:
            missing.append(f"{sel} (err {e})")
    return found, missing

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)

    for vp_name, w, h in VIEWPORTS:
        ctx = browser.new_context(viewport={"width": w, "height": h}, reduced_motion="reduce")
        for page_name, path, checks in PAGES:
            url = BASE + path
            page = ctx.new_page()
            console_errs = []
            net_fails   = []
            page.on("console", lambda msg: msg.type == "error" and console_errs.append(msg.text))
            page.on("requestfailed", lambda r: net_fails.append(f"{r.method} {r.url} -> {r.failure}"))
            entry = {"page": page_name, "url": url, "viewport": vp_name}
            try:
                resp = page.goto(url, wait_until="networkidle", timeout=20000)
                entry["status"] = resp.status if resp else 0
            except PWTimeout:
                entry["status"] = "timeout"
            except Exception as e:
                entry["status"] = f"err:{e}"
            try:
                page.wait_for_load_state("networkidle", timeout=4000)
            except Exception:
                pass
            # Long enough for the staggered word-rise animation on / to finish
            # (last word has animation-delay 1.18s + 1.1s duration).
            time.sleep(2.5)
            entry["title"] = page.title() if entry.get("status") != "timeout" else ""
            entry["found"], entry["missing"] = check_present(page, checks)
            entry["console_errors"] = console_errs[:6]
            entry["network_failures"] = net_fails[:6]
            shot = OUT / f"{page_name}-{vp_name}.png"
            try:
                page.screenshot(path=str(shot), full_page=True)
                entry["screenshot"] = str(shot)
            except Exception as e:
                entry["screenshot_error"] = str(e)
            results.append(entry)
            page.close()
        ctx.close()
    browser.close()

(OUT / "report.json").write_text(json.dumps(results, indent=2), encoding="utf-8")

# Markdown summary
md = ["# Live audit  -  " + BASE, ""]
for r in results:
    icon = "OK" if (r.get("status") == 200 and not r["missing"] and not r["console_errors"]) else "ISSUE"
    md.append(f"## [{icon}] {r['page']} ({r['viewport']})  {r['url']}  status={r.get('status')}")
    if r["missing"]:        md.append(f"- missing selectors: {r['missing']}")
    if r["console_errors"]: md.append(f"- console errors: {r['console_errors']}")
    if r["network_failures"]: md.append(f"- network failures: {r['network_failures']}")
    md.append("")
(OUT / "report.md").write_text("\n".join(md), encoding="utf-8")

issues = sum(1 for r in results if r.get("status") != 200 or r["missing"] or r["console_errors"])
ok     = len(results) - issues
print(f":: {len(results)} page-views captured, {ok} clean, {issues} with issues")
print(f":: screenshots + report at {OUT}")
