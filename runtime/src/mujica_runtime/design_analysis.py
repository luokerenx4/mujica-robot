from __future__ import annotations

import json
import html
import math
from pathlib import Path
from typing import Any

import mujoco
import numpy as np

from .collisions import disallowed_self_contact_geom_pairs
from .design_preview import (
    _home_state,
    _name,
    _resolve_camera_distance,
    _robot_bounds,
    _root_free_joint,
)
from .io import atomic_directory, hash_file, hash_json, write_json
from .replay import write_rgb_png


DESIGN_ANALYZER_ID = "mujica-runtime-design-analysis-v2"

_PRIMES = [2, 3, 5, 7, 11, 13, 17, 19, 23, 29, 31, 37, 41, 43, 47, 53]


def _geom_label(model: mujoco.MjModel, index: int) -> str:
    named = mujoco.mj_id2name(model, mujoco.mjtObj.mjOBJ_GEOM, index)
    if named:
        return named
    body_index = int(model.geom_bodyid[index])
    body = _name(model, mujoco.mjtObj.mjOBJ_BODY, body_index)
    return f"{body}/geom-{index}"


def _van_der_corput(index: int, base: int) -> float:
    result = 0.0
    denominator = 1.0
    while index:
        index, remainder = divmod(index, base)
        denominator *= base
        result += remainder / denominator
    return result


def _actuated_joint_specs(model: mujoco.MjModel) -> list[dict[str, Any]]:
    actuator_by_joint: dict[int, list[int]] = {}
    for actuator_index in range(model.nu):
        joint_index = int(model.actuator_trnid[actuator_index, 0])
        if joint_index >= 0:
            actuator_by_joint.setdefault(joint_index, []).append(actuator_index)

    specs: list[dict[str, Any]] = []
    for joint_index in sorted(actuator_by_joint):
        joint_type = int(model.jnt_type[joint_index])
        if joint_type not in {
            int(mujoco.mjtJoint.mjJNT_HINGE),
            int(mujoco.mjtJoint.mjJNT_SLIDE),
        }:
            continue
        if not bool(model.jnt_limited[joint_index]):
            raise RuntimeError(
                f"Design Analysis requires bounded actuated joint "
                f"'{_name(model, mujoco.mjtObj.mjOBJ_JOINT, joint_index)}'"
            )
        actuators = actuator_by_joint[joint_index]
        capacity = 0.0
        for actuator_index in actuators:
            control_range = np.asarray(
                model.actuator_ctrlrange[actuator_index],
                dtype=np.float64,
            )
            gear = abs(float(model.actuator_gear[actuator_index, 0]))
            capacity += float(np.max(np.abs(control_range))) * gear
        specs.append({
            "name": _name(model, mujoco.mjtObj.mjOBJ_JOINT, joint_index),
            "jointIndex": joint_index,
            "qposAddress": int(model.jnt_qposadr[joint_index]),
            "dofAddress": int(model.jnt_dofadr[joint_index]),
            "range": [
                float(model.jnt_range[joint_index, 0]),
                float(model.jnt_range[joint_index, 1]),
            ],
            "actuators": [
                _name(model, mujoco.mjtObj.mjOBJ_ACTUATOR, actuator_index)
                for actuator_index in actuators
            ],
            "maximumEffort": capacity,
        })
    if len(specs) > len(_PRIMES):
        raise RuntimeError(
            f"Design Analysis supports at most {len(_PRIMES)} scalar actuated joints"
        )
    return specs


