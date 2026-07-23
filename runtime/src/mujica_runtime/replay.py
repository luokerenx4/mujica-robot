from __future__ import annotations

import json
import struct
import zlib
from pathlib import Path
from typing import Any

import mujoco
import numpy as np

from .io import atomic_directory, hash_file, hash_json, write_json


RENDERER_ID = "mujica-runtime-mujoco-rgb-v1"


def _is_sha256(value: Any) -> bool:
    return (
        isinstance(value, str)
        and len(value) == 64
        and all(character in "0123456789abcdef" for character in value)
    )


def _png_chunk(kind: bytes, payload: bytes) -> bytes:
    checksum = zlib.crc32(kind + payload) & 0xFFFFFFFF
    return struct.pack(">I", len(payload)) + kind + payload + struct.pack(">I", checksum)


def write_rgb_png(path: Path, pixels: np.ndarray) -> None:
    if pixels.dtype != np.uint8 or pixels.ndim != 3 or pixels.shape[2] != 3:
        raise RuntimeError("Replay renderer expected one uint8 RGB image")
    height, width, _ = pixels.shape
    scanlines = b"".join(b"\x00" + pixels[row].tobytes() for row in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    path.write_bytes(
        b"\x89PNG\r\n\x1a\n"
        + _png_chunk(b"IHDR", header)
        + _png_chunk(b"IDAT", zlib.compress(scanlines, 6))
        + _png_chunk(b"IEND", b"")
    )


def _assert_complete_replay(target: Path, frame_count: int, frame_hashes: Any) -> None:
    frames = target / "frames"
    if not frames.is_dir():
        raise RuntimeError(f"Replay at '{target}' has no frame directory")
    expected = [f"{index:06d}.png" for index in range(frame_count)]
    actual = sorted(path.name for path in frames.iterdir() if path.is_file())
    if actual != expected:
        raise RuntimeError(f"Replay at '{target}' is incomplete")
    if not isinstance(frame_hashes, list) or len(frame_hashes) != frame_count:
        raise RuntimeError(f"Replay at '{target}' has no complete frame integrity record")
    actual_hashes = [hash_file(frames / name) for name in expected]
    if actual_hashes != frame_hashes:
        raise RuntimeError(f"Replay at '{target}' failed frame integrity verification")


def render_replay(request: dict[str, Any]) -> dict[str, Any]:
    model_path = Path(request["modelPath"]).resolve()
    trajectory_path = Path(request["trajectoryPath"]).resolve()
    output_root = Path(request["outputRoot"]).resolve()
    if not model_path.is_file(): raise RuntimeError(f"Replay model is missing: {model_path}")
    if not trajectory_path.is_file(): raise RuntimeError(f"Replay trajectory is missing: {trajectory_path}")
    if hash_file(model_path) != request["modelHash"]: raise RuntimeError("Replay model hash differs from its immutable source")
    if hash_file(trajectory_path) != request["trajectoryHash"]: raise RuntimeError("Replay trajectory hash differs from its immutable source")

    settings = request["settings"]
    width = int(settings["width"]); height = int(settings["height"]); stride = int(settings["stride"])
    if not 160 <= width <= 1920 or not 120 <= height <= 1080: raise RuntimeError("Replay resolution is outside the supported range")
    if stride < 1: raise RuntimeError("Replay stride must be positive")

    source = request.get("source")
    if source is None:
        identity = {
            "renderer": RENDERER_ID,
            "runtimeVersion": request["runtimeVersion"],
            "runtimeSourceHash": request["runtimeSourceHash"],
            "mujocoVersion": mujoco.__version__,
            "runId": request["runId"],
            "resultHash": request["resultHash"],
            "assemblyHash": request["assemblyHash"],
            "modelHash": request["modelHash"],
            "trajectoryHash": request["trajectoryHash"],
            "settings": settings,
        }
        manifest_kind = "mujica-simulation-replay"
        manifest_version = 1
    else:
        if source.get("kind") != "hardware-capture-episode":
            raise RuntimeError("Replay source kind is unsupported")
        required = ["captureId", "captureHash", "bundleId", "bundleHash", "episodeId", "episodeHash"]
        if any(not isinstance(source.get(key), str) or not source[key] for key in required):
            raise RuntimeError("Hardware Capture replay source identity is incomplete")
        if any(not _is_sha256(source[key]) for key in ["captureHash", "bundleHash", "episodeHash"]):
            raise RuntimeError("Hardware Capture replay source hashes are invalid")
        if source["episodeHash"] != request["trajectoryHash"]:
            raise RuntimeError("Hardware Capture episode hash differs from replay trajectory")
        identity = {
            "renderer": RENDERER_ID,
            "runtimeVersion": request["runtimeVersion"],
            "runtimeSourceHash": request["runtimeSourceHash"],
            "mujocoVersion": mujoco.__version__,
            "source": source,
            "assemblyHash": request["assemblyHash"],
            "modelHash": request["modelHash"],
            "trajectoryHash": request["trajectoryHash"],
            "settings": settings,
        }
        manifest_kind = "mujica-hardware-capture-replay"
        manifest_version = 2
    replay_id = f"replay-{hash_json(identity)[:16]}"
    target = output_root / replay_id
    rows = [json.loads(line) for line in trajectory_path.read_text().splitlines() if line.strip()]
    selected = rows[::stride]
    if not selected: raise RuntimeError("Replay trajectory has no frames")

    manifest = {
        "version": manifest_version,
        "id": replay_id,
        "kind": manifest_kind,
        **identity,
        "frameCount": len(selected),
        "sourceFrameCount": len(rows),
        "framePattern": "frames/%06d.png",
        "frameTimes": [float(row["time"]) for row in selected],
        "completed": True,
    }
    manifest_path = target / "manifest.json"
    if manifest_path.exists():
        existing = json.loads(manifest_path.read_text())
        existing_core = {key: value for key, value in existing.items() if key != "frameHashes"}
        if existing_core != manifest: raise RuntimeError(f"Replay identity collision at {target}")
        _assert_complete_replay(target, len(selected), existing.get("frameHashes"))
        return {"id": replay_id, "path": str(target), "manifest": existing, "cached": True}

    model = mujoco.MjModel.from_xml_path(str(model_path))
    data = mujoco.MjData(model)
    camera = mujoco.MjvCamera()
    camera.type = mujoco.mjtCamera.mjCAMERA_TRACKING
    camera.trackbodyid = 1 if model.nbody > 1 else 0
    camera.distance = float(settings["camera"]["distance"])
    camera.azimuth = float(settings["camera"]["azimuth"])
    camera.elevation = float(settings["camera"]["elevation"])
    renderer = mujoco.Renderer(model, width=width, height=height)

    def writer(directory: Path) -> None:
        frames = directory / "frames"; frames.mkdir()
        frame_hashes = []
        try:
            for index, row in enumerate(selected):
                qpos = np.asarray(row["qpos"], dtype=np.float64)
                if qpos.shape != (model.nq,):
                    raise RuntimeError(f"Replay frame {index} has qpos size {qpos.size}; model expects {model.nq}")
                data.qpos[:] = qpos
                mujoco.mj_forward(model, data)
                renderer.update_scene(data, camera=camera)
                frame_path = frames / f"{index:06d}.png"
                write_rgb_png(frame_path, renderer.render())
                frame_hashes.append(hash_file(frame_path))
            write_json(directory / "manifest.json", {**manifest, "frameHashes": frame_hashes})
        finally:
            renderer.close()

    atomic_directory(target, writer)
    published = json.loads((target / "manifest.json").read_text())
    _assert_complete_replay(target, len(selected), published.get("frameHashes"))
    return {"id": replay_id, "path": str(target), "manifest": published, "cached": False}
