import * as THREE from 'three';
import { buildWorld } from './world.js';
import { Car } from './car.js';
import { createVehicle, DEFAULT_CAR_CONFIG } from './physics.js';
import { RivalField } from './rivals.js';
import { ChaseCamera } from './camera.js';
import { initEffects } from './effects.js';
import QualityGovernor from './quality.js';
import UI from './ui.js';
import AudioAdapter from './audio-adapter.js';

const FIXED = 1 / 120, MAX_SUB = 5, TOTAL_LAPS = 3, GRID = 8;
const RIVAL_MODELS = ['assets/cars/rival-a.glb', 'assets/cars/rival-b.glb'];
const RIVAL_NAMES = ['Vega', 'Kovac', 'Reyes', 'Okafor', 'Lindqvist', 'Moreau', 'Tanaka'];
const RIVAL_PAINTS = [0xd94f3d, 0xe8b23a, 0x3fae6a, 0xb44fd9, 0x2fb6c9, 0xe07a2f, 0xf0f0f0];

const input = { steer: 0, throttle: 0, brake: 0, nitro: false };
const keys = Object.create(null);
let touchSteer = 0, touchThrottle = false, touchBrake = false, touchNitro = false;

let renderer, scene, camera, track, sunLight, setPropDensity, effects, governor, audio;
let player, rivals, chase, ui = null;
let state = 'loading', raceTime = 0, acc = 0, last = 0, hudTimer = 0, standings = [], wasCrashed = false;
const playerPos = new THREE.Vector3(), playerQuat = new THREE.Quaternion();
const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

/* ---------- helpers ---------- */
function makeCar(path, color) {
  return new Car(path, color);
}
function carObject(car) { return car && (car.group || car.object3D || car.mesh || car.root || car); }
function vehState(veh) { return veh ? (veh.state || veh) : null; }
function vehPos(veh) {
  const s = vehState(veh); if (!s) return null;
  return s.position || (veh.body && veh.body.position) || null;
}
function vehQuat(veh) {
  const s = vehState(veh); if (!s) return null;
  return s.quaternion || (veh.body && veh.body.quaternion) || null;
}
function speedOf(veh) {
  const s = vehState(veh); if (!s) return 0;
  if (typeof s.forwardSpeed === 'number') return s.forwardSpeed;
  if (typeof s.speed === 'number') return Math.abs(s.speed);
  const b = veh.body; if (b && b.velocity) return b.velocity.length();
  return 0;
}
function progressOf(veh) {
  const s = vehState(veh); if (!s) return 0;
  const d = (typeof s.distanceAlong === 'number') ? s.distanceAlong : (typeof s.progress === 'number' ? s.progress : 0);
  return (s.lap || 0) * ((track && track.length) || 1000) + d;
}
function syncCar(car, veh) {
  if (!car || !veh) return;
  const s = vehState(veh);
  if (car.setState) { try { car.setState(s); return; } catch (e) { /* fall through */ } }
  const o = carObject(car), p = vehPos(veh), q = vehQuat(veh);
  if (o && o.position && p) { o.position.copy(p); if (q && o.quaternion) o.quaternion.copy(q); }
}
/* Grid slots: 2 columns x 4 rows behind the start line. Player (i=7) starts last.
   Uses track.startPose {position, heading} with the internal-compass convention
   forward=(-sin h, 0, -cos h), right=(cos h, 0, -sin h). */
function gridSpot(i) {
  const sp = track.startPose;
  const yaw = sp.heading;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  const rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const row = Math.floor(i / 2), col = i % 2;
  const lat = col === 0 ? -2.2 : 2.2;
  const back = (3 - row) * 7 + 4;
  return {
    position: {
      x: sp.position.x - fx * back + rx * lat,
      y: sp.position.y,
      z: sp.position.z - fz * back + rz * lat
    },
    heading: yaw,
    s: 0
  };
}
function placeOnGrid(car, veh, spot) {
  if (veh && veh.reset) {
    try { veh.reset({ position: spot.position, heading: spot.heading }); } catch (e) { /* ignore */ }
  }
  if (car && veh && car.setState) {
    try { car.setState(veh.state || veh, 0); } catch (e) { /* ignore */ }
  }
}

