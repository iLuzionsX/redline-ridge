import * as THREE from 'three';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class ChaseCamera {
  constructor(camera) {
    this.camera = camera;
    this.trauma = 0;
    this.time = 0;
    this.fov = camera.fov;
    this._pos = new THREE.Vector3();
    this._look = new THREE.Vector3();
    this._desired = new THREE.Vector3();
    this._desiredLook = new THREE.Vector3();
    this._fwd = new THREE.Vector3();
    this._right = new THREE.Vector3();
    this._init = false;
  }

  _basis(s) {
    const h = s.heading || 0;
    const sh = Math.sin(h), ch = Math.cos(h);
    this._fwd.set(-sh, 0, -ch);
    this._right.set(ch, 0, -sh);
  }

  _compute(s, outPos, outLook) {
    const p = s.position;
    const speedFactor = clamp(Math.abs(s.forwardSpeed || 0) / 70, 0, 1);
    const dist = 7.2 + speedFactor * 2.2;
    const height = 2.6 + speedFactor * 0.9;
    const lat = (s.lateralSpeed || 0) * 0.06;
    outPos.set(
      p.x - this._fwd.x * dist + this._right.x * lat,
      p.y + height,
      p.z - this._fwd.z * dist + this._right.z * lat
    );
    const ahead = 6 + speedFactor * 6;
    outLook.set(
      p.x + this._fwd.x * ahead,
      p.y + 1.3,
      p.z + this._fwd.z * ahead
    );
    return speedFactor;
  }

  update(dt, s) {
    if (!s || !s.position) return;
    // A single non-finite coordinate poisons the view matrix and can turn the
    // whole frame solid white (or wedge the GPU). Never let it through.
    const px = s.position.x, py = s.position.y, pz = s.position.z;
    if (!isFinite(px) || !isFinite(py) || !isFinite(pz)) return;
    if (!isFinite(s.heading)) s.heading = 0;
    this.time += dt;
    this._basis(s);
    const speedFactor = this._compute(s, this._desired, this._desiredLook);

    if (!this._init) { this.snap(s); return; }

    const kp = 1 - Math.exp(-dt * 5);
    const kl = 1 - Math.exp(-dt * 8);
    this._pos.lerp(this._desired, kp);
    this._look.lerp(this._desiredLook, kl);

    const targetFov = 62 + speedFactor * 16;
    this.fov += (targetFov - this.fov) * (1 - Math.exp(-dt * 4));
    if (Math.abs(this.camera.fov - this.fov) > 0.1) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    if (s.crashed) this.trauma = Math.max(this.trauma, clamp(s.crashIntensity || 0, 0, 1));
    this.trauma = Math.max(0, this.trauma - dt * 1.6);
    const amp = this.trauma * this.trauma * 0.5;
    const t = this.time;
    const ox = amp * (Math.sin(t * 37.1) * 0.6 + Math.sin(t * 61.7) * 0.4);
    const oy = amp * (Math.sin(t * 43.3 + 1.7) * 0.6 + Math.sin(t * 71.3) * 0.4);
    const oz = amp * (Math.sin(t * 53.9 + 3.1) * 0.6 + Math.sin(t * 29.3) * 0.4);

    this.camera.position.set(
      this._pos.x + ox,
      Math.max(this._pos.y + oy, 1.4),
      this._pos.z + oz
    );
    this.camera.lookAt(this._look);
  }

  snap(s) {
    if (!s || !s.position) return;
    if (!isFinite(s.position.x) || !isFinite(s.position.y) || !isFinite(s.position.z)) return;
    if (!isFinite(s.heading)) s.heading = 0;
    this._basis(s);
    const speedFactor = this._compute(s, this._desired, this._desiredLook);
    this._pos.copy(this._desired);
    this._look.copy(this._desiredLook);
    this.trauma = 0;
    this.fov = 62 + speedFactor * 16;
    this.camera.fov = this.fov;
    this.camera.updateProjectionMatrix();
    this.camera.position.set(this._pos.x, Math.max(this._pos.y, 1.4), this._pos.z);
    this.camera.lookAt(this._look);
    this._init = true;
  }
}

export default ChaseCamera;