def _contact_specs(
    model: mujoco.MjModel,
    declarations: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    specs: list[dict[str, Any]] = []
    for declaration in declarations:
        site_name = str(declaration["site"])
        site_id = mujoco.mj_name2id(model, mujoco.mjtObj.mjOBJ_SITE, site_name)
        if site_id < 0:
            raise RuntimeError(
                f"Design Analysis contact site '{site_name}' is absent from model"
            )
        specs.append({
            "id": str(declaration["id"]),
            "site": site_name,
            "siteId": site_id,
            "bodyId": int(model.site_bodyid[site_id]),
            "radiusM": max(0.0, float(model.site_size[site_id, 0])),
        })
    if not specs:
        raise RuntimeError("Design Analysis requires at least one contact point")
    return specs


def _foot_geom_ids(
    model: mujoco.MjModel,
    data: mujoco.MjData,
    contacts: list[dict[str, Any]],
) -> set[int]:
    result: set[int] = set()
    for contact in contacts:
        candidates = [
            geom_index
            for geom_index in range(model.ngeom)
            if int(model.geom_bodyid[geom_index]) == contact["bodyId"]
        ]
        if not candidates:
            continue
        site_position = np.asarray(
            data.site_xpos[contact["siteId"]],
            dtype=np.float64,
        )
        nearest = min(
            candidates,
            key=lambda geom_index: float(np.linalg.norm(
                np.asarray(data.geom_xpos[geom_index], dtype=np.float64)
                - site_position
            )),
        )
        result.add(nearest)
    return result


def _body_center_of_mass(
    model: mujoco.MjModel,
    data: mujoco.MjData,
) -> np.ndarray:
    masses = np.asarray(model.body_mass, dtype=np.float64)
    total = float(masses.sum())
    if total <= 0:
        return np.zeros(3, dtype=np.float64)
    return (
        np.asarray(data.xipos, dtype=np.float64) * masses[:, None]
    ).sum(axis=0) / total


def _segment_distance(point: np.ndarray, start: np.ndarray, end: np.ndarray) -> float:
    delta = end - start
    squared = float(delta @ delta)
    if squared == 0:
        return float(np.linalg.norm(point - start))
    amount = max(0.0, min(1.0, float((point - start) @ delta) / squared))
    return float(np.linalg.norm(point - (start + amount * delta)))


def _convex_hull(points: list[np.ndarray]) -> list[np.ndarray]:
    unique = sorted({(float(point[0]), float(point[1])) for point in points})
    if len(unique) <= 1:
        return [np.asarray(point, dtype=np.float64) for point in unique]

    def cross(
        origin: tuple[float, float],
        left: tuple[float, float],
        right: tuple[float, float],
    ) -> float:
        return (
            (left[0] - origin[0]) * (right[1] - origin[1])
            - (left[1] - origin[1]) * (right[0] - origin[0])
        )

    lower: list[tuple[float, float]] = []
    for point in unique:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], point) <= 0:
            lower.pop()
        lower.append(point)
    upper: list[tuple[float, float]] = []
    for point in reversed(unique):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], point) <= 0:
            upper.pop()
        upper.append(point)
    return [
        np.asarray(point, dtype=np.float64)
        for point in lower[:-1] + upper[:-1]
    ]


def _support_margin(
    center: np.ndarray,
    contact_positions: list[np.ndarray],
) -> float | None:
    hull = _convex_hull(contact_positions)
    if len(hull) < 3:
        return None
    point = np.asarray(center[:2], dtype=np.float64)
    signed_crosses = []
    distances = []
    for index, start in enumerate(hull):
        end = hull[(index + 1) % len(hull)]
        edge = end - start
        signed_crosses.append(float(
            edge[0] * (point[1] - start[1])
            - edge[1] * (point[0] - start[0])
        ))
        distances.append(_segment_distance(point, start, end))
    inside = all(value >= -1e-12 for value in signed_crosses)
    margin = min(distances)
    return margin if inside else -margin


def _set_sampled_pose(
    model: mujoco.MjModel,
    data: mujoco.MjData,
    root_address: int,
    orientation: list[float],
    joint_specs: list[dict[str, Any]],
    joint_values: list[float],
    floor_clearance: float,
) -> None:
    _home_state(model, data)
    data.qvel[:] = 0
    data.ctrl[:] = 0
    for spec, value in zip(joint_specs, joint_values, strict=True):
        data.qpos[spec["qposAddress"]] = value
    data.qpos[root_address:root_address + 3] = np.asarray(
        [0.0, 0.0, 1.0],
        dtype=np.float64,
    )
    data.qpos[root_address + 3:root_address + 7] = np.asarray(
        orientation,
        dtype=np.float64,
    )
    mujoco.mj_normalizeQuat(model, data.qpos)
    mujoco.mj_forward(model, data)
    lower, _ = _robot_bounds(model, data)
    data.qpos[root_address + 2] += floor_clearance - float(lower[2])
    mujoco.mj_forward(model, data)