/* ---------- input ---------- */
function updateInput(dt) {
  let t = 0;
  if (keys.ArrowLeft || keys.KeyA) t -= 1;
  if (keys.ArrowRight || keys.KeyD) t += 1;
  t += touchSteer;
  t = Math.max(-1, Math.min(1, t));
  const md = 6 * dt;
  input.steer += Math.max(-md, Math.min(md, t - input.steer));
  input.throttle = (keys.ArrowUp || keys.KeyW || touchThrottle) ? 1 : 0;
  input.brake = (keys.ArrowDown || keys.KeyS || touchBrake) ? 1 : 0;
  input.nitro = !!(keys.ShiftLeft || keys.KeyN || touchNitro);
}
function initKeyboard() {
  addEventListener('keydown', e => {
    keys[e.code] = true;
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  });
  addEventListener('keyup', e => { keys[e.code] = false; });
  addEventListener('blur', () => { for (const k in keys) keys[k] = false; });
}
function initTouch() {
  if (!('ontouchstart' in window)) return;
  const base = {
    position: 'fixed', zIndex: 30, background: 'rgba(255,255,255,.12)',
    border: '1px solid rgba(255,255,255,.35)', borderRadius: '50%',
    touchAction: 'none', userSelect: 'none', WebkitUserSelect: 'none'
  };
  const mk = (css, down, up) => {
    const d = document.createElement('div');
    Object.assign(d.style, base, css);
    d.addEventListener('touchstart', e => { e.preventDefault(); down(); }, { passive: false });
    d.addEventListener('touchend', e => { e.preventDefault(); up(); }, { passive: false });
    d.addEventListener('touchcancel', up);
    document.body.appendChild(d);
    return d;
  };
  mk({ left: '12px', bottom: '18px', width: '90px', height: '90px' }, () => touchSteer = -1, () => touchSteer = 0);
  mk({ left: '118px', bottom: '18px', width: '90px', height: '90px' }, () => touchSteer = 1, () => touchSteer = 0);
  mk({ right: '12px', bottom: '18px', width: '90px', height: '90px' }, () => touchThrottle = true, () => touchThrottle = false);
  mk({ right: '118px', bottom: '18px', width: '90px', height: '90px' }, () => touchBrake = true, () => touchBrake = false);
  mk({ right: '12px', bottom: '120px', width: '70px', height: '70px' }, () => touchNitro = true, () => touchNitro = false);
}

/* ---------- race logic ---------- */
function finalTimeOf(v) {
  const st = v && (v.state || v);
  return (st && st.finished && st.finalTime != null) ? st.finalTime : null;
}
function computeStandings() {
  const list = [{ name: 'YOU', isPlayer: true, totalTime: finalTimeOf(player && player.vehicle), progress: progressOf(player && player.vehicle) }];
  const cars = (rivals && rivals.cars) || [];
  for (let i = 0; i < cars.length; i++) {
    const c = cars[i];
    list.push({
      name: c.name || RIVAL_NAMES[i] || ('RIVAL ' + (i + 1)),
      isPlayer: false,
      totalTime: finalTimeOf(c.vehicle || c),
      progress: progressOf(c.vehicle || c)
    });
  }
  list.sort((a, b) => {
    const af = a.totalTime != null, bf = b.totalTime != null;
    if (af && bf) return a.totalTime - b.totalTime;
    if (af) return -1;
    if (bf) return 1;
    return b.progress - a.progress;
  });
  standings = list;
  return list;
}
function playerPosition() {
  if (!standings.length) computeStandings();
  for (let i = 0; i < standings.length; i++) if (standings[i].isPlayer) return i + 1;
  return standings.length || 1;
}
function resetGrid() {
  const spots = [];
  for (let i = 0; i < GRID; i++) spots.push(gridSpot(i));
  try { if (rivals && rivals.reset) rivals.reset(spots.slice(0, GRID - 1)); } catch (e) { /* ignore */ }
  placeOnGrid(player && player.car, player && player.vehicle, spots[GRID - 1]);
  raceTime = 0; acc = 0; hudTimer = 0;
  const st = player && player.vehicle && (player.vehicle.state || player.vehicle);
  if (st && chase && chase.snap) { try { chase.snap(st); } catch (e) { /* ignore */ } }
}
async function startRace() {
  resetGrid();
  state = 'countdown';
  try { if (ui.countdown) await ui.countdown(); } catch (e) { /* ignore */ }
  raceTime = 0; acc = 0; last = performance.now();
  state = 'racing';
}
function finishRace() {
  if (state === 'finished') return;
  state = 'finished';
  computeStandings();
  try { if (ui.showResults) ui.showResults(standings, restart); } catch (e) { /* ignore */ }
}
function restart() {
  state = 'menu';
  resetGrid();
  try { if (ui.showMenu) ui.showMenu(startRace); } catch (e) { /* ignore */ }
}

