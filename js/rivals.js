import { createVehicle, DEFAULT_CAR_CONFIG } from './physics.js';
import { Car } from './car.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const wrapAngle = a => { a = (a + Math.PI) % (2 * Math.PI); if (a < 0) a += 2 * Math.PI; return a - Math.PI; };
const sgn = v => (v < 0 ? -1 : 1);

export class RivalField {
  constructor(scene, track, modelPaths, names) {
    this.scene = scene;
    this.track = track;
    this.modelPaths = modelPaths || [];
    this.names = names || [];
    this.entrants = [];
    this._lineStep = 5;
    this.racingLine = null;
    this._lineLen = 0;
    this._lineN = 0;
    for (let i = 0; i < 7; i++) {
      const aggr = 0.7 + 0.05 * i; // 0.70 .. 1.00
      this.entrants.push({
        index: i,
        name: this.names[i] || ('Rival ' + (i + 1)),
        car: null,
        vehicle: null,
        aggression: aggr,
        lateralOffset: (i - 3) * 0.5, // -1.5 .. 1.5
        topSpeed: (DEFAULT_CAR_CONFIG.maxSpeed || 70) * (0.9 + 0.1 * aggr),
        targetLateral: 0,
        rubberband: 1,
        s: 0,
        finished: false,
        finishTime: 0
      });
    }
  }

  async load(paintColors) {
    const n = this.modelPaths.length || 1;
    for (const e of this.entrants) {
      const path = this.modelPaths[e.index % n];
      const car = new Car(path, paintColors ? paintColors[e.index] : null);
      await car.load();
      if (car.addTo) car.addTo(this.scene);
      else if (car.object3D) this.scene.add(car.object3D);
      e.car = car;
      e.vehicle = createVehicle(DEFAULT_CAR_CONFIG, this.track);
    }
    this._buildRacingLine();
  }

  _trackLength() {
    const t = this.track;
    return t.length || t.trackLength || t.totalLength || 1000;
  }

  _rawPoint(s) {
    const t = this.track;
    const f = t.pointAt || t.sample || t.getPointAt;
    return f.call(t, s);
  }

  _sample(s) {
    const L = this._trackLength();
    s = ((s % L) + L) % L;
    const p = this._rawPoint(s);
    const pos = p.position || p.pos || p;
    let tan = p.tangent || p.dir;
    if (!tan) {
      const q = this._rawPoint((s + 1) % L);
      const qp = q.position || q.pos || q;
      tan = { x: qp.x - pos.x, z: qp.z - pos.z };
    }
    const len = Math.hypot(tan.x, tan.z) || 1;
    return { x: pos.x, y: pos.y || 0, z: pos.z, tx: tan.x / len, tz: tan.z / len };
  }

  _curvature(s) {
    const a = this._sample(s);
    const b = this._sample(s + 40);
    const t1 = Math.atan2(-a.tx, -a.tz);
    const t2 = Math.atan2(-b.tx, -b.tz);
    return wrapAngle(t2 - t1) / 40;
  }

