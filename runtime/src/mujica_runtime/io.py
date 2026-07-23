from __future__ import annotations

import hashlib
import json
import os
import platform
import shutil
import sys
import tempfile
from pathlib import Path
from typing import Any, Callable


def canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha256_bytes(value: bytes) -> str:
    return hashlib.sha256(value).hexdigest()


def hash_json(value: Any) -> str:
    return sha256_bytes(canonical_json(value).encode())


def hash_file(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def hash_directory(root: Path) -> str:
    chunks: list[str] = []
    for path in sorted(root.rglob("*"), key=lambda item: item.relative_to(root).as_posix()):
        relative = path.relative_to(root)
        if ".DS_Store" in relative.parts or "__pycache__" in relative.parts: continue
        if path.is_symlink(): raise RuntimeError(f"Package contents may not be symlinks: {path}")
        if path.is_file(): chunks.append(f"{relative.as_posix()}\0{hash_file(path)}")
    return sha256_bytes("\n".join(chunks).encode())


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


def atomic_directory(target: Path, writer: Callable[[Path], None]) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = Path(tempfile.mkdtemp(prefix=f".{target.name}.partial-", dir=target.parent))
    try:
        writer(temporary)
        os.replace(temporary, target)
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise


def hardware_info() -> dict[str, Any]:
    return {
        "platform": platform.platform(),
        "machine": platform.machine(),
        "processor": platform.processor(),
        "python": sys.version.split()[0],
        "cpu_count": os.cpu_count(),
    }