/* ---------- simulation ---------- */
function step(dt) {
  updateInput(dt);
  const v = player && player.vehicle;
  if (v) {
    try {
      if (v.setInput) v.setInput(input);
      else v.input = input;
      if (v.step) v.step(dt, input);
    } catch (e) { /* ignore */ }
  }
  if (rivals && rivals.update) { try { rivals.update(dt, v && (v.state || v)); } catch (e) { /* ignore */ } }
  raceTime += dt;
  const s = vehState(v);
  if (s && s.finished) finishRace();
}

/* ---------- render ---------- */
function render(dt) {
  const v = player && player.vehicle;
  const st = v && (v.state || v);
  syncCar(player && player.car, v);
  const p = st && st.position;
  if (p) playerPos.set(p.x, p.y, p.z);

  if (chase && chase.update && st) { try { chase.update(dt, st); } catch (e) { /* ignore */ } }

  const all = [playerPos];
  const cars = (rivals && rivals.cars) || [];
  for (let i = 0; i < cars.length; i++) {
    const cp = carPos(cars[i]);
    if (cp) all.push(cp);
  }
  if (effects) {
    if (effects.update) { try { effects.update(dt, playerPos, all); } catch (e) { /* ignore */ } }
    if (effects.setSpeedFactor) { try { effects.setSpeedFactor(Math.min(1, Math.abs(speedOf(v)) / 70)); } catch (e) { /* ignore */ } }
  }
  if (governor && governor.update) { try { governor.update(dt); } catch (e) { /* ignore */ } }

  hudTimer += dt;
  if (hudTimer >= 1) { hudTimer = 0; computeStandings(); }

  const s = st || {};
  if (ui.updateHUD) {
    try {
      ui.updateHUD({
        lap: s.lap || 1,
        totalLaps: TOTAL_LAPS,
        checkpoint: (s.checkpointIndex || 0) + 1,
        totalCheckpoints: 4,
        raceTime: raceTime,
        position: playerPosition(),
        totalRacers: GRID,
        forwardSpeed: s.forwardSpeed || 0,
        nitro: s.nitroAmount || 0
      });
    } catch (e) { /* ignore */ }
  }
  if (audio && audio.setState) {
    try {
      audio.setState({
        rpm: s.rpm || 0, throttle: input.throttle, brake: input.brake,
        slip: s.slipAngle || 0, gear: s.gear || 1, speed: Math.abs(speedOf(v)),
        nitro: s.nitroActive || false
      });
      if (s.crashed && !wasCrashed && audio.playCrash) {
        audio.playCrash(s.crashIntensity != null ? s.crashIntensity : 0.6);
      }
      wasCrashed = !!s.crashed;
    } catch (e) { /* ignore */ }
  }
  if (effects && effects.render) { try { effects.render(camera); } catch (e) { renderer.render(scene, camera); } }
  else renderer.render(scene, camera);
}
function carPos(c) {
  if (!c) return null;
  const v = c.vehicle || c;
  const s = (v && v.state) || v || {};
  return s.position || null;
}