def _joint_values(
    sample_index: int,
    joint_specs: list[dict[str, Any]],
    home_qpos: np.ndarray,
) -> list[float]:
    if sample_index == 0:
        return [
            float(home_qpos[spec["qposAddress"]])
            for spec in joint_specs
        ]
    if sample_index == 1:
        return [
            (spec["range"][0] + spec["range"][1]) / 2.0
            for spec in joint_specs
        ]
    values = []
    for dimension, spec in enumerate(joint_specs):
        unit = _van_der_corput(sample_index - 1, _PRIMES[dimension])
        lower, upper = spec["range"]
        values.append(lower + (upper - lower) * unit)
    return values


def _pose_measurement(
    model: mujoco.MjModel,
    data: mujoco.MjData,
    contacts: list[dict[str, Any]],
    foot_geoms: set[int],
    joint_specs: list[dict[str, Any]],
    tolerance: float,
    floor_clearance: float,
) -> dict[str, Any]:
    foot_clearance: dict[str, float] = {}
    contacting: list[str] = []
    positions: list[np.ndarray] = []
    for contact in contacts:
        position = np.asarray(
            data.site_xpos[contact["siteId"]],
            dtype=np.float64,
        )
        clearance = float(position[2] - contact["radiusM"])
        foot_clearance[contact["id"]] = clearance
        if clearance <= floor_clearance + tolerance:
            contacting.append(contact["id"])
            positions.append(position[:2])

    support_body_geometries: list[str] = []
    for geom_index in range(model.ngeom):
        if int(model.geom_bodyid[geom_index]) == 0 or geom_index in foot_geoms:
            continue
        geom_position = np.asarray(data.geom_xpos[geom_index], dtype=np.float64)
        rotation = np.asarray(
            data.geom_xmat[geom_index],
            dtype=np.float64,
        ).reshape(3, 3)
        size = np.asarray(model.geom_size[geom_index], dtype=np.float64)
        geom_type = int(model.geom_type[geom_index])
        if geom_type == int(mujoco.mjtGeom.mjGEOM_SPHERE):
            z_extent = float(size[0])
        elif geom_type == int(mujoco.mjtGeom.mjGEOM_BOX):
            z_extent = float(np.abs(rotation[2]) @ size)
        elif geom_type in {
            int(mujoco.mjtGeom.mjGEOM_CAPSULE),
            int(mujoco.mjtGeom.mjGEOM_CYLINDER),
        }:
            z_extent = (
                abs(float(rotation[2, 2])) * float(size[1])
                + float(size[0])
            )
        else:
            z_extent = float(model.geom_rbound[geom_index])
        if float(geom_position[2]) - z_extent <= floor_clearance + tolerance:
            support_body_geometries.append(
                _geom_label(model, geom_index)
            )

    self_collision_pairs: set[tuple[str, str]] = set()
    for left, right in disallowed_self_contact_geom_pairs(model, data):
        names = sorted([
            _geom_label(model, left),
            _geom_label(model, right),
        ])
        self_collision_pairs.add((names[0], names[1]))

    utilization: dict[str, float | None] = {}
    maximum_utilization = 0.0
    limiting_joint: str | None = None
    for spec in joint_specs:
        capacity = float(spec["maximumEffort"])
        ratio = (
            abs(float(data.qfrc_bias[spec["dofAddress"]])) / capacity
            if capacity > 0
            else None
        )
        utilization[spec["name"]] = ratio
        if ratio is not None and ratio > maximum_utilization:
            maximum_utilization = ratio
            limiting_joint = spec["name"]

    center_of_mass = _body_center_of_mass(model, data)
    clearances = sorted(foot_clearance.values())
    second_contact_gap = (
        max(0.0, clearances[1] - floor_clearance)
        if len(clearances) >= 2
        else math.inf
    )
    return {
        "rootPositionM": [
            float(value) for value in data.qpos[:3]
        ],
        "qpos": [float(value) for value in data.qpos],
        "jointPositions": {
            spec["name"]: float(data.qpos[spec["qposAddress"]])
            for spec in joint_specs
        },
        "footSurfaceClearanceM": foot_clearance,
        "contactingFeet": sorted(contacting),
        "simultaneousFootContacts": len(contacting),
        "secondFootContactGapM": second_contact_gap,
        "meanFootSurfaceClearanceM": float(np.mean(clearances)),
        "supportBodyGeometries": sorted(set(support_body_geometries)),
        "selfCollisionPairs": [
            list(pair) for pair in sorted(self_collision_pairs)
        ],
        "centerOfMassM": [float(value) for value in center_of_mass],
        "supportMarginM": _support_margin(center_of_mass, positions),
        "gravityBiasEffortUtilization": utilization,
        "maximumGravityBiasEffortUtilization": maximum_utilization,
        "gravityBiasLimitingJoint": limiting_joint,
    }


