from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

import mujoco
import numpy as np

from .io import atomic_directory, hash_file, hash_json, write_json
from .replay import write_rgb_png


DESIGN_PREVIEW_RENDERER_ID = "mujica-runtime-design-preview-v2"


def _name(model: mujoco.MjModel, kind: mujoco.mjtObj, index: int) -> str:
    return mujoco.mj_id2name(model, kind, index) or f"{kind.name.lower()}-{index}"


def _geom_extent(model: mujoco.MjModel, data: mujoco.MjData, index: int) -> np.ndarray:
    rotation = np.asarray(data.geom_xmat[index], dtype=np.float64).reshape(3, 3)
    absolute = np.abs(rotation)
    size = np.asarray(model.geom_size[index], dtype=np.float64)
    geom_type = int(model.geom_type[index])
    if geom_type == int(mujoco.mjtGeom.mjGEOM_SPHERE):
        return np.full(3, size[0], dtype=np.float64)
    if geom_type == int(mujoco.mjtGeom.mjGEOM_BOX):
        return absolute @ size
    if geom_type == int(mujoco.mjtGeom.mjGEOM_ELLIPSOID):
        return np.sqrt(np.square(rotation * size).sum(axis=1))
    if geom_type in {
        int(mujoco.mjtGeom.mjGEOM_CAPSULE),
        int(mujoco.mjtGeom.mjGEOM_CYLINDER),
    }:
        axial = absolute[:, 2] * size[1]
        radial = size[0] * np.sqrt(
            np.square(rotation[:, 0]) + np.square(rotation[:, 1])
        )
        if geom_type == int(mujoco.mjtGeom.mjGEOM_CAPSULE):
            radial = np.full(3, size[0], dtype=np.float64)
        return axial + radial
    return np.full(3, float(model.geom_rbound[index]), dtype=np.float64)


def _robot_bounds(
    model: mujoco.MjModel,
    data: mujoco.MjData,
) -> tuple[np.ndarray, np.ndarray]:
    lower: list[np.ndarray] = []
    upper: list[np.ndarray] = []
    for index in range(model.ngeom):
        if int(model.geom_bodyid[index]) == 0:
            continue
        extent = _geom_extent(model, data, index)
        position = np.asarray(data.geom_xpos[index], dtype=np.float64)
        lower.append(position - extent)
        upper.append(position + extent)
    if not lower:
        center = np.asarray(model.stat.center, dtype=np.float64)
        radius = float(model.stat.extent) / 2.0
        return center - radius, center + radius
    return np.min(np.asarray(lower), axis=0), np.max(np.asarray(upper), axis=0)


def _home_state(model: mujoco.MjModel, data: mujoco.MjData) -> None:
    if model.nkey > 0:
        mujoco.mj_resetDataKeyframe(model, data, 0)
    else:
        mujoco.mj_resetData(model, data)
    mujoco.mj_forward(model, data)


def _resolve_camera_distance(
    model: mujoco.MjModel,
    data: mujoco.MjData,
    requested: object,
) -> tuple[float, str]:
    if requested == "auto":
        _home_state(model, data)
        lower, upper = _robot_bounds(model, data)
        maximum_span = float(np.max(upper - lower))
        return max(0.35, min(20.0, maximum_span * 1.8)), "auto-bounds-v1"
    distance = float(requested)
    if not math.isfinite(distance) or not 0.2 <= distance <= 20:
        raise RuntimeError("Design camera distance is outside the supported range")
    return distance, "fixed"


def _root_free_joint(model: mujoco.MjModel) -> tuple[int, int] | None:
    for joint_index in range(model.njnt):
        if int(model.jnt_type[joint_index]) == int(mujoco.mjtJoint.mjJNT_FREE):
            return joint_index, int(model.jnt_qposadr[joint_index])
    return None


def _set_resting_pose(
    model: mujoco.MjModel,
    data: mujoco.MjData,
    quaternion: tuple[float, float, float, float],
) -> None:
    root = _root_free_joint(model)
    if root is None:
        raise RuntimeError("Resting-pose Design Preview requires a free root joint")
    _, qpos_address = root
    _home_state(model, data)
    data.qpos[qpos_address:qpos_address + 3] = np.array([0.0, 0.0, 0.5])
    data.qpos[qpos_address + 3:qpos_address + 7] = np.asarray(
        quaternion,
        dtype=np.float64,
    )
    mujoco.mj_normalizeQuat(model, data.qpos)
    mujoco.mj_forward(model, data)
    lower, _ = _robot_bounds(model, data)
    data.qpos[qpos_address + 2] += 0.025 - float(lower[2])
    mujoco.mj_forward(model, data)


