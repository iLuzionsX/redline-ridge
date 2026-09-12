// ============================================================================
// gta4-tuning.js — GTA IV-feel vehicle tuning on cannon-es 0.20.0 RaycastVehicle
// for the Redline Ridge racing game (artifact: racing-game).
//
// Verified against the cannon-es@0.20.0 source (dist/cannon-es.cjs.js):
//  - suspensionForce = stiffness * compression * chassisMass  -> stiffness 20-30
//    gives ~8-12 cm sag on a 1500 kg car. Soft & floaty, very GTA IV.
//  - engineForce is a FORCE in Newtons, summed over driven wheels:
//    total = mass * accel, so engineForceMax ~ mass * 6 = 9000 N.
//  - RaycastVehicle constructor defaults are indexRightAxis=2, indexForwardAxis=0
//    in 0.20.0 (!), so we MUST pass explicit axes: right=+X, forward=+Z, up=+Y.
//  - With forward=+Z: NEGATIVE engineForce drives forward (ENGINE_SIGN = -1).
//  - Positive setSteeringValue turns LEFT in our convention, so input steer
//    (+1 = right, per physics_spec.md) needs STEER_SIGN = -1.
//  - wheel.rotation accumulates spin; wheel.sliding flags slip; wheelInfos[i]
//    fields (suspensionStiffness, frictionSlip, ...) are live-mutable.
//
// Conventions (match physics_spec.md): meters/seconds/radians, Y-up,
// heading 0 = +Z, forward = (sin h, cos h), steer +1 = right.
// Drive: RWD (rear-wheel drive) like classic GTA IV sedans.
//
// Per fixed step (1/60), call in this order:
//   api.applyInput(input, dt)   // before world.step
//   world.step(1/60)
//   api.syncVisual(dt)          // after world.step
//   overlay.update()            // debug UI
//
// Import map (pin the version — the API below is verified for 0.20.0):
//   { "imports": {
//       "three": "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js",
//       "cannon-es": "https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/dist/cannon-es.js"
//   } }
// ============================================================================

import {
  World,
  Body,
  Box,
  Vec3,
  SAPBroadphase,
  Material,
  ContactMaterial,
  RaycastVehicle,
  Trimesh,
} from 'cannon-es';

// ---------------------------------------------------------------------------
// Verified sign conventions (do not flip without a drive test)
// ---------------------------------------------------------------------------
export const ENGINE_SIGN = -1; // negative engineForce = forward (+Z)
export const STEER_SIGN = -1;   // positive setSteeringValue = LEFT; input +1 = right