def _measurement_key(measurement: dict[str, Any]) -> tuple[Any, ...]:
    return (
        -int(measurement["simultaneousFootContacts"]),
        float(measurement["secondFootContactGapM"]),
        len(measurement["selfCollisionPairs"]),
        float(measurement["meanFootSurfaceClearanceM"]),
        float(measurement["maximumGravityBiasEffortUtilization"]),
    )


def _home_support(
    model: mujoco.MjModel,
    data: mujoco.MjData,
    contacts: list[dict[str, Any]],
    tolerance: float,
) -> dict[str, Any]:
    _home_state(model, data)
    center_of_mass = _body_center_of_mass(model, data)
    clearances = {}
    active_positions = []
    active = []
    for contact in contacts:
        position = np.asarray(
            data.site_xpos[contact["siteId"]],
            dtype=np.float64,
        )
        clearance = float(position[2] - contact["radiusM"])
        clearances[contact["id"]] = clearance
        if clearance <= tolerance:
            active.append(contact["id"])
            active_positions.append(position[:2])
    return {
        "footSurfaceClearanceM": clearances,
        "contactingFeet": sorted(active),
        "simultaneousFootContacts": len(active),
        "requiredFootContacts": len(contacts),
        "screeningOutcome": (
            "FULL_FOOT_SUPPORT"
            if len(active) == len(contacts)
            else "HOME_SUPPORT_BLOCKED"
        ),
        "centerOfMassM": [float(value) for value in center_of_mass],
        "supportMarginM": _support_margin(center_of_mass, active_positions),
    }


def _report(analysis: dict[str, Any]) -> str:
    pose_lines = []
    for pose in analysis["restingPoses"]:
        best = pose["best"]
        pose_lines.append(
            f"| `{pose['id']}` | `{pose['screeningOutcome']}` | "
            f"{best['simultaneousFootContacts']}/"
            f"{analysis['contactPointCount']} | "
            f"{best['secondFootContactGapM']:.4f} | "
            f"{len(best['selfCollisionPairs'])} | "
            f"`{pose['image']}` |"
        )
    return (
        f"# Design Analysis {analysis['id']}\n\n"
        f"Assembly: `{analysis['assembly']}`\n\n"
        f"Screening outcome: **{analysis['screeningOutcome']}**\n\n"
        "## Authored home support\n\n"
        f"- Screening: `{analysis['homeSupport']['screeningOutcome']}`\n"
        f"- Contact opportunities: "
        f"{analysis['homeSupport']['simultaneousFootContacts']}/"
        f"{analysis['contactPointCount']}\n"
        f"- COM support margin: "
        f"{analysis['homeSupport']['supportMarginM']}\n\n"
        "## Resting-pose workspace sweep\n\n"
        "| Pose | Screening | Best foot contacts | Second-foot gap (m) | "
        "Self-collision pairs | Best-pose image |\n"
        "| --- | --- | ---: | ---: | ---: | --- |\n"
        + "\n".join(pose_lines)
        + "\n\n"
        "## Authority boundary\n\n"
        "This is a deterministic sampled kinematic screening probe. It can "
        "falsify a claimed contact mechanism within the declared sample budget, "
        "but it does not prove dynamic recovery, design acceptance, promotion, "
        "or physical hardware capability.\n"
    )


