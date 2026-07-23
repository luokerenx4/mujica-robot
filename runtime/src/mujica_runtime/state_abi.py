from __future__ import annotations

from pathlib import Path
from typing import Any

import mujoco

from .io import hash_file, hash_json


STATE_ABI_KIND = "mujica-hardware-state-abi"


def _canonical_number(value: Any) -> int | float:
    number = float(value)
    return int(number) if number.is_integer() else number


def _name(model: mujoco.MjModel, object_type: mujoco.mjtObj, index: int, fallback: str) -> str:
    value = mujoco.mj_id2name(model, object_type, index)
    return value if value else fallback


def _coordinate(
    index: int,
    name: str,
    joint: str,
    component: str,
    unit: str,
    frame: str,
) -> dict[str, Any]:
    return {
        "index": index,
        "name": name,
        "joint": joint,
        "component": component,
        "unit": unit,
        "frame": frame,
    }


def describe_state(request: dict[str, Any]) -> dict[str, Any]:
    model_path = Path(request["modelPath"]).resolve()
    if not model_path.is_file() or hash_file(model_path) != request["modelHash"]:
        raise RuntimeError("State ABI model differs from the requested frozen model")
    model = mujoco.MjModel.from_xml_path(str(model_path))

    qpos_coordinates: list[dict[str, Any]] = []
    qvel_coordinates: list[dict[str, Any]] = []
    joints: list[dict[str, Any]] = []
    joint_type_names = {
        int(mujoco.mjtJoint.mjJNT_FREE): "free",
        int(mujoco.mjtJoint.mjJNT_BALL): "ball",
        int(mujoco.mjtJoint.mjJNT_SLIDE): "slide",
        int(mujoco.mjtJoint.mjJNT_HINGE): "hinge",
    }

    for joint_index in range(model.njnt):
        joint = _name(model, mujoco.mjtObj.mjOBJ_JOINT, joint_index, f"joint-{joint_index}")
        joint_type = int(model.jnt_type[joint_index])
        kind = joint_type_names.get(joint_type)
        if kind is None:
            raise RuntimeError(f"State ABI encountered unsupported MuJoCo joint type {joint_type}")
        qpos_start = int(model.jnt_qposadr[joint_index])
        qvel_start = int(model.jnt_dofadr[joint_index])
        axis = [_canonical_number(value) for value in model.jnt_axis[joint_index]]
        reference = [_canonical_number(value) for value in model.qpos0[qpos_start:qpos_start + {"free": 7, "ball": 4, "slide": 1, "hinge": 1}[kind]]]

        if kind == "free":
            qpos_specs = [
                ("position.x", "m", "model-world"),
                ("position.y", "m", "model-world"),
                ("position.z", "m", "model-world"),
                ("orientation.w", "unit-quaternion", "model-world-from-body"),
                ("orientation.x", "unit-quaternion", "model-world-from-body"),
                ("orientation.y", "unit-quaternion", "model-world-from-body"),
                ("orientation.z", "unit-quaternion", "model-world-from-body"),
            ]
            qvel_specs = [
                ("linear-velocity.x", "m/s", "model-world"),
                ("linear-velocity.y", "m/s", "model-world"),
                ("linear-velocity.z", "m/s", "model-world"),
                ("angular-velocity.x", "rad/s", "body-local"),
                ("angular-velocity.y", "rad/s", "body-local"),
                ("angular-velocity.z", "rad/s", "body-local"),
            ]
        elif kind == "ball":
            qpos_specs = [
                ("orientation.w", "unit-quaternion", "relative-to-initial"),
                ("orientation.x", "unit-quaternion", "relative-to-initial"),
                ("orientation.y", "unit-quaternion", "relative-to-initial"),
                ("orientation.z", "unit-quaternion", "relative-to-initial"),
            ]
            qvel_specs = [
                ("angular-velocity.x", "rad/s", "joint-local-tangent"),
                ("angular-velocity.y", "rad/s", "joint-local-tangent"),
                ("angular-velocity.z", "rad/s", "joint-local-tangent"),
            ]
        elif kind == "slide":
            qpos_specs = [("position", "m", "body-fixed-axis")]
            qvel_specs = [("velocity", "m/s", "body-fixed-axis")]
        else:
            qpos_specs = [("position", "rad", "body-fixed-axis")]
            qvel_specs = [("velocity", "rad/s", "body-fixed-axis")]

        qpos_indices = []
        for offset, (component, unit, frame) in enumerate(qpos_specs):
            index = qpos_start + offset
            qpos_indices.append(index)
            qpos_coordinates.append(_coordinate(index, f"{joint}.{component}", joint, component, unit, frame))
        qvel_indices = []
        for offset, (component, unit, frame) in enumerate(qvel_specs):
            index = qvel_start + offset
            qvel_indices.append(index)
            qvel_coordinates.append(_coordinate(index, f"{joint}.{component}", joint, component, unit, frame))
        joints.append({
            "index": joint_index,
            "name": joint,
            "type": kind,
            "qposIndices": qpos_indices,
            "qvelIndices": qvel_indices,
            "axis": axis,
            "referenceQpos": reference,
        })

    qpos_coordinates.sort(key=lambda item: item["index"])
    qvel_coordinates.sort(key=lambda item: item["index"])
    if [item["index"] for item in qpos_coordinates] != list(range(model.nq)):
        raise RuntimeError("State ABI qpos coordinates do not cover the exact MuJoCo state")
    if [item["index"] for item in qvel_coordinates] != list(range(model.nv)):
        raise RuntimeError("State ABI qvel coordinates do not cover the exact MuJoCo state")
    if len({item["name"] for item in qpos_coordinates}) != model.nq:
        raise RuntimeError("State ABI qpos coordinate names are not unique")
    if len({item["name"] for item in qvel_coordinates}) != model.nv:
        raise RuntimeError("State ABI qvel coordinate names are not unique")

    actuators = []
    for actuator_index in range(model.nu):
        actuator = _name(model, mujoco.mjtObj.mjOBJ_ACTUATOR, actuator_index, f"actuator-{actuator_index}")
        transmission_id = int(model.actuator_trnid[actuator_index, 0])
        transmission_joint = (
            _name(model, mujoco.mjtObj.mjOBJ_JOINT, transmission_id, f"joint-{transmission_id}")
            if transmission_id >= 0
            else None
        )
        actuators.append({
            "index": actuator_index,
            "name": actuator,
            **({"transmissionJoint": transmission_joint} if transmission_joint is not None else {}),
        })

    contract = {
        "version": 1,
        "kind": STATE_ABI_KIND,
        "runtime": "mujoco",
        "assembly": request["assembly"],
        "assemblyHash": request["assemblyHash"],
        "modelHash": request["modelHash"],
        "qpos": {"size": model.nq, "coordinates": qpos_coordinates},
        "qvel": {"size": model.nv, "coordinates": qvel_coordinates},
        "joints": joints,
        "actuators": actuators,
        "quaternionConvention": {"order": "wxyz", "handedness": "right-handed"},
        "driverBoundary": {
            "wireOrder": "exact-contract-index-order",
            "normalizationOwner": "driver",
            "requirement": (
                "The Driver MUST transform native encoder order, sign, zero offset, unit, "
                "base frame, and quaternion order into this ABI before emitting state."
            ),
        },
    }
    return {"stateContract": contract, "stateContractHash": hash_json(contract)}
