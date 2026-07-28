from __future__ import annotations

import mujoco


def within_kinematic_edges(
    model: mujoco.MjModel,
    descendant: int,
    ancestor: int,
    maximum_edges: int = 2,
) -> bool:
    """Return whether two bodies meet at an allowed local assembly interface."""
    current = descendant
    for _ in range(maximum_edges):
        current = int(model.body_parentid[current])
        if current == ancestor:
            return True
        if current == 0:
            break
    return False


def disallowed_self_contact_geom_pairs(
    model: mujoco.MjModel,
    data: mujoco.MjData,
) -> set[tuple[int, int]]:
    """Return non-world, non-local self-contact geom pairs.

    Mujica permits contact across the first two kinematic edges because compact
    joint packages commonly overlap their parent mounting envelope. All other
    self-contact is disallowed. Design screening and dynamic evaluation must
    call this same predicate.
    """
    result: set[tuple[int, int]] = set()
    for contact_index in range(data.ncon):
        contact = data.contact[contact_index]
        first_geom = int(contact.geom1)
        second_geom = int(contact.geom2)
        first_body = int(model.geom_bodyid[first_geom])
        second_body = int(model.geom_bodyid[second_geom])
        if (
            first_body <= 0
            or second_body <= 0
            or first_body == second_body
            or within_kinematic_edges(model, first_body, second_body)
            or within_kinematic_edges(model, second_body, first_body)
        ):
            continue
        result.add(tuple(sorted((first_geom, second_geom))))
    return result