def _html_report(analysis: dict[str, Any]) -> str:
    home = analysis["homeSupport"]
    pose_cards = []
    for pose in analysis["restingPoses"]:
        best = pose["best"]
        passed = pose["screeningOutcome"] == "CONTACT_OPPORTUNITY"
        pose_cards.append(
            "<article class=\"card\">"
            f"<img src=\"{html.escape(pose['image'])}\" "
            f"alt=\"Best collision-free sample for {html.escape(pose['id'])}\">"
            "<div class=\"body\">"
            f"<div class=\"eyebrow\">{html.escape(pose['id'])}</div>"
            f"<h2 class=\"{'pass' if passed else 'fail'}\">"
            f"{html.escape(pose['screeningOutcome'])}</h2>"
            f"<p><strong>{best['simultaneousFootContacts']}/"
            f"{analysis['contactPointCount']}</strong> feet within tolerance · "
            f"second-foot gap <strong>{best['secondFootContactGapM']:.4f} m</strong></p>"
            f"<p>{len(best['selfCollisionPairs'])} self-collision pairs in the "
            "displayed collision-free selection.</p>"
            "</div></article>"
        )
    passed = analysis["screeningOutcome"] == "CONTACT_OPPORTUNITY_ALL_POSES"
    return (
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">"
        "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">"
        f"<title>Design Analysis · {html.escape(analysis['assembly'])}</title>"
        "<style>"
        ":root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui,sans-serif;"
        "background:#0b0e13;color:#edf2f7}*{box-sizing:border-box}"
        "body{margin:0;padding:40px;background:radial-gradient(circle at 15% 0%,"
        "#172339 0,#0b0e13 38%);min-height:100vh}.wrap{max-width:1240px;margin:auto}"
        ".eyebrow{font:700 12px ui-monospace,monospace;letter-spacing:.12em;"
        "text-transform:uppercase;color:#8fa4c2}.hero{display:grid;grid-template-columns:"
        "1fr auto;gap:24px;align-items:end;margin-bottom:30px}h1{font-size:clamp(30px,"
        "6vw,62px);line-height:.95;margin:10px 0}.status{border:1px solid #34445b;"
        "border-radius:999px;padding:10px 14px;font:700 12px ui-monospace,monospace}"
        ".pass{color:#69e5ad}.fail{color:#ff8a8a}.summary{display:grid;"
        "grid-template-columns:repeat(3,minmax(0,1fr));gap:14px;margin-bottom:24px}"
        ".metric,.card{background:#121822;border:1px solid #263143;border-radius:16px;"
        "overflow:hidden}.metric{padding:18px}.metric strong{display:block;"
        "font-size:25px;margin-top:7px}.grid{display:grid;grid-template-columns:"
        "repeat(2,minmax(0,1fr));gap:18px}.card img{display:block;width:100%;"
        "aspect-ratio:4/3;object-fit:cover;background:#050608}.card .body{padding:18px}"
        ".card h2{font-size:17px;margin:7px 0}.card p{color:#b8c3d1;line-height:1.5;"
        "margin:8px 0}.boundary{margin-top:24px;padding:18px;border-left:3px solid "
        "#6d87ad;background:#111722;color:#b8c3d1;line-height:1.55}"
        "@media(max-width:760px){body{padding:22px}.hero{grid-template-columns:1fr}"
        ".summary,.grid{grid-template-columns:1fr}}"
        "</style></head><body><main class=\"wrap\">"
        "<header class=\"hero\"><div>"
        "<div class=\"eyebrow\">Mujica · deterministic sampled kinematics</div>"
        f"<h1>{html.escape(analysis['assembly'])}</h1>"
        f"<p>{html.escape(analysis['id'])}</p></div>"
        f"<div class=\"status {'pass' if passed else 'fail'}\">"
        f"{html.escape(analysis['screeningOutcome'])}</div></header>"
        "<section class=\"summary\">"
        f"<div class=\"metric\"><div class=\"eyebrow\">Home support</div><strong>"
        f"{home['simultaneousFootContacts']}/{analysis['contactPointCount']} feet"
        "</strong></div>"
        f"<div class=\"metric\"><div class=\"eyebrow\">Samples per pose</div><strong>"
        f"{analysis['settings']['samples']}</strong></div>"
        f"<div class=\"metric\"><div class=\"eyebrow\">Contact tolerance</div><strong>"
        f"{analysis['settings']['contactToleranceM'] * 100:.1f} cm</strong></div>"
        "</section><section class=\"grid\">"
        + "".join(pose_cards)
        + "</section><aside class=\"boundary\"><strong>Authority boundary.</strong> "
        "This page visualizes a deterministic sampled kinematic screening probe. "
        "It does not prove dynamic recovery, accept a design, promote a candidate, "
        "or provide physical hardware evidence.</aside></main></body></html>"
    )