// ---------------------------------------------------------------------------
// GTA4_DEFAULTS — every tunable in one place. tune() can change any of these
// at runtime (wheel params propagate to live WheelInfo objects).
// ---------------------------------------------------------------------------
export const GTA4_DEFAULTS = {
  // --- chassis ------------------------------------------------------------
  mass: 1500,            // kg — GTA IV cars feel heavy; this is the anchor
  halfExtents: [0.95, 0.5, 2.15], // collision box (w, h, l)/2
  shapeOffsetY: 0.25,    // shape sits above body origin -> CoM effectively low
  angularDamping: 0.4,   // calms yaw wobble; GTA IV has lazy rotation
  linearDamping: 0.01,

  // --- wheels ---------------------------------------------------------------
  wheelRadius: 0.34,
  wheelBase: 2.7,        // -> axles at z = +/-1.35 (matches car art spec)
  trackWidth: 1.62,      // -> x = +/-0.81
  suspensionRestLength: 0.5,   // long travel = floaty
  maxSuspensionTravel: 0.35,
  suspensionStiffness: 24,     // soft; ~10cm sag at 1500kg
  dampingRelaxation: 2.8,      // rebound — underdamped = float
  dampingCompression: 4.5,
  frictionSlipFront: 2.4,      // front grips...
  frictionSlipRear: 2.0,       // ...rear grips less -> RWD oversteer character
  rollInfluence: 0.08,         // visible body roll (0.01 = glued, 0.15 = tippy)
  maxSuspensionForce: 1e5,

  // --- powertrain (RWD) -------------------------------------------------------
  engineForceMax: 9000,  // N total ~= 6 m/s^2 launch. Split over 2 rear wheels.
  topSpeed: 62,          // m/s (~223 km/h) — engine tapers to 0 here
  reverseMax: 0.45,      // reverse as fraction of forward force
  nitroMultiplier: 1.35,
  nitroDrain: 30,        // per second
  nitroRegen: 6,         // per second (22 while drifting, like arcade spec)
  dragK: 0.9,            // N per (m/s)^2 aerodynamic drag
  rollingResist: 260,    // N constant

  // --- brakes -----------------------------------------------------------------
  brakeFront: 48,
  brakeRear: 30,         // ~60/40 bias
  handbrakeForce: 85,    // locks rears...
  handbrakeFriction: 0.35, // ...and drops rear grip -> slides

  // --- steering -----------------------------------------------------------------
  maxSteerLow: 0.55,     // rad at standstill — GTA IV has big lock
  maxSteerHigh: 0.10,    // rad at speed — stability
  steerSpeed: 7,         // rad/s smoothing — no snappy digital steer

  // --- aero -----------------------------------------------------------------------
  downforceK: 1.1,       // N per (m/s)^2, applied at CoM. ~4000N at top speed.

  // --- visual body roll/pitch (does NOT affect physics) ------------------------------
  visualRollK: 0.055,    // rad of roll per m/s^2 lateral accel
  visualPitchK: 0.045,   // rad of pitch per m/s^2 longitudinal accel
  visualTiltMax: 0.14,
  visualSmoothing: 8,    // lerp speed

  // --- drift detection ------------------------------------------------------------------
  driftSlipAngle: 0.22,  // rad rear slip angle to count as drifting
  driftMinSpeed: 10,     // m/s

  // --- solver ------------------------------------------------------------------------------
  solverIterations: 10,
};

