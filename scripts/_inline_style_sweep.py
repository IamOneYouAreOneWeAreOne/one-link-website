#!/usr/bin/env python3
"""One-shot sweep: replace inline style="..." attrs with utility classes.

Run from the repo root. Reports remaining unique values that have no
class mapping yet so we can either add more classes or leave the long-tail
unique values for a follow-up.
"""

import re
import sys
from pathlib import Path
from collections import Counter

ROOT = Path("dist/weareone-link.org")


def norm(s: str) -> str:
    parts = []
    for p in s.strip().rstrip(";").split(";"):
        p = p.strip()
        if not p:
            continue
        if ":" in p:
            k, v = p.split(":", 1)
            parts.append(f"{k.strip()}: {v.strip()}")
        else:
            parts.append(p)
    return "; ".join(sorted(parts))


STYLE_MAP_RAW = {
    "color: var(--ol-text-soft); font-size: 1.1rem; line-height: 1.7":
        ["ol-prose"],
    "padding-bottom: 1rem": ["ol-pb-sm"],
    "font-style: italic": ["ol-italic"],
    "max-width: 720px": ["ol-mw-720"],
    "text-align: center": ["ol-text-center"],
    "max-width: 64ch": ["ol-mw-64ch"],
    "margin-top: 1.5rem": ["ol-mt"],
    "margin-left: 0.7rem; display: none": ["ol-status-inline"],
    "margin-top: 1rem; display: none": ["ol-output-pre"],
    "color: var(--ol-cyan)": ["ol-cyan-text"],
    "font-family: var(--ol-mono); color: var(--ol-cyan)": ["ol-inline-code"],
    "color: var(--ol-text-soft); max-width: 56ch":
        ["ol-soft-text", "ol-mw-56ch"],
    "justify-content: center": ["ol-justify-center"],
    "word-break: break-all": ["ol-word-break"],
    "gap: 3rem; align-items: center":
        ["ol-gap-3", "ol-items-center"],
    "margin-left: auto; margin-right: auto": ["ol-mx-auto"],
    "margin-top: 0": ["ol-mt-0"],
    ("color: var(--ol-text); font-size: 1.35rem; line-height: 1.6;"
     " font-family: var(--ol-mono); margin-bottom: 0.4rem"):
        ["ol-tile-subhead"],
    "padding-bottom: 2rem": ["ol-pb"],
    "max-width: 680px": ["ol-mw-680"],
    "color: var(--ol-text-dim); font-size: 0.7em; font-weight: 400":
        ["ol-tile-badge"],
    "margin-top: 1.5rem; color: var(--ol-text-dim); text-align: center":
        ["ol-footnote-dim"],
    "margin-top: 1rem; color: var(--ol-text-soft)":
        ["ol-footnote-soft"],
    "color: var(--ol-text-soft); margin: 0; max-width: 52ch":
        ["ol-soft-text", "ol-mw-52ch"],
    ("display: grid; grid-template-columns: repeat(auto-fit, minmax(180px,"
     " 1fr)); gap: 0.6rem 1rem"):
        ["ol-tag-grid"],
    ("color: var(--ol-text-dim); font-size: 0.82rem; margin-top: 0.7rem;"
     " font-family: var(--ol-mono)"):
        ["ol-attest-dim"],
    "color: var(--ol-green)": ["ol-green-text"],
    "color: var(--ol-text-soft)": ["ol-soft-text"],
    ("text-align: center; color: var(--ol-text-dim); margin-top: 1.4rem;"
     " font-size: 0.92rem"):
        ["ol-caption-centered"],
    "margin-top: 2rem": ["ol-mt-lg"],
    "aspect-ratio: 21 / 9": ["ol-mesh-aspect-cinema"],
    "max-width: 640px": ["ol-mw-640"],
    "max-width: 38ch": ["ol-mw-38ch"],
    "max-width: 42ch": ["ol-mw-42ch"],
    "font-family: var(--ol-mono)": ["ol-mono"],
    "color: var(--ol-text-dim)": ["ol-dim-text"],
    "text-align: center; color: var(--ol-text-dim)":
        ["ol-text-center", "ol-dim-text"],
    "margin-top: 1.5rem; color: var(--ol-text-dim)":
        ["ol-mt", "ol-dim-text"],
    "align-items: flex-start": ["ol-items-start"],
    "font-size: 0.82rem": ["ol-text-xs"],
    "margin-top: 0.5rem": ["ol-mt-xs"],
    # Hero word-stagger delays.
    "--d: 0.04s":  ["ol-d-04"],
    "--d: 0.16s":  ["ol-d-16"],
    "--d: 0.36s":  ["ol-d-36"],
    "--d: 0.46s":  ["ol-d-46"],
    "--d: 0.70s":  ["ol-d-70"],
    "--d: 0.78s":  ["ol-d-78"],
    "--d: 0.86s":  ["ol-d-86"],
    "--d: 0.94s":  ["ol-d-94"],
    "--d: 1.02s":  ["ol-d-102"],
    "--d: 1.10s":  ["ol-d-110"],
    "--d: 1.18s":  ["ol-d-118"],
    # Same delays, .NNs (no leading 0) form as authored.
    "--d: .04s":   ["ol-d-04"],
    "--d: .16s":   ["ol-d-16"],
    "--d: .36s":   ["ol-d-36"],
    "--d: .46s":   ["ol-d-46"],
    "--d: .70s":   ["ol-d-70"],
    "--d: .78s":   ["ol-d-78"],
    "--d: .86s":   ["ol-d-86"],
    "--d: .94s":   ["ol-d-94"],
    # Long-tail composites with dedicated classes.
    "margin-top: 2.5rem; text-align: center":         ["ol-mt-xl-center"],
    "margin-bottom: 1rem":                            ["ol-mb-sm"],
    "margin-top: 1rem":                               ["ol-mt-sm"],
    "max-width: 24ch; margin-left: auto; margin-right: auto":
        ["ol-mw-24ch", "ol-mx-auto"],
    "max-width: 56ch; margin: 0 auto 2rem":           ["ol-mw-56ch-cap"],
    "max-width: 720px; text-align: center":           ["ol-mw-720-center"],
    "color: var(--ol-text-dim); font-family: var(--ol-mono); font-size: 0.85rem":
        ["ol-mw-mono-small"],
    "text-align: right; color: var(--ol-text-dim); font-size: 0.85rem; margin-top: 0.7rem":
        ["ol-right-foot"],
    "color: var(--ol-text-soft); font-size: 1.05rem; line-height: 1.85; padding-left: 1.2rem":
        ["ol-list-prose"],
    "color: var(--ol-text-soft); font-size: 1.1rem; line-height: 1.7; margin-top: 1.5rem":
        ["ol-prose-mt"],
    ("color: var(--ol-cyan); font-size: 1.55rem; line-height: 1.6;"
     " font-family: var(--ol-mono); font-weight: 600"):
        ["ol-h-mono-cyan-lg"],
    "color: var(--ol-cyan); font-family: var(--ol-mono); font-size: 0.95em":
        ["ol-inline-code-em"],
    "gap: 3rem; align-items: flex-start":
        ["ol-gap-3", "ol-items-start"],
    "background: var(--ol-cyan); box-shadow: 0 0 10px var(--ol-cyan)":
        ["ol-swatch-cyan"],
    "background: var(--ol-amber); box-shadow: 0 0 10px var(--ol-amber)":
        ["ol-swatch-amber"],
}
STYLE_MAP = {norm(k): v for k, v in STYLE_MAP_RAW.items()}