def _verify_cached_analysis(target: Path, manifest: dict[str, Any]) -> dict[str, Any]:
    analysis_path = target / "analysis.json"
    report_path = target / "report.md"
    html_path = target / "index.html"
    if (
        not analysis_path.is_file()
        or hash_file(analysis_path) != manifest.get("analysisHash")
        or not report_path.is_file()
        or hash_file(report_path) != manifest.get("reportHash")
        or not html_path.is_file()
        or hash_file(html_path) != manifest.get("htmlHash")
    ):
        raise RuntimeError(
            f"Design Analysis at '{target}' failed artifact integrity verification"
        )
    expected_images = sorted(
        str(image["file"]) for image in manifest.get("images", [])
    )
    actual_images = sorted(
        path.relative_to(target).as_posix()
        for path in (target / "images").glob("*.png")
        if path.is_file()
    )
    if expected_images != actual_images:
        raise RuntimeError(f"Design Analysis at '{target}' is incomplete")
    for image in manifest.get("images", []):
        if hash_file(target / str(image["file"])) != image.get("fileHash"):
            raise RuntimeError(
                f"Design Analysis at '{target}' failed image integrity verification"
            )
    return json.loads(analysis_path.read_text())


def analyze_design(request: dict[str, Any]) -> dict[str, Any]:
    model_path = Path(request["modelPath"]).resolve()
    output_root = Path(request["outputRoot"]).resolve()
    if not model_path.is_file():
        raise RuntimeError(f"Design Analysis model is missing: {model_path}")
    if hash_file(model_path) != request["modelHash"]:
        raise RuntimeError("Design Analysis model hash differs from compiled source")

    model = mujoco.MjModel.from_xml_path(str(model_path))
    data = mujoco.MjData(model)
    settings = dict(request["settings"])
    samples = int(settings["samples"])
    tolerance = float(settings["contactToleranceM"])
    floor_clearance = float(settings["floorClearanceM"])
    minimum_support_contacts = int(settings["minimumSupportContacts"])
    width = int(settings["width"])
    height = int(settings["height"])
    distance, distance_mode = _resolve_camera_distance(
        model,
        data,
        settings["cameraDistance"],
    )
    settings["cameraDistance"] = distance
    settings["cameraDistanceMode"] = distance_mode
    if not 128 <= samples <= 65_536:
        raise RuntimeError("Design Analysis samples must be between 128 and 65536")
    if not math.isfinite(tolerance) or not 0.001 <= tolerance <= 0.1:
        raise RuntimeError("Design Analysis contact tolerance is outside bounds")
    if not math.isfinite(floor_clearance) or not 0 <= floor_clearance <= 0.02:
        raise RuntimeError("Design Analysis floor clearance is outside bounds")
    if not 1 <= minimum_support_contacts <= len(request["contactPoints"]):
        raise RuntimeError("Design Analysis minimum support contact count is invalid")
    if not 320 <= width <= 640 or not 240 <= height <= 480:
        raise RuntimeError("Design Analysis resolution is outside supported bounds")
    identity = {
        "analyzer": DESIGN_ANALYZER_ID,
        "runtimeVersion": request["runtimeVersion"],
        "runtimeSourceHash": request["runtimeSourceHash"],
        "mujocoVersion": mujoco.__version__,
        "assembly": request["assembly"],
        "assemblyHash": request["assemblyHash"],
        "modelHash": request["modelHash"],
        "baseBody": request["baseBody"],
        "contactPoints": request["contactPoints"],
        "settings": settings,
    }
    analysis_id = f"design-analysis-{hash_json(identity)[:16]}"
    target = output_root / analysis_id
    manifest_path = target / "manifest.json"
    if manifest_path.exists():
        manifest = json.loads(manifest_path.read_text())
        if any(manifest.get(key) != value for key, value in identity.items()):
            raise RuntimeError(f"Design Analysis identity collision at {target}")
        analysis = _verify_cached_analysis(target, manifest)
        return {
            "id": analysis_id,
            "path": str(target),
            "analysis": analysis,
            "manifest": manifest,
            "cached": True,
        }

    root = _root_free_joint(model)
    if root is None:
        raise RuntimeError("Design Analysis requires a free root joint")
    _, root_address = root
    base_body_id = mujoco.mj_name2id(
        model,
        mujoco.mjtObj.mjOBJ_BODY,
        str(request["baseBody"]),
    )
    if base_body_id < 0:
        raise RuntimeError(
            f"Design Analysis base body '{request['baseBody']}' is absent from model"
        )
    contacts = _contact_specs(model, request["contactPoints"])
    joint_specs = _actuated_joint_specs(model)
    _home_state(model, data)
    home_qpos = np.array(data.qpos, dtype=np.float64, copy=True)
    foot_geoms = _foot_geom_ids(model, data, contacts)
    pose_specs = [
        {"id": "fallen-left", "orientationWxyz": [math.sqrt(0.5), math.sqrt(0.5), 0.0, 0.0]},
        {"id": "fallen-right", "orientationWxyz": [math.sqrt(0.5), -math.sqrt(0.5), 0.0, 0.0]},
        {"id": "fallen-front", "orientationWxyz": [math.sqrt(0.5), 0.0, math.sqrt(0.5), 0.0]},
        {"id": "fallen-back", "orientationWxyz": [math.sqrt(0.5), 0.0, -math.sqrt(0.5), 0.0]},
    ]
    pose_results = []
    for pose in pose_specs:
        best_any: dict[str, Any] | None = None
        best_collision_free: dict[str, Any] | None = None
        histogram = {str(count): 0 for count in range(len(contacts) + 1)}
        per_foot_minimum = {contact["id"]: math.inf for contact in contacts}
        for sample_index in range(samples):
            values = _joint_values(sample_index, joint_specs, home_qpos)
            _set_sampled_pose(
                model,
                data,
                root_address,
                pose["orientationWxyz"],
                joint_specs,
                values,
                floor_clearance,
            )
            measurement = _pose_measurement(
                model,
                data,
                contacts,
                foot_geoms,
                joint_specs,
                tolerance,
                floor_clearance,
            )
            histogram[str(measurement["simultaneousFootContacts"])] += 1
            for contact_id, clearance in measurement[
                "footSurfaceClearanceM"
            ].items():
                per_foot_minimum[contact_id] = min(
                    per_foot_minimum[contact_id],
                    clearance,
                )
            if (
                best_any is None
                or _measurement_key(measurement) < _measurement_key(best_any)
            ):
                best_any = measurement
            if (
                not measurement["selfCollisionPairs"]
                and (
                    best_collision_free is None
                    or _measurement_key(measurement)
                    < _measurement_key(best_collision_free)
                )
            ):
                best_collision_free = measurement
        assert best_any is not None
        best = best_collision_free if best_collision_free is not None else best_any
        opportunity = (
            best_collision_free is not None
            and
            best["simultaneousFootContacts"] >= minimum_support_contacts
        )
        pose_results.append({
            **pose,
            "samplesEvaluated": samples,
            "minimumSupportContacts": minimum_support_contacts,
            "screeningOutcome": (
                "CONTACT_OPPORTUNITY"
                if opportunity
                else "NO_CONTACT_OPPORTUNITY_IN_SAMPLE_BUDGET"
            ),
            "contactCountHistogram": histogram,
            "perFootMinimumSurfaceClearanceM": per_foot_minimum,
            "best": best,
            "bestCollisionFree": best_collision_free,
            "bestRaw": best_any,
            "displayedSelection": (
                "collision-free"
                if best_collision_free is not None
                else "raw-diagnostic-with-self-collision"
            ),
            "bestRawContactCount": best_any["simultaneousFootContacts"],
            "bestRawContactHasSelfCollision": bool(
                best_any["selfCollisionPairs"]
            ),
            "image": f"images/{pose['id']}-best.png",
        })

    home_support = _home_support(model, data, contacts, tolerance)
    all_opportunities = all(
        pose["screeningOutcome"] == "CONTACT_OPPORTUNITY"
        for pose in pose_results
    )
    overall_outcome = (
        "HOME_SUPPORT_BLOCKED"
        if home_support["screeningOutcome"] != "FULL_FOOT_SUPPORT"
        else (
            "CONTACT_OPPORTUNITY_ALL_POSES"
            if all_opportunities
            else "RECOVERY_CONTACT_OPPORTUNITY_BLOCKED"
        )
    )
    analysis = {
        "version": 1,
        "id": analysis_id,
        "kind": "mujica-design-analysis",
        "assembly": request["assembly"],
        "assemblyHash": request["assemblyHash"],
        "modelHash": request["modelHash"],
        "analyzer": DESIGN_ANALYZER_ID,
        "settings": settings,
        "actuatedJoints": joint_specs,
        "contactPointCount": len(contacts),
        "homeSupport": home_support,
        "restingPoses": pose_results,
        "screeningOutcome": overall_outcome,
        "limitations": [
            "The sweep samples bounded joint workspace; failure is not a proof of mathematical impossibility.",
            "Kinematic contact opportunity does not prove dynamically reachable recovery.",
            "Gravity-bias effort excludes contact-force optimization and is a screening quantity only.",
            "MuJoCo simulation is not physical hardware evidence.",
        ],
        "authorityBoundary": {
            "source": "compiled-mjcf",
            "probe": "deterministic-sampled-kinematics",
            "designAcceptance": "none",
            "dynamicCapability": False,
            "physicalEvidence": False,
            "promotion": "locked-judge-only",
        },
    }
    report = _report(analysis)
    html_report = _html_report(analysis)

    def writer(directory: Path) -> None:
        images_directory = directory / "images"
        images_directory.mkdir()
        renderer = mujoco.Renderer(model, width=width, height=height)
        images = []
        try:
            for pose in pose_results:
                data.qpos[:] = np.asarray(pose["best"]["qpos"], dtype=np.float64)
                data.qvel[:] = 0
                data.ctrl[:] = 0
                mujoco.mj_forward(model, data)
                camera = mujoco.MjvCamera()
                camera.type = mujoco.mjtCamera.mjCAMERA_FREE
                camera.lookat[:] = data.xpos[base_body_id]
                camera.distance = distance
                camera.azimuth = 135.0
                camera.elevation = -22.0
                renderer.update_scene(data, camera=camera)
                image_path = directory / pose["image"]
                write_rgb_png(image_path, renderer.render())
                images.append({
                    "id": f"{pose['id']}-best",
                    "pose": pose["id"],
                    "file": pose["image"],
                    "fileHash": hash_file(image_path),
                })
        finally:
            renderer.close()
        write_json(directory / "analysis.json", analysis)
        (directory / "report.md").write_text(report)
        (directory / "index.html").write_text(html_report)
        write_json(directory / "manifest.json", {
            "version": 1,
            "id": analysis_id,
            "kind": analysis["kind"],
            **identity,
            "analysisHash": hash_file(directory / "analysis.json"),
            "reportHash": hash_file(directory / "report.md"),
            "htmlHash": hash_file(directory / "index.html"),
            "images": images,
            "authorityBoundary": analysis["authorityBoundary"],
            "completed": True,
        })

    atomic_directory(target, writer)
    manifest = json.loads((target / "manifest.json").read_text())
    published_analysis = _verify_cached_analysis(target, manifest)
    return {
        "id": analysis_id,
        "path": str(target),
        "analysis": published_analysis,
        "manifest": manifest,
        "cached": False,
    }