// ---------------------------------------------------------------------------
// TUNING_TABLE — for the debug overlay and for humans.
// ---------------------------------------------------------------------------
export const TUNING_TABLE = [
  { param: 'mass', value: 1500, unit: 'kg', changes: 'Overall weight & inertia. Heavier = lazier turn-in, longer braking, more momentum feel.', range: '800 – 2200' },
  { param: 'suspensionStiffness', value: 24, unit: '', changes: 'Spring rate (scaled by mass internally). Lower = floatier, more dive/squat/roll.', range: '15 – 45' },
  { param: 'suspensionRestLength', value: 0.5, unit: 'm', changes: 'Ride height / travel. Longer = softer landing, more body motion.', range: '0.3 – 0.65' },
  { param: 'maxSuspensionTravel', value: 0.35, unit: 'm', changes: 'Bump absorption before bottoming out.', range: '0.2 – 0.55' },
  { param: 'dampingRelaxation', value: 2.8, unit: '', changes: 'Rebound damping. Lower = bouncier/floatier after bumps.', range: '1.5 – 6' },
  { param: 'dampingCompression', value: 4.5, unit: '', changes: 'Bump damping. Lower = crashier over curbs.', range: '2.5 – 8' },
  { param: 'frictionSlipFront', value: 2.4, unit: '', changes: 'Front lateral grip. Lower = understeer (pushes wide).', range: '1.2 – 4.0' },
  { param: 'frictionSlipRear', value: 2.0, unit: '', changes: 'Rear lateral grip. Lower = oversteer, easier to kick the tail out. Keep < front for GTA IV character.', range: '1.0 – 3.5' },
  { param: 'rollInfluence', value: 0.08, unit: '', changes: 'How much side force rolls the body (visual weight). Higher = more lean, tippy past ~0.12.', range: '0.01 – 0.15' },
  { param: 'engineForceMax', value: 9000, unit: 'N', changes: 'Launch force (~mass × accel). Higher = harder pull off the line.', range: '4000 – 16000' },
  { param: 'brakeFront', value: 48, unit: '', changes: 'Front stopping power.', range: '20 – 90' },
  { param: 'brakeRear', value: 30, unit: '', changes: 'Rear stopping power. Higher = more rotation under braking.', range: '15 – 60' },
  { param: 'handbrakeForce', value: 85, unit: '', changes: 'Rear lock force for handbrake slides.', range: '40 – 100' },
  { param: 'maxSteerLow', value: 0.55, unit: 'rad', changes: 'Steering lock at low speed. Higher = tighter hairpins.', range: '0.35 – 0.70' },
  { param: 'maxSteerHigh', value: 0.10, unit: 'rad', changes: 'Steering lock at speed. Higher = twitchy/darty.', range: '0.05 – 0.20' },
  { param: 'downforceK', value: 1.1, unit: 'N/(m/s)^2', changes: 'High-speed planted feel. Higher = glued at speed, duller turn-in.', range: '0 – 2.5' },
  { param: 'visualRollK', value: 0.055, unit: 'rad/(m/s^2)', changes: 'Visible body roll amount (cosmetic only).', range: '0 – 0.12' },
  { param: 'visualPitchK', value: 0.045, unit: 'rad/(m/s^2)', changes: 'Visible nose-dive/squat amount (cosmetic only).', range: '0 – 0.10' },
  { param: 'angularDamping', value: 0.4, unit: '', changes: 'Yaw calmness. Lower = more willing to rotate, spinnier.', range: '0.2 – 0.7' },
  { param: 'solverIterations', value: 10, unit: '', changes: 'Physics stability vs CPU. 8 vehicles × 10 iters still trivial.', range: '6 – 20' },
];

export const NEUTRAL_INPUT = Object.freeze({
  throttle: 0,   // -1..1 (negative = reverse)
  steer: 0,      // -1..1 (+1 = right)
  brake: false,
  handbrake: false,
  nitro: false,
});
export function makeInput() {
  return { throttle: 0, steer: 0, brake: false, handbrake: false, nitro: false };
}

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

// ---------------------------------------------------------------------------
// createVehicleWorld — gravity, SAP broadphase, modest solver iterations,
// low-friction chassis contact material.
// ---------------------------------------------------------------------------
export function createVehicleWorld(opts = {}) {
  const p = { ...GTA4_DEFAULTS, ...opts };
  const world = new World();
  world.gravity.set(0, -9.82, 0);
  world.broadphase = new SAPBroadphase(world);
  world.allowSleep = false;
  world.solver.iterations = p.solverIterations;

  const groundMat = new Material('ground');
  const chassisMat = new Material('chassis');
  world.addContactMaterial(
    new ContactMaterial(chassisMat, groundMat, { friction: 0.25, restitution: 0 })
  );
  world.defaultContactMaterial.friction = 0.3;
  return { world, groundMat, chassisMat };
}

