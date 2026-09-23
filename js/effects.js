import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const UP = new THREE.Vector3(0, 1, 0);

const RadialBlurShader = {
  uniforms: {
    tDiffuse: { value: null },
    uStrength: { value: 0.0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) }
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse;
    uniform float uStrength;
    uniform vec2 uCenter;
    varying vec2 vUv;
    void main() {
      vec2 dir = vUv - uCenter;
      float d = length(dir);
      vec3 col = texture2D(tDiffuse, vUv).rgb;
      float w = 1.0;
      for (int i = 1; i <= 8; i++) {
        float t = float(i) / 8.0;
        float s = uStrength * 0.055 * t * (0.2 + d);
        col += texture2D(tDiffuse, vUv - dir * s).rgb;
        w += 1.0;
      }
      gl_FragColor = vec4(col / w, 1.0);
    }
  `
};

const TIERS = {
  high:   { blur: 1.00, shadow: 2048, bypass: false },
  medium: { blur: 0.55, shadow: 1024, bypass: false },
  low:    { blur: 0.00, shadow: 512,  bypass: true  }
};

function makeBlobTexture() {
  const S = 128;
  const cv = document.createElement('canvas');
  cv.width = cv.height = S;
  const ctx = cv.getContext('2d');
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0.00, 'rgba(0,0,0,0.60)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.34)');
  g.addColorStop(0.78, 'rgba(0,0,0,0.10)');
  g.addColorStop(1.00, 'rgba(0,0,0,0.00)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function initEffects(scene, renderer, sunLight, opts = {}) {
  const skyPath = opts.skyPath || 'assets/env/sky-sunset.jpg';
  const maxCars = opts.maxCars || 8;
  const groundY = opts.groundY !== undefined ? opts.groundY : 0;
  const shadowExtent = opts.shadowExtent || 30; // ~60m box

  let tier = opts.quality || 'high';
  let speedFactor = 0;
  let blurScale = TIERS[tier] ? TIERS[tier].blur : 1.0;
  let bypass = TIERS[tier] ? TIERS[tier].bypass : false;

  /* ---------------------------------------------------------------- SKY / IBL */
  const loader = new THREE.TextureLoader();
  const skyTex = loader.load(skyPath, () => {
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const rt = pmrem.fromEquirectangular(skyTex);
    scene.environment = rt.texture;
    pmrem.dispose();
  });
  skyTex.mapping = THREE.EquirectangularReflectionMapping;
  skyTex.colorSpace = THREE.SRGBColorSpace;
  scene.background = skyTex;

  /* ------------------------------------------------------------------ SHADOWS */
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  sunLight.castShadow = true;
  const sc = sunLight.shadow;
  sc.mapSize.set(TIERS[tier] ? TIERS[tier].shadow : 2048, TIERS[tier] ? TIERS[tier].shadow : 2048);
  sc.camera.left = -shadowExtent;
  sc.camera.right = shadowExtent;
  sc.camera.top = shadowExtent;
  sc.camera.bottom = -shadowExtent;
  sc.camera.near = 1;
  sc.camera.far = 400;
  sc.bias = -0.0006;
  sc.normalBias = 0.03;
  sc.camera.updateProjectionMatrix();

  if (!sunLight.target.parent) scene.add(sunLight.target);

  const lightOffset = new THREE.Vector3().subVectors(sunLight.position, sunLight.target.position);
  const lightDir = lightOffset.clone().normalize();
  const lightRight = new THREE.Vector3().crossVectors(UP, lightDir);
  if (lightRight.lengthSq() < 1e-6) lightRight.set(1, 0, 0);
  lightRight.normalize();
  const lightUp = new THREE.Vector3().crossVectors(lightDir, lightRight).normalize();

  const _snap = new THREE.Vector3();
  function updateShadow(pos) {
    const texel = (sc.camera.right - sc.camera.left) / sc.mapSize.x;
    const px = pos.dot(lightRight);
    const py = pos.dot(lightUp);
    const dx = Math.round(px / texel) * texel - px;
    const dy = Math.round(py / texel) * texel - py;
    _snap.copy(pos).addScaledVector(lightRight, dx).addScaledVector(lightUp, dy);
    _snap.y = groundY;
    sunLight.target.position.copy(_snap);
    sunLight.target.updateMatrixWorld();
    sunLight.position.copy(_snap).add(lightOffset);
    sunLight.updateMatrixWorld();
  }

  /* ------------------------------------------------------------ CONTACT BLOBS */
  const blobGeo = new THREE.PlaneGeometry(1, 1);
  blobGeo.rotateX(-Math.PI / 2);
  const blobMat = new THREE.MeshBasicMaterial({
    map: makeBlobTexture(),
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    fog: false
  });
  const blobs = new THREE.InstancedMesh(blobGeo, blobMat, maxCars);
  blobs.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  blobs.frustumCulled = false;
  blobs.renderOrder = 2;
  blobs.castShadow = false;
  blobs.receiveShadow = false;
  scene.add(blobs);

  const _m = new THREE.Matrix4();
  const _p = new THREE.Vector3();
  const _q = new THREE.Quaternion();
  const _s = new THREE.Vector3();
  for (let i = 0; i < maxCars; i++) {
    _m.makeScale(0, 0, 0);
    blobs.setMatrixAt(i, _m);
  }
  blobs.instanceMatrix.needsUpdate = true;

  /* ---------------------------------------------------------------- COMPOSER */
  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(renderer.getPixelRatio());

  const renderPass = new RenderPass(scene, null);
  const blurPass = new ShaderPass(RadialBlurShader);
  blurPass.uniforms.uStrength.value = 0;
  const outputPass = new OutputPass();

  composer.addPass(renderPass);
  composer.addPass(blurPass);
  composer.addPass(outputPass);
  blurPass.enabled = false;

  function resize(w, h) {
    const el = renderer.domElement;
    const cw = (el && el.clientWidth) || window.innerWidth;
    const ch = (el && el.clientHeight) || window.innerHeight;
    // Never allow a zero/negative-size target: some drivers wedge or present
    // garbage (e.g. a solid-white frame) when a render target has a 0 dimension.
    const W = Math.max(1, Math.floor(w != null ? w : cw));
    const H = Math.max(1, Math.floor(h != null ? h : ch));
    composer.setPixelRatio(Math.max(1, renderer.getPixelRatio() || 1));
    composer.setSize(W, H);
  }
  window.addEventListener('resize', resize);
  resize();

  /* ------------------------------------------------------------------ PUBLIC */
  function setSpeedFactor(v) {
    speedFactor = Math.max(0, Math.min(1, v || 0));
  }

  function setQualityTier(t) {
    const cfg = TIERS[t] || TIERS.high;
    tier = t;
    blurScale = cfg.blur;
    bypass = cfg.bypass;
    if (sc.mapSize.x !== cfg.shadow) {
      sc.mapSize.set(cfg.shadow, cfg.shadow);
      if (sc.map) { sc.map.dispose(); sc.map = null; }
    }
    blurPass.enabled = !bypass && blurPass.uniforms.uStrength.value > 0.001;
  }

  function update(dt, playerPos, carPositions) {
    if (playerPos) updateShadow(playerPos);

    const n = carPositions ? Math.min(maxCars, carPositions.length) : 0;
    for (let i = 0; i < maxCars; i++) {
      if (i < n) {
        const c = carPositions[i];
        const pos = c.position || c;
        const rawScale = c.scale;
        const s = typeof rawScale === 'number'
          ? rawScale
          : (rawScale && rawScale.x ? (rawScale.x + rawScale.z) * 0.5 : 1);
        const yaw = (typeof c.rotationY === 'number')
          ? c.rotationY
          : (c.rotation ? c.rotation.y : 0);
        _p.set(pos.x, groundY + 0.02, pos.z);
        _q.setFromAxisAngle(UP, yaw);
        _s.set(2.4 * s, 1, 4.6 * s);
        _m.compose(_p, _q, _s);
      } else {
        _m.makeScale(0, 0, 0);
      }
      blobs.setMatrixAt(i, _m);
    }
    blobs.instanceMatrix.needsUpdate = true;

    const strength = speedFactor * blurScale;
    blurPass.uniforms.uStrength.value = strength;
    blurPass.enabled = !bypass && strength > 0.001;
  }

  function render(camera) {
    if (bypass) {
      renderer.render(scene, camera);
      return;
    }
    renderPass.camera = camera;
    composer.render();
  }

  function dispose() {
    window.removeEventListener('resize', resize);
    scene.remove(blobs);
    blobGeo.dispose();
    blobMat.map.dispose();
    blobMat.dispose();
    blobs.dispose();
    composer.dispose();
    if (scene.environment) scene.environment.dispose();
    skyTex.dispose();
  }

  setQualityTier(tier);

  return { setSpeedFactor, update, setQualityTier, render, resize, dispose, composer, blobs, blurPass };
}

export default initEffects;