import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const BODY_RE = /body|paint|carrosserie|chassis/i;
const GLASS_RE = /glass|window|windshield/i;
const TIRE_RE = /tire|wheel/i;
const BRAKE_RE = /tail|brake|rear[\s_-]*light/i;
const HEAD_RE = /head|front[\s_-]*light/i;
const WHEEL_RE = /wheel/i;

const clamp = (v, m) => (v < -m ? -m : v > m ? m : v);

export class Car {
  constructor(modelPath, paintColor = 0xffffff, config = {}) {
    this.modelPath = modelPath;
    this.paintColor = paintColor;
    this.wheelRadius = config.wheelRadius ?? 0.34;
    this.group = new THREE.Group();
    this.group.name = 'Car';
    this.wheels = [];
    this.frontWheels = [];
    this.brakeMats = [];
    this.headlightMats = [];
    this.loaded = false;
    this._prevSpeed = 0;
    this._accel = 0;
  }

  async load() {
    const gltf = await new GLTFLoader().loadAsync(this.modelPath);
    const root = gltf.scene;

    // Largest mesh (by local bbox volume) is used as a body-material fallback.
    let largest = null;
    let largestVol = -1;
    const size = new THREE.Vector3();
    root.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox;
      if (!bb) return;
      bb.getSize(size);
      const v = size.x * size.y * size.z;
      if (v > largestVol) { largestVol = v; largest = o; }
    });

    const cache = new Map();
    const convert = (mat, mesh) => {
      if (cache.has(mat)) return cache.get(mat);
      const name = mat.name || '';
      const key = name + ' ' + (mesh.name || '');
      const glass = GLASS_RE.test(name);
      const tire = TIRE_RE.test(name);
      const body = !glass && !tire && (BODY_RE.test(name) || mesh === largest);
      let out;
      if (glass) {
        out = new THREE.MeshPhysicalMaterial({
          color: 0x0e1418, metalness: 0, roughness: 0.05, transmission: 0,
          transparent: true, opacity: 0.85, envMapIntensity: 1.5
        });
      } else if (tire) {
        out = new THREE.MeshPhysicalMaterial({
          color: 0x0b0b0d, metalness: 0.05, roughness: 0.92, clearcoat: 0, envMapIntensity: 0.35
        });
      } else if (body) {
        out = new THREE.MeshPhysicalMaterial({
          color: this.paintColor, metalness: 0.85, roughness: 0.32,
          clearcoat: 1.0, clearcoatRoughness: 0.12, envMapIntensity: 1.2
        });
      } else {
        out = new THREE.MeshPhysicalMaterial({
          color: mat.color ? mat.color.clone() : 0x9a9a9a,
          metalness: 0.5, roughness: 0.55, envMapIntensity: 0.9
        });
      }
      if (mat.map && !body) out.map = mat.map;
      out.name = name;

      if (BRAKE_RE.test(key)) {
        out.emissive = new THREE.Color(0xff0000);
        out.emissiveIntensity = 0;
        this.brakeMats.push(out);
      } else if (HEAD_RE.test(key)) {
        out.emissive = new THREE.Color(0xfff0c0);
        out.emissiveIntensity = 0;
        this.headlightMats.push(out);
      }
      cache.set(mat, out);
      return out;
    };

    root.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.receiveShadow = true;
      if (!o.material) return;
      o.material = Array.isArray(o.material)
        ? o.material.map((m) => convert(m, o))
        : convert(o.material, o);
    });

    this.group.add(root);
    root.updateMatrixWorld(true);

    // Wheels: mesh (or ancestor) named *wheel*. Front axle: prefer "front"/"rear"
    // in node names when present (some models face +Z); fall back to -Z forward.
    const wp = new THREE.Vector3();
    const wheelObjs = [];
    root.traverse((o) => {
      if (!o.isMesh) return;
      let n = o, isWheel = false, tag = '';
      while (n && n !== this.group) {
        const nm = (n.name || '').toLowerCase();
        if (/wheel|tire|tyre/.test(nm)) { isWheel = true; tag += ' ' + nm; }
        n = n.parent;
      }
      if (isWheel) wheelObjs.push({ o, tag });
    });
    if (wheelObjs.length) {
      const frontZ = [], rearZ = [];
      for (const w of wheelObjs) {
        w.o.getWorldPosition(wp);
        // group-local z (group itself is unrotated at load time)
        const lz = this.group.worldToLocal(wp.clone()).z;
        w.lz = lz;
        if (/front/.test(w.tag)) frontZ.push(lz);
        else if (/rear|back/.test(w.tag)) rearZ.push(lz);
      }
      let fz = frontZ.length ? frontZ.reduce((a,b)=>a+b,0)/frontZ.length : null;
      if (fz === null && rearZ.length) {
        // infer: front is the axle opposite the rear
        const rz = rearZ.reduce((a,b)=>a+b,0)/rearZ.length;
        const others = wheelObjs.map(w=>w.lz).filter(z=>Math.abs(z-rz)>0.3);
        if (others.length) fz = others.reduce((a,b)=>a+b,0)/others.length;
      }
      if (fz !== null && fz > 0) {
        // model faces +Z; turn it to face -Z (three.js forward)
        root.rotation.y = Math.PI;
        root.updateMatrixWorld(true);
        for (const w of wheelObjs) {
          w.o.getWorldPosition(wp);
          w.lz = this.group.worldToLocal(wp.clone()).z;
        }
      }
      for (const w of wheelObjs) {
        this.wheels.push(w.o);
        if (w.lz < 0) {
          w.o.rotation.order = 'YXZ'; // steer (Y) outside, spin (X) inside
          this.frontWheels.push(w.o);
        }
      }
    }

    this.loaded = true;
    return this;
  }

  addTo(scene) {
    scene.add(this.group);
    return this;
  }

  setState(s, dt = 0) {
    const g = this.group;
    if (s.position) g.position.set(s.position.x, s.position.y, s.position.z);
    g.rotation.y = s.heading || 0;

    const speed = s.forwardSpeed || 0;
    if (dt > 0) {
      const raw = (speed - this._prevSpeed) / dt;
      this._accel += (raw - this._accel) * Math.min(1, dt * 8);
      this._prevSpeed = speed;
    }

    const spin = (speed / this.wheelRadius) * dt;
    for (let i = 0; i < this.wheels.length; i++) this.wheels[i].rotation.x += spin;

    const steer = s.steerAngle || 0;
    for (let i = 0; i < this.frontWheels.length; i++) this.frontWheels[i].rotation.y = steer;

    // Visual-only body lean / pitch (subtle).
    g.rotation.z = clamp(-(s.lateralSpeed || 0) * 0.012, 0.06);
    g.rotation.x = clamp(this._accel * 0.004, 0.05);

    const braking = (s.brake || 0) > 0.05;
    for (let i = 0; i < this.brakeMats.length; i++) {
      this.brakeMats[i].emissiveIntensity = braking ? 3 : 0.6;
    }
  }

  setHeadlights(on) {
    const v = on ? 2.5 : 0;
    for (let i = 0; i < this.headlightMats.length; i++) {
      this.headlightMats[i].emissiveIntensity = v;
    }
  }

  getObject() {
    return this.group;
  }

  isLoaded() {
    return this.loaded;
  }
}

export default Car;