// ---------------------------------------------------------------------------
// buildTrimeshGround — static collision from a height function (e.g. the
// track.js terrainHeight, or terrainHeight with the road ribbon baked in).
// RaycastVehicle raycasts against this. One-time cost; keep res modest.
// ---------------------------------------------------------------------------
export function buildTrimeshGround(world, heightFn, opts = {}) {
  const { minX = -300, maxX = 300, minZ = -300, maxZ = 300, step = 6 } = opts;
  const nx = Math.floor((maxX - minX) / step);
  const nz = Math.floor((maxZ - minZ) / step);
  const verts = [];
  const idx = [];
  for (let iz = 0; iz <= nz; iz++) {
    for (let ix = 0; ix <= nx; ix++) {
      const x = minX + ix * step;
      const z = minZ + iz * step;
      verts.push(x, heightFn(x, z), z);
    }
  }
  const row = nx + 1;
  for (let iz = 0; iz < nz; iz++) {
    for (let ix = 0; ix < nx; ix++) {
      const a = iz * row + ix, b = a + 1, c = a + row, d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const body = new Body({ mass: 0, material: new Material('ground') });
  body.addShape(new Trimesh(verts, idx));
  world.addBody(body);
  return body;
}

// ---------------------------------------------------------------------------
// makeGTA4Vehicle — the main export.
// ---------------------------------------------------------------------------
export function makeGTA4Vehicle(world, opts = {}) {
  const P = { ...GTA4_DEFAULTS, ...opts };
  const [hw, hh, hl] = P.halfExtents;
  const axleZ = P.wheelBase / 2;   // 1.35
  const axleX = P.trackWidth / 2;  // 0.81

  // --- chassis body ---------------------------------------------------------
  const chassisBody = new Body({
    mass: P.mass,
    angularDamping: P.angularDamping,
    linearDamping: P.linearDamping,
  });
  // Shape sits above the body origin -> center of mass effectively low.
  // (syncVisual adds the same offset to the mesh, so visuals stay correct.)
  chassisBody.addShape(new Box(new Vec3(hw, hh, hl)), new Vec3(0, P.shapeOffsetY, 0));

  const vehicle = new RaycastVehicle({
    chassisBody,
    indexRightAxis: 0,   // +X — MUST be explicit in 0.20.0 (defaults differ!)
    indexForwardAxis: 2, // +Z
    indexUpAxis: 1,      // +Y
  });

  // Connection-point Y chosen so the suspension sits at rest length on spawn:
  // worldY(conn) - restLength = wheelRadius  ->  localY = wheelRadius + restLength - spawnY
  const SPAWN_Y = 1.0;
  const connY = P.wheelRadius + P.suspensionRestLength - SPAWN_Y;

  const wheelBase = {
    radius: P.wheelRadius,
    directionLocal: new Vec3(0, -1, 0),
    axleLocal: new Vec3(-1, 0, 0),
    suspensionRestLength: P.suspensionRestLength,
    suspensionStiffness: P.suspensionStiffness,
    dampingRelaxation: P.dampingRelaxation,
    dampingCompression: P.dampingCompression,
    maxSuspensionForce: P.maxSuspensionForce,
    maxSuspensionTravel: P.maxSuspensionTravel,
    rollInfluence: P.rollInfluence,
  };
  // Order: FL, FR, RL, RR
  const defs = [
    { x: -axleX, z: axleZ, front: true, friction: P.frictionSlipFront },
    { x: axleX, z: axleZ, front: true, friction: P.frictionSlipFront },
    { x: -axleX, z: -axleZ, front: false, friction: P.frictionSlipRear },
    { x: axleX, z: -axleZ, front: false, friction: P.frictionSlipRear },
  ];
  const wheelIndex = defs.map((d) =>
    vehicle.addWheel({
      ...wheelBase,
      chassisConnectionPointLocal: new Vec3(d.x, connY, d.z),
      frictionSlip: d.friction,
      isFrontWheel: d.front,
    })
  );
  const FRONT = [wheelIndex[0], wheelIndex[1]];
  const REAR = [wheelIndex[2], wheelIndex[3]];
  vehicle.addToWorld(world);

  // --- state ------------------------------------------------------------------
  const state = {
    speed: 0,          // m/s (signed forward)
    speedKmh: 0,
    slipAngle: 0,      // rad, rear slip angle
    drifting: false,
    latG: 0,
    longG: 0,
    wheelsOnGround: 0,
    nitro: 100,
    nitroActive: false,
    airborne: false,
  };

  const api = {
    vehicle,
    chassisBody,
    params: P,
    state,
    input: makeInput(),
    onDriftStart: null,
    onDriftEnd: null,
    _visual: null,       // { group, tilt, wheels[] }
    _prevVel: new Vec3(),
    _steerCur: 0,
    _tiltRoll: 0,
    _tiltPitch: 0,
    _hbWasDown: false,
  };

  const _fwd = new Vec3();
  const _right = new Vec3();
  const _down = new Vec3();

  function chassisBasis() {
    // forward = +Z rotated by chassis quaternion; right = +X rotated
    chassisBody.quaternion.vmult(new Vec3(0, 0, 1), _fwd);
    chassisBody.quaternion.vmult(new Vec3(1, 0, 0), _right);
  }

  // --- per-step input application (call BEFORE world.step) -----------------------
  api.applyInput = function (input, dt) {
    chassisBasis();
    const v = chassisBody.velocity;
    const vF = v.dot(_fwd);          // signed forward speed
    const vL = v.dot(_right);        // lateral speed (+ = sliding left)
    const speed = Math.abs(vF);

    // --- steering: speed-sensitive, smoothed --------------------------------------
    const steerMax = lerp(P.maxSteerLow, P.maxSteerHigh, clamp(speed / 55, 0, 1));
    const steerTarget = STEER_SIGN * clamp(input.steer, -1, 1) * steerMax;
    const sStep = P.steerSpeed * dt;
    api._steerCur += clamp(steerTarget - api._steerCur, -sStep, sStep);
    for (const i of FRONT) vehicle.setSteeringValue(api._steerCur, i);

    // --- handbrake state ------------------------------------------------------------
    const hb = !!input.handbrake;
    if (hb !== api._hbWasDown) {
      for (const i of REAR) {
        vehicle.wheelInfos[i].frictionSlip = hb ? P.handbrakeFriction : P.frictionSlipRear;
      }
      api._hbWasDown = hb;
    }

    // --- engine / brake ---------------------------------------------------------------
    const nitroOn = !!input.nitro && state.nitro > 1 && vF > 1 && !hb;
    state.nitroActive = nitroOn;
    if (nitroOn) state.nitro = Math.max(0, state.nitro - P.nitroDrain * dt);
    else state.nitro = Math.min(100, state.nitro + (state.drifting ? 22 : P.nitroRegen) * dt);

    let enginePerWheel = 0;
    const reversing = !!input.brake && vF < 1.5 && input.throttle <= 0;
    if (!hb) {
      if (reversing) {
        // reverse: brake key at low speed backs up (no brake torque, engine flipped)
        const f = P.engineForceMax * P.reverseMax;
        enginePerWheel = (-ENGINE_SIGN * f) / 2; // opposite of forward -> reverse
        for (const i of FRONT) vehicle.setBrake(0, i);
        for (const i of REAR) vehicle.setBrake(0, i);
        for (const i of REAR) vehicle.applyEngineForce(enginePerWheel, i);
        for (const i of FRONT) vehicle.applyEngineForce(0, i);
      } else {
        const taper = clamp(1 - speed / P.topSpeed, 0, 1);
        let f = P.engineForceMax * clamp(input.throttle, 0, 1) * taper;
        if (nitroOn) f *= P.nitroMultiplier;
        // drag + rolling resistance (applied as opposing engine force)
        if (vF !== 0) f -= P.dragK * vF * Math.abs(vF) + P.rollingResist * Math.sign(vF);
        enginePerWheel = (ENGINE_SIGN * f) / 2; // RWD: split over 2 rear wheels
        for (const i of FRONT) vehicle.setBrake(input.brake ? P.brakeFront : 0, i);
        for (const i of REAR) vehicle.setBrake(input.brake ? P.brakeRear : 0, i);
        for (const i of REAR) vehicle.applyEngineForce(enginePerWheel, i);
        for (const i of FRONT) vehicle.applyEngineForce(0, i);
      }
    } else {
      // handbrake: no drive, rears locked (friction already dropped above)
      for (const i of REAR) vehicle.setBrake(P.handbrakeForce, i);
      for (const i of FRONT) vehicle.setBrake(0, i);
      for (const i of REAR) vehicle.applyEngineForce(0, i);
      for (const i of FRONT) vehicle.applyEngineForce(0, i);
    }

    // --- downforce ----------------------------------------------------------------------
    _down.set(0, -P.downforceK * vF * vF, 0);
    chassisBody.applyForce(_down); // at CoM (default relativePoint = 0)

    // --- telemetry ------------------------------------------------------------------------
    const accel = (vF - (api._prevF ?? 0)) / dt;
    const latAccel = (vL - (api._prevL ?? 0)) / dt;
    api._prevF = vF;
    api._prevL = vL;
    state.speed = vF;
    state.speedKmh = Math.abs(vF) * 3.6;
    state.longG = accel / 9.82;
    state.latG = latAccel / 9.82;
    state.slipAngle = Math.atan2(vL, Math.abs(vF) + 1e-4);
    state.wheelsOnGround = vehicle.numWheelsOnGround;
    state.airborne = vehicle.numWheelsOnGround === 0;

    const wasDrifting = state.drifting;
    state.drifting =
      Math.abs(state.slipAngle) > P.driftSlipAngle && speed > P.driftMinSpeed;
    if (state.drifting && !wasDrifting && api.onDriftStart) api.onDriftStart(state);
    if (!state.drifting && wasDrifting && api.onDriftEnd) api.onDriftEnd(state);
  };

  // --- spawn / reset -------------------------------------------------------------------------
  api.setPosition = function (x, y, z, heading) {
    chassisBody.position.set(x, y, z);
    chassisBody.quaternion.setFromEuler(0, heading, 0);
    chassisBody.velocity.setZero();
    chassisBody.angularVelocity.setZero();
    chassisBody.previousPosition.copy(chassisBody.position);
    chassisBody.previousQuaternion.copy(chassisBody.quaternion);
    api._prevVel.set(0, 0, 0);
    api._prevF = 0;
    api._prevL = 0;
    api._steerCur = 0;
    state.nitro = 100;
    state.drifting = false;
  };
  api.reset = api.setPosition;

  // --- visual attach ------------------------------------------------------------------------------
  // group: THREE.Group synced to the physics body (position + quaternion).
  // tilt:  THREE.Group child of group — gets extra roll/pitch (body roll!).
  //        Put the car mesh inside tilt with position.y = shapeOffsetY.
  // wheels: array of 4 THREE.Object3D in FL, FR, RL, RR order.
  api.attachVisual = function ({ group, tilt, wheels }) {
    api._visual = { group, tilt: tilt || null, wheels: wheels || [] };
  };

  api.syncVisual = function (dt) {
    const viz = api._visual;
    if (!viz) return;
    const p = chassisBody.position;
    const q = chassisBody.quaternion;
    viz.group.position.set(p.x, p.y, p.z);
    viz.group.quaternion.set(q.x, q.y, q.z, q.w);

    // body roll / pitch from smoothed accel, applied to the tilt node only
    if (viz.tilt) {
      // lateral accel +X (left) pushes body to -X -> roll; longitudinal accel
      // forward (+Z) pitches nose up (squat), braking pitches nose down (dive)
      const targetRoll = clamp(-(state.latG * 9.82) * P.visualRollK, -P.visualTiltMax, P.visualTiltMax);
      const targetPitch = clamp((state.longG * 9.82) * P.visualPitchK, -P.visualTiltMax, P.visualTiltMax);
      const k = Math.min(1, dt * P.visualSmoothing);
      api._tiltRoll += (targetRoll - api._tiltRoll) * k;
      api._tiltPitch += (targetPitch - api._tiltPitch) * k;
      viz.tilt.rotation.z = api._tiltRoll;
      viz.tilt.rotation.x = api._tiltPitch;
    }

    // wheels: copy cannon wheel world transforms (includes steering + spin)
    for (let i = 0; i < viz.wheels.length && i < 4; i++) {
      const wt = vehicle.wheelInfos[wheelIndex[i]].worldTransform;
      viz.wheels[i].position.set(wt.position.x, wt.position.y, wt.position.z);
      viz.wheels[i].quaternion.set(wt.quaternion.x, wt.quaternion.y, wt.quaternion.z, wt.quaternion.w);
    }
  };

  // --- live tuning -----------------------------------------------------------------------------------
  // Wheel params propagate straight into the live WheelInfo objects.
  api.tune = function (param, value) {
    P[param] = value;
    const wi = vehicle.wheelInfos;
    const setWheels = (ids, key, val) => ids.forEach((i) => (wi[i][key] = val));
    switch (param) {
      case 'suspensionStiffness':
        setWheels([0, 1, 2, 3], 'suspensionStiffness', value);
        break;
      case 'dampingRelaxation':
        setWheels([0, 1, 2, 3], 'dampingRelaxation', value);
        break;
      case 'dampingCompression':
        setWheels([0, 1, 2, 3], 'dampingCompression', value);
        break;
      case 'frictionSlipFront':
        setWheels(FRONT, 'frictionSlip', value);
        break;
      case 'frictionSlipRear':
        if (!api._hbWasDown) setWheels(REAR, 'frictionSlip', value);
        break;
      case 'rollInfluence':
        setWheels([0, 1, 2, 3], 'rollInfluence', value);
        break;
      case 'angularDamping':
        chassisBody.angularDamping = value;
        break;
      case 'solverIterations':
        if (world.solver) world.solver.iterations = value;
        break;
      // mass, geometry, engine/brake/steer/aero/visual params are read live from P
      default:
        break;
    }
  };

  return api;
}

// ---------------------------------------------------------------------------
// createTuningOverlay — debug panel: sliders for the key GTA IV knobs +
// live telemetry (speed, slip angle, g's, drift lamp, nitro bar).
// Sliders call api.tune() live. No dependencies; plain DOM.
// ---------------------------------------------------------------------------
export function createTuningOverlay(api, container) {
  const P = api.params;
  const el = document.createElement('div');
  el.id = 'gta4-tuner';
  el.style.cssText =
    'position:fixed;top:8px;left:8px;z-index:9999;background:rgba(8,12,20,.85);' +
    'border:1px solid rgba(120,200,255,.35);border-radius:10px;color:#fff;' +
    'font:12px/1.5 monospace;padding:10px 12px;width:230px;user-select:none;';

  const rows = [
    ['suspensionStiffness', 15, 45, 1],
    ['dampingRelaxation', 1.5, 6, 0.1],
    ['dampingCompression', 2.5, 8, 0.1],
    ['frictionSlipFront', 1.2, 4.0, 0.1],
    ['frictionSlipRear', 1.0, 3.5, 0.1],
    ['rollInfluence', 0.01, 0.15, 0.005],
    ['engineForceMax', 4000, 16000, 250],
    ['maxSteerLow', 0.35, 0.7, 0.01],
    ['visualRollK', 0, 0.12, 0.005],
  ];

  let html = '<div style="font-weight:700;letter-spacing:1px;margin-bottom:6px">GTA-IV TUNER</div>';
  for (const [key, min, max, step] of rows) {
    html +=
      `<label style="display:block;margin:4px 0"><span style="color:#9fd8ff">${key}</span> ` +
      `<b id="tv-${key}" style="float:right">${P[key]}</b><br>` +
      `<input type="range" data-k="${key}" min="${min}" max="${max}" step="${step}" ` +
      `value="${P[key]}" style="width:100%"></label>`;
  }
  html +=
    '<div id="tuner-tele" style="margin-top:8px;border-top:1px solid rgba(120,200,255,.25);padding-top:6px"></div>';
  el.innerHTML = html;
  (container || document.body).appendChild(el);

  el.querySelectorAll('input[type=range]').forEach((inp) => {
    inp.addEventListener('input', () => {
      const k = inp.dataset.k;
      const v = parseFloat(inp.value);
      api.tune(k, v);
      el.querySelector(`#tv-${CSS.escape(k)}`).textContent = v;
    });
  });

  const tele = el.querySelector('#tuner-tele');
  let raf = 0;
  let alive = true;
  function tick() {
    if (!alive) return;
    const s = api.state;
    tele.innerHTML =
      `SPD <b>${s.speedKmh.toFixed(0)}</b> km/h &nbsp; ` +
      `SLIP <b>${(s.slipAngle * 57.3).toFixed(1)}°</b><br>` +
      `LAT <b>${s.latG.toFixed(2)}</b>g LNG <b>${s.longG.toFixed(2)}</b>g<br>` +
      `DRIFT <b style="color:${s.drifting ? '#ff5a5a' : '#7d94ad'}">${s.drifting ? '● YES' : '○ no'}</b> ` +
      `GRND <b>${s.wheelsOnGround}/4</b><br>` +
      `N2O <span style="display:inline-block;width:90px;height:8px;background:#223">` +
      `<span style="display:block;height:100%;width:${s.nitro.toFixed(0)}%;background:#37c6ff"></span></span>`;
    raf = requestAnimationFrame(tick);
  }
  tick();

  return {
    el,
    update() { /* telemetry runs on its own rAF */ },
    destroy() {
      alive = false;
      cancelAnimationFrame(raf);
      el.remove();
    },
  };
}

// ---------------------------------------------------------------------------
// Wiring sketch for the builder (paste into the game loop):
//
//   import { World } from 'cannon-es';
//   import { createVehicleWorld, buildTrimeshGround, makeGTA4Vehicle, makeInput } from './gta4-tuning.js';
//   import { trackFrameAt, terrainHeight } from './track.js';
//
//   const { world } = createVehicleWorld();
//   buildTrimeshGround(world, (x, z) => terrainHeight(x, z),
//     { minX: -320, maxX: 320, minZ: -320, maxZ: 320, step: 5 });
//
//   const player = makeGTA4Vehicle(world);
//   const f0 = trackFrameAt(0);
//   player.setPosition(f0.pos.x - f0.tan.x * 12, f0.pos.y + 1.0, f0.pos.z - f0.tan.z * 12,
//                      Math.atan2(f0.tan.x, f0.tan.z));
//   player.attachVisual({ group: carGroup, tilt: tiltNode, wheels: wheelMeshes });
//   player.onDriftStart = () => { Sfx.skid(0.8); showSmoke(true); };
//   player.onDriftEnd   = () => { Sfx.skid(0); showSmoke(false); };
//
//   const input = makeInput(); // feed from keyboard/touch each step
//   const STEP = 1/60; let acc = 0, last = performance.now();
//   function frame(now) {
//     requestAnimationFrame(frame);
//     acc += Math.min((now - last) / 1000, 0.25); last = now;
//     let n = 0;
//     while (acc >= STEP && n < 5) {
//       pollControls(input);            // keyboard/touch -> input
//       player.applyInput(input, STEP);
//       // ...aiCars.forEach(c => c.applyInput(c.aiInput, STEP));
//       world.step(STEP);
//       acc -= STEP; n++;
//     }
//     if (n === 5) acc = 0;
//     player.syncVisual(Math.min(0.05, (now - last) / 1000));
//     // HUD: player.state.speedKmh, .slipAngle, .drifting, .nitro, .latG/.longG
//   }
//
// AI note: give each AI its own makeGTA4Vehicle (8 cars x 4 raycasts is trivial
// for the solver) OR keep the arcade physics for AI and only the player on
// cannon-es. Keep AI inputs in the same {throttle, steer, brake} shape.
// ---------------------------------------------------------------------------