def _model_facts(model: mujoco.MjModel, data: mujoco.MjData) -> dict[str, Any]:
    _home_state(model, data)
    lower, upper = _robot_bounds(model, data)
    body_mass = np.asarray(model.body_mass, dtype=np.float64)
    total_mass = float(body_mass.sum())
    center_of_mass = (
        np.sum(np.asarray(data.xipos) * body_mass[:, None], axis=0) / total_mass
        if total_mass > 0
        else np.zeros(3)
    )
    joints = []
    for index in range(model.njnt):
        joint_type = int(model.jnt_type[index])
        limited = bool(model.jnt_limited[index])
        joints.append({
            "name": _name(model, mujoco.mjtObj.mjOBJ_JOINT, index),
            "type": {
                int(mujoco.mjtJoint.mjJNT_FREE): "free",
                int(mujoco.mjtJoint.mjJNT_BALL): "ball",
                int(mujoco.mjtJoint.mjJNT_SLIDE): "slide",
                int(mujoco.mjtJoint.mjJNT_HINGE): "hinge",
            }.get(joint_type, f"unknown-{joint_type}"),
            "limited": limited,
            "range": (
                [float(value) for value in model.jnt_range[index]]
                if limited
                else None
            ),
        })
    actuators = []
    for index in range(model.nu):
        joint_index = int(model.actuator_trnid[index, 0])
        actuators.append({
            "name": _name(model, mujoco.mjtObj.mjOBJ_ACTUATOR, index),
            "joint": (
                _name(model, mujoco.mjtObj.mjOBJ_JOINT, joint_index)
                if 0 <= joint_index < model.njnt
                else None
            ),
            "controlLimited": bool(model.actuator_ctrllimited[index]),
            "controlRange": [
                float(value) for value in model.actuator_ctrlrange[index]
            ],
        })
    root = _root_free_joint(model)
    return {
        "bodies": int(model.nbody - 1),
        "geometries": int(
            sum(int(model.geom_bodyid[index]) != 0 for index in range(model.ngeom))
        ),
        "joints": joints,
        "actuators": actuators,
        "stateSize": {"qpos": int(model.nq), "qvel": int(model.nv)},
        "totalModelMassKg": total_mass,
        "homeBoundsM": {
            "minimum": [float(value) for value in lower],
            "maximum": [float(value) for value in upper],
            "size": [float(value) for value in upper - lower],
        },
        "homeCenterOfMassM": [float(value) for value in center_of_mass],
        "homeKeyframe": (
            _name(model, mujoco.mjtObj.mjOBJ_KEY, 0)
            if model.nkey > 0
            else None
        ),
        "rootFreeJoint": (
            _name(model, mujoco.mjtObj.mjOBJ_JOINT, root[0])
            if root is not None
            else None
        ),
    }


def _assert_complete_preview(target: Path, images: list[dict[str, Any]]) -> None:
    expected = sorted(str(image["file"]) for image in images)
    actual = sorted(
        path.relative_to(target).as_posix()
        for path in (target / "images").glob("*.png")
        if path.is_file()
    )
    if actual != expected:
        raise RuntimeError(f"Design Preview at '{target}' is incomplete")
    for image in images:
        expected_hash = image.get("fileHash")
        if not isinstance(expected_hash, str) or hash_file(
            target / str(image["file"])
        ) != expected_hash:
            raise RuntimeError(
                f"Design Preview at '{target}' failed image integrity verification"
            )