/* ---------- loop ---------- */
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000;
  last = now;
  if (!isFinite(dt) || dt < 0) dt = 0;
  dt = Math.min(dt, 0.1);

  if (!document.hidden && state === 'racing') {
    acc += dt;
    let n = 0;
    while (acc >= FIXED && n < MAX_SUB && state === 'racing') { step(FIXED); acc -= FIXED; n++; }
    if (acc > FIXED * MAX_SUB) acc = 0;
  } else {
    acc = 0;
  }
  render(dt);
}

/* ---------- boot ---------- */
async function boot() {
  renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  (document.getElementById('app') || document.body).appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x6b4a3a, 0.0016);
  camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.3, 4000);
  camera.position.set(0, 6, -12);

  if (ui.showLoading) ui.showLoading(0, 'Loading…');
  audio = new AudioAdapter();
  try { await audio.init(); } catch (e) { /* silent stub is fine */ }
  ui = new UI(audio);

  const onProgress = (p, msg) => {
    if (!ui.showLoading) return;
    const pct = typeof p === 'number' ? Math.round((p <= 1 ? p * 100 : p)) + '%' : '';
    ui.showLoading(p, msg || ('Loading ' + pct));
  };

  const world = await buildWorld(scene, 'high', onProgress);
  track = world.track;
  sunLight = world.sunLight;
  setPropDensity = world.setPropDensity;

  effects = initEffects(scene, renderer, sunLight, { skyPath: 'assets/env/sky-sunset.jpg' });

  governor = new QualityGovernor(renderer, {
    setShadow: (size, frustum) => {
      if (!sunLight || !sunLight.shadow) return;
      sunLight.shadow.mapSize.set(size, size);
      const cam = sunLight.shadow.camera;
      cam.left = -frustum; cam.right = frustum; cam.top = frustum; cam.bottom = -frustum;
      cam.updateProjectionMatrix();
      if (sunLight.shadow.map) { sunLight.shadow.map.dispose(); sunLight.shadow.map = null; }
    },
    setEffectsTier: t => { if (effects && effects.setQualityTier) effects.setQualityTier(t); },
    setPropDensity: d => { if (setPropDensity) setPropDensity(d); }
  });

  player = { car: makeCar('assets/cars/player.glb', 0x2a4d8f), vehicle: null };
  try { player.vehicle = createVehicle(DEFAULT_CAR_CONFIG, track); } catch (e) { player.vehicle = null; }
  try { await player.car.load(); } catch (e) { console.warn('player car failed to load', e); }
  const pg = carObject(player.car);
  if (pg && !pg.parent && pg.isObject3D) scene.add(pg);

  try {
    rivals = new RivalField(scene, track, RIVAL_MODELS, RIVAL_NAMES);
    await rivals.load(RIVAL_PAINTS);
  } catch (e) {
    console.warn('rivals failed', e);
    rivals = { cars: [], update() {}, reset() {} };
  }

  try { chase = new ChaseCamera(camera); } catch (e) { chase = null; }

  initKeyboard();
  initTouch();
  resetGrid();

  if (ui.showMenu) ui.showMenu(startRace);

  last = performance.now();
  requestAnimationFrame(frame);
}

/* ---------- globals ---------- */
addEventListener('resize', () => {
  if (!renderer) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (effects && effects.resize) { try { effects.resize(window.innerWidth, window.innerHeight); } catch (e) { /* ignore */ } }
});
addEventListener('error', e => { if (ui.showError) ui.showError((e && e.message) || 'Unknown error'); });
addEventListener('unhandledrejection', e => {
  if (ui.showError) ui.showError((e && e.reason && e.reason.message) || 'Unhandled rejection');
});

export { boot, input, startRace, restart };