  _buildRacingLine() {
    const L = this._trackLength();
    const n = Math.max(8, Math.ceil(L / this._lineStep));
    const line = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const c = this._curvature(i * this._lineStep);
      line[i] = Math.abs(c) > 0.006 ? -sgn(c) * 1.2 : 0;
    }
    this.racingLine = line;
    this._lineLen = L;
    this._lineN = n;
  }

  racingLineAt(s) {
    if (!this.racingLine) return 0;
    const L = this._lineLen, n = this._lineN;
    const u = (((s % L) + L) % L) / this._lineStep;
    const i0 = Math.floor(u) % n;
    const i1 = (i0 + 1) % n;
    const f = u - Math.floor(u);
    return this.racingLine[i0] * (1 - f) + this.racingLine[i1] * f;
  }

  get cars() { return this.entrants; }

  reset(gridSpots) {
    for (const e of this.entrants) {
      const g = gridSpots[e.index] || gridSpots[gridSpots.length - 1];
      if (!g) continue;
      e.s = g.s || 0;
      e.targetLateral = 0;
      e.rubberband = 1;
      e.finished = false;
      e.finishTime = 0;
      if (e.vehicle) {
        e.vehicle.reset({
          position: { x: g.position.x, y: g.position.y || 0, z: g.position.z },
          heading: g.heading
        });
        if (e.car && e.car.setState) e.car.setState(e.vehicle.state, 0);
      }
    }
  }

  _others(e, ps) {
    const out = [];
    for (const o of this.entrants) {
      if (o === e || !o.vehicle) continue;
      const p = o.vehicle.state && o.vehicle.state.position;
      if (p) out.push(p);
    }
    if (ps && ps.position) out.push(ps.position);
    return out;
  }

  update(dt, playerState) {
    const ps = playerState || {};
    const pd = ps.distanceAlong !== undefined ? ps.distanceAlong : 0;
    for (const e of this.entrants) {
      const v = e.vehicle;
      if (!v) continue;
      const st = v.state;
      const pos = st.position;
      const heading = st.heading;
      const fwd = st.forwardSpeed !== undefined ? st.forwardSpeed : (st.speed || 0);
      const s = st.distanceAlong !== undefined ? st.distanceAlong : e.s;
      e.s = s;

      const fx = -Math.sin(heading), fz = -Math.cos(heading);
      const rxv = Math.cos(heading), rzv = -Math.sin(heading);

      // --- racing line + per-driver offset + overtake/avoidance ---
      let lat = this.racingLineAt(s) + e.lateralOffset;
      let avoidSteer = 0, lift = 1;
      for (const o of this._others(e, ps)) {
        const dxo = o.x - pos.x, dzo = o.z - pos.z;
        const fd = dxo * fx + dzo * fz;
        const ld = dxo * rxv + dzo * rzv;
        if (fd > 0 && fd < 12 && Math.abs(ld) < 2.5) {
          lat += ld > 0 ? -2.0 : 2.0; // overtake on the free side
          if (fd < 8 && Math.abs(ld) < 2) {
            avoidSteer += 0.25 * sgn(ld); // steer away from car in same lane
            lift = 0.85;
          }
        }
      }
      e.targetLateral = lat;

      // --- pure pursuit ---
      const look = 6 + fwd * 0.55;
      const tp = this._sample(s + look);
      const th = Math.atan2(-tp.tx, -tp.tz);
      const rx = Math.cos(th), rz = -Math.sin(th);
      const tx = tp.x + rx * lat, tz = tp.z + rz * lat;
      const desired = Math.atan2(-(tx - pos.x), -(tz - pos.z));
      const diff = wrapAngle(desired - heading);
      let steer = clamp(diff * 2.2 * e.aggression, -1, 1);

      // lane offset correction (lateral error vs. current track frame)
      const cur = this._sample(s);
      const cth = Math.atan2(-cur.tx, -cur.tz);
      const crx = Math.cos(cth), crz = -Math.sin(cth);
      const curLat = (pos.x - cur.x) * crx + (pos.z - cur.z) * crz;
      steer = clamp(steer + clamp((lat - curLat) * 0.08, -0.35, 0.35) + avoidSteer, -1, 1);

      // --- speed control ---
      const curv = Math.abs(this._curvature(s + look * 0.5));
      const latAccelMax = 22;
      let targetSpeed = Math.min(e.topSpeed, Math.sqrt(latAccelMax / Math.max(curv, 1e-4)));
      targetSpeed *= 0.95 + 0.07 * e.aggression;

      // --- rubber band (input-side only) ---
      let boost = 1;
      if (s < pd - 150) { targetSpeed *= 1.04; boost = 1.05; }
      else if (s > pd + 150) { targetSpeed *= 0.97; }
      e.rubberband = boost;

      let throttle = clamp((targetSpeed - fwd) * 0.15, 0, 1) * boost * lift;
      throttle = clamp(throttle, 0, 1);
      let brake = 0;
      if (targetSpeed < fwd - 4) brake = clamp((fwd - targetSpeed) * 0.08, 0, 1);

      // --- nitro on straights ---
      let nitro = 0;
      if (st.nitroAmount > 0.5 && curv < 0.004 && fwd > targetSpeed * 0.85) nitro = 1;

      const inputs = { steer, throttle, brake, nitro };
      if (v.step) v.step(dt, inputs);
      else if (v.update) v.update(dt, inputs);

      if (st.finished && !e.finished) { e.finished = true; e.finishTime = st.finishTime || 0; }
      if (e.car && e.car.setState) e.car.setState(v.state, dt);
    }
  }

  standings(playerState) {
    const rows = [];
    for (const e of this.entrants) {
      const st = (e.vehicle && e.vehicle.state) || {};
      rows.push({
        name: e.name,
        isPlayer: false,
        distanceAlong: st.distanceAlong !== undefined ? st.distanceAlong : e.s,
        lap: st.lap || 0,
        finished: !!(st.finished || e.finished),
        finishTime: st.finishTime || e.finishTime || 0
      });
    }
    const ps = playerState || {};
    rows.push({
      name: ps.name || 'Player',
      isPlayer: true,
      distanceAlong: ps.distanceAlong || 0,
      lap: ps.lap || 0,
      finished: !!ps.finished,
      finishTime: ps.finishTime || 0
    });
    rows.sort((a, b) => {
      if (a.finished && b.finished) return a.finishTime - b.finishTime;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      if (b.lap !== a.lap) return b.lap - a.lap;
      return b.distanceAlong - a.distanceAlong;
    });
    return rows;
  }
}