pages = sorted(ROOT.glob("**/index.html"))
if (ROOT / "404.html").exists():
    pages.append(ROOT / "404.html")

remaining: Counter = Counter()
swept = 0
files_touched = 0

style_attr_re = re.compile(r'\s+style="([^"]+)"')

for page in pages:
    text = page.read_text(encoding="utf-8")
    orig = text

    def repl(m: re.Match) -> str:
        global swept
        raw = m.group(1)
        key = norm(raw)
        if key in STYLE_MAP:
            classes = STYLE_MAP[key]
            swept += 1
            return f' data-ol-sweep="{"|".join(classes)}"'
        remaining[raw] += 1
        return m.group(0)

    text = style_attr_re.sub(repl, text)

    # Resolve data-ol-sweep markers: merge classes into the parent tag's class attr.
    sweep_attr_re = re.compile(r'(<[a-zA-Z][^>]*?)\s+data-ol-sweep="([^"]+)"([^>]*>)')

    def resolve(m: re.Match) -> str:
        head, payload, tail = m.group(1), m.group(2), m.group(3)
        classes = payload.split("|")
        whole = head + tail
        cm = re.search(r'class="([^"]*)"', whole)
        if cm:
            existing = cm.group(1).split()
            for c in classes:
                if c not in existing:
                    existing.append(c)
            new_class = " ".join(existing)
            whole = whole[:cm.start(1)] + new_class + whole[cm.end(1):]
        else:
            # Inject class="..." right after the tag name (first whitespace).
            sp = whole.find(" ")
            if sp == -1:
                # tag with no attrs? insert before the `>`
                whole = whole[:-1] + f' class="{" ".join(classes)}">'
            else:
                whole = whole[:sp] + f' class="{" ".join(classes)}"' + whole[sp:]
        return whole

    for _ in range(8):  # multi-pass in case of nested attr churn
        new_text = sweep_attr_re.sub(resolve, text)
        if new_text == text:
            break
        text = new_text

    if text != orig:
        page.write_text(text, encoding="utf-8")
        files_touched += 1

print(f"Swept {swept} inline-style attrs across {files_touched} files.")
print(f"Remaining unique values: {len(remaining)} ({sum(remaining.values())} occurrences)")
for v, n in remaining.most_common(40):
    print(f"  {n:3}  {v[:120]}")
