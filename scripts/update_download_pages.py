#!/usr/bin/env python3
"""Compatibility entry point for the fail-closed release-truth renderer.

Historically this script advertised an asset matrix independently from the
Worker and could reintroduce stale Intel macOS and signed-release claims.
There is now one renderer for download, verification, release, and builder
surfaces so those pages cannot drift apart.
"""

from apply_release_truth import main


if __name__ == "__main__":
    raise SystemExit(main())
