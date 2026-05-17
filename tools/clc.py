from __future__ import annotations

import os
import sys
from pathlib import Path


def _candidate_roots(script_path: Path) -> list[Path]:
    repo_root = script_path.parent.parent
    candidates: list[Path] = []

    env_root = os.environ.get("COHERENCE_COMPILER")
    if env_root:
        candidates.append(Path(env_root))

    candidates.append(Path(r"$HOME\Projects\Coherence\coherence_lang"))
    candidates.append(repo_root.parent / "Coherence" / "coherence_lang")

    return candidates


def _resolve_compiler_root(script_path: Path) -> Path:
    for candidate in _candidate_roots(script_path):
        candidate = candidate.expanduser().resolve()
        entrypoint = candidate / "coherence_lang" / "compiler" / "cli" / "main.py"
        if entrypoint.is_file():
            return candidate
    raise FileNotFoundError(
        "Could not find the Coherence compiler repo. "
        "Set COHERENCE_COMPILER to the coherence_lang checkout."
    )


def _bootstrap_environment(compiler_root: Path) -> None:
    package_root = compiler_root / "coherence_lang"
    stdlib_root = package_root / "bootstrap" / "stdlib"

    sys.path.insert(0, str(compiler_root))
    os.environ.setdefault("COHERENCE_COMPILER", str(compiler_root))

    if stdlib_root.is_dir():
        os.environ.setdefault("COHERENCE_STDLIB", str(stdlib_root))


def main() -> int:
    script_path = Path(__file__).resolve()

    try:
        compiler_root = _resolve_compiler_root(script_path)
    except FileNotFoundError as exc:
        sys.stderr.write(f"[ERROR] {exc}\n")
        return 1

    _bootstrap_environment(compiler_root)

    from coherence_lang.compiler.cli.main import _main_impl

    return int(_main_impl(sys.argv[1:]))


if __name__ == "__main__":
    raise SystemExit(main())
