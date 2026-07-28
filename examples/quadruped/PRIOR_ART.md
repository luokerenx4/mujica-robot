# Quadruped Prior Art Study

Date: 2026-07-28

Decision: adapt a Solo12-informed 12-DoF architecture; do not fork or copy assets yet.

## Why this study exists

The current Mujica quadruped was a good Harness fixture and a poor robot design
baseline. It proved compilation, simulation, evaluation, research, and Studio,
but it quietly promoted “a body with four simple legs” into the object being
optimized. Self-righting then failed for a more basic reason than policy
quality: we had never decided what a credible robot should physically be.

This study resets that decision before more Controller or RL work.

The complete machine-readable evidence, including exact upstream commits and
license boundaries, is in `prior-art-study.json`.

## What was actually inspected

Six references were checked against primary repositories, and all six
repositories were shallow-cloned outside the workspace:

| Reference | What is genuinely available | License finding | Use in Mujica |
| --- | --- | --- | --- |
| ODRI Solo12 hardware | 12-DoF mechanics, actuator modules, electronics, build/calibration docs, STL/SolidWorks/STEP assets, BOM | BSD-3-Clause at the inspected repo root | Primary physical architecture |
| ODRI `robot_properties_solo` | Solo12 Xacro/URDF, meshes, configuration, PyBullet/Pinocchio wrapper | BSD-3-Clause | Primary kinematic/model reference |
| MuJoCo Menagerie Go2 | MuJoCo/MJX MJCF, meshes, conversion and contact notes | BSD-3-Clause for `unitree_go2` specifically | MuJoCo modeling-quality reference only |
| mjbots quad | Physical parts, simulator, controller, configs, maintenance and web operation | Root Apache-2.0, but README says “most files”; copy boundary is partial | Whole-system integration reference |
| Stanford Doggo | 2-DoF five-bar quasi-direct-drive design, electronics, linked CAD/code, paper | MIT for root repo; linked assets/submodules need separate checks | Powertrain and agility reference |
| Stanford Pupper v1 | Readable gait/stance/swing/IK/hardware software | MIT for root repo; design assets are external; project is EOL | Educational Controller reference |

The most important negative finding is that a licensed simulation description
is not open hardware. Menagerie's Go2 assets can teach us how a mature MuJoCo
model is structured, but they do not establish manufacturing CAD, electronics,
or a legally reusable commercial robot architecture.

## Decision

Use ODRI Solo12 as the architecture reference and implement a clean,
parameterized Mujica Assembly around the same fundamental idea:

- four 3-DoF legs, each with hip abduction/adduction, hip flexion/extension,
  and knee flexion/extension;
- actuator and joint limits grounded in real modular torque-controlled
  hardware;
- a packaged torso, feet, collision bodies, mass, inertia, wiring constraints,
  and calibration assumptions instead of an abstract rectangular body;
- an explicit route from open hardware facts to an independently validated
  MuJoCo model.

This is an `adapt` decision, not a blind fork. The upstream repositories contain
valuable hardware and simulation stacks that Mujica does not need to inherit
wholesale. No third-party code, CAD, mesh, image, or model has been added in
this study. If a later Design Study needs an exact upstream asset, it first
adds path-level provenance, license, attribution, and modification records.

Doggo remains useful for quasi-direct-drive reasoning but its planar 2-DoF legs
are not the default for omnidirectional motion. Pupper is useful for readable
deterministic control probes, not morphology. mjbots is the best integration
reference inspected, especially for connecting physical configuration,
simulation, maintenance, and a human UI, but its “most files” license wording
means every copied path would need another check.

## Next bounded design cycle

The next embodiment Plan should:

1. build a Solo12-informed 12-DoF Assembly from traceable dimensions and
   explicit hypotheses;
2. render standing, folded, supine, prone, and side poses locally;
3. check collision-free foot reach, support opportunities, joint margins,
   torso clearance, and plausible external moment paths;
4. show the resulting forms to a human before choosing the baseline;
5. compare against the old demo with identical static probes;
6. run bounded deterministic dynamic probes only after the static design gate
   passes.

RL remains paused. A better policy cannot manufacture a missing joint, contact,
clearance, or force path.

## Primary references

- Open Dynamic Robot Initiative,
  [Open Robot Actuator Hardware](https://github.com/open-dynamic-robot-initiative/open_robot_actuator_hardware)
  and [Solo robot properties](https://github.com/open-dynamic-robot-initiative/robot_properties_solo)
- Grimminger et al.,
  [An Open Torque-Controlled Modular Robot Architecture for Legged Locomotion Research](https://arxiv.org/abs/1910.00093)
- Google DeepMind,
  [MuJoCo Menagerie](https://github.com/google-deepmind/mujoco_menagerie/tree/main/unitree_go2)
- [mjbots quad](https://github.com/mjbots/quad)
- Kau et al.,
  [Stanford Doggo](https://github.com/Nate711/StanfordDoggoProject) and
  [architecture paper](https://arxiv.org/abs/1905.04254)
- [Stanford Pupper v1](https://github.com/stanfordroboticsclub/StanfordQuadruped)