def render_design_preview(request: dict[str, Any]) -> dict[str, Any]:
    model_path = Path(request["modelPath"]).resolve()
    output_root = Path(request["outputRoot"]).resolve()
    if not model_path.is_file():
        raise RuntimeError(f"Design Preview model is missing: {model_path}")
    if hash_file(model_path) != request["modelHash"]:
        raise RuntimeError("Design Preview model hash differs from compiled source")

    model = mujoco.MjModel.from_xml_path(str(model_path))
    data = mujoco.MjData(model)
    settings = dict(request["settings"])
    width = int(settings["width"])
    height = int(settings["height"])
    distance, distance_mode = _resolve_camera_distance(
        model,
        data,
        settings["cameraDistance"],
    )
    settings["cameraDistance"] = distance
    settings["cameraDistanceMode"] = distance_mode
    if not 320 <= width <= 1920 or not 240 <= height <= 1080:
        raise RuntimeError("Design Preview resolution is outside the supported range")
    identity = {
        "renderer": DESIGN_PREVIEW_RENDERER_ID,
        "runtimeVersion": request["runtimeVersion"],
        "runtimeSourceHash": request["runtimeSourceHash"],
        "mujocoVersion": mujoco.__version__,
        "assembly": request["assembly"],
        "assemblyHash": request["assemblyHash"],
        "modelHash": request["modelHash"],
        "settings": settings,
    }
    preview_id = f"design-preview-{hash_json(identity)[:16]}"
    target = output_root / preview_id
    track_body_name = str(request["baseBody"])
    track_body_id = mujoco.mj_name2id(
        model,
        mujoco.mjtObj.mjOBJ_BODY,
        track_body_name,
    )
    if track_body_id < 0:
        raise RuntimeError(
            f"Design Preview base body '{track_body_name}' is absent from model"
        )

    c = math.sqrt(0.5)
    image_specs: list[dict[str, Any]] = [
        {
            "id": "home-isometric",
            "pose": "home",
            "camera": {"azimuth": 135.0, "elevation": -22.0},
        },
        {
            "id": "home-front",
            "pose": "home",
            "camera": {"azimuth": 180.0, "elevation": -8.0},
        },
        {
            "id": "home-left",
            "pose": "home",
            "camera": {"azimuth": 90.0, "elevation": -8.0},
        },
        {
            "id": "home-top",
            "pose": "home",
            "camera": {"azimuth": 135.0, "elevation": -89.0},
        },
    ]
    if _root_free_joint(model) is not None:
        image_specs.extend([
            {
                "id": "resting-left",
                "pose": "resting-left",
                "quaternion": [c, c, 0.0, 0.0],
                "camera": {"azimuth": 135.0, "elevation": -22.0},
            },
            {
                "id": "resting-right",
                "pose": "resting-right",
                "quaternion": [c, -c, 0.0, 0.0],
                "camera": {"azimuth": 135.0, "elevation": -22.0},
            },
            {
                "id": "resting-prone",
                "pose": "resting-prone",
                "quaternion": [c, 0.0, c, 0.0],
                "camera": {"azimuth": 135.0, "elevation": -22.0},
            },
            {
                "id": "resting-supine",
                "pose": "resting-supine",
                "quaternion": [c, 0.0, -c, 0.0],
                "camera": {"azimuth": 135.0, "elevation": -22.0},
            },
        ])
    images = [
        {
            "id": spec["id"],
            "pose": spec["pose"],
            "camera": {
                **spec["camera"],
                "distance": distance,
                "lookAtBody": track_body_name,
            },
            "file": f"images/{spec['id']}.png",
        }
        for spec in image_specs
    ]
    manifest = {
        "version": 1,
        "id": preview_id,
        "kind": "mujica-design-preview",
        **identity,
        "modelFacts": _model_facts(model, data),
        "images": images,
        "authorityBoundary": {
            "source": "compiled-mjcf",
            "visual": "derived-local-preview",
            "designAcceptance": "none",
            "physicalEvidence": False,
        },
        "completed": True,
    }
    manifest_path = target / "manifest.json"
    if manifest_path.exists():
        existing = json.loads(manifest_path.read_text())
        existing_core = {
            **existing,
            "images": [
                {key: value for key, value in image.items() if key != "fileHash"}
                for image in existing.get("images", [])
            ],
        }
        if existing_core != manifest:
            raise RuntimeError(f"Design Preview identity collision at {target}")
        _assert_complete_preview(target, existing["images"])
        return {
            "id": preview_id,
            "path": str(target),
            "manifest": existing,
            "cached": True,
        }

    renderer = mujoco.Renderer(model, width=width, height=height)

    def writer(directory: Path) -> None:
        (directory / "images").mkdir()
        published_images = []
        try:
            for spec, image in zip(image_specs, images, strict=True):
                if spec["pose"] == "home":
                    _home_state(model, data)
                else:
                    _set_resting_pose(
                        model,
                        data,
                        tuple(spec["quaternion"]),
                    )
                camera = mujoco.MjvCamera()
                camera.type = mujoco.mjtCamera.mjCAMERA_FREE
                camera.lookat[:] = data.xpos[track_body_id]
                camera.distance = distance
                camera.azimuth = float(spec["camera"]["azimuth"])
                camera.elevation = float(spec["camera"]["elevation"])
                renderer.update_scene(data, camera=camera)
                image_path = directory / image["file"]
                write_rgb_png(image_path, renderer.render())
                published_images.append({
                    **image,
                    "fileHash": hash_file(image_path),
                })
            write_json(
                directory / "manifest.json",
                {**manifest, "images": published_images},
            )
        finally:
            renderer.close()

    atomic_directory(target, writer)
    published = json.loads((target / "manifest.json").read_text())
    _assert_complete_preview(target, published["images"])
    return {
        "id": preview_id,
        "path": str(target),
        "manifest": published,
        "cached": False,
    }
