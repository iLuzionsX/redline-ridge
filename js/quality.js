class QualityGovernor {
  // tier order + per-tier config
  static TIERS = ['low', 'medium', 'high'];
  static CONFIG = {
    high:   { dpr: Math.max(1, Math.min((typeof devicePixelRatio === 'number' ? devicePixelRatio : 1), 2)),   shadow: { size: 2048, frustum: 60 }, reflector: true,  motionBlur: true,  aa: true,  propDensity: 1.0, aniso: 8 },
    medium: { dpr: Math.max(1, Math.min((typeof devicePixelRatio === 'number' ? devicePixelRatio : 1), 1.5)), shadow: { size: 1024, frustum: 50 }, reflector: false, motionBlur: true,  aa: true,  propDensity: 0.7, aniso: 4 },
    low:    { dpr: 1,                                                                                        shadow: { size: 512,  frustum: 40 }, reflector: false, motionBlur: false, aa: false, propDensity: 0.4, aniso: 2 }
  };

  constructor(renderer, hooks = {}) {
    this.renderer = renderer || null;
    this.hooks = hooks || {};
    this._tier = null;
    this.cfg = null;
    // rolling 2s fps window
    this._win = 0; this._frames = 0; this._avg = 60;
    // hysteresis timers
    this._lowT = 0; this._highT = 0; this._cool = 0;
    this.applyTier(this._detect());
  }

  get tier() { return this._tier; }
  get fps() { return this._avg; }
  get config() { return this.cfg; }

  // initial tier guess from device hints
  _detect() {
    const nav = (typeof navigator !== 'undefined' ? navigator : {}) || {};
    const dpr = (typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
    const cores = nav.hardwareConcurrency || 4;
    const mem = nav.deviceMemory;
    const mobile = /Mobi|Android/i.test(nav.userAgent || '');
    if (mobile && typeof mem === 'number' && mem <= 4) return 'low';
    if (dpr >= 2 && cores >= 6) return 'high';
    return 'medium';
  }

  // collect shadow-casting lights (hooks.lights > renderer.scene)
  _lights() {
    const h = this.hooks.lights;
    if (typeof h === 'function') return h() || [];
    if (Array.isArray(h)) return h;
    const out = [];
    const scene = this.renderer && this.renderer.scene;
    if (scene && typeof scene.traverse === 'function') {
      scene.traverse(o => { if (o && o.isLight && o.shadow) out.push(o); });
    }
    return out;
  }

  applyTier(t) {
    const cfg = QualityGovernor.CONFIG[t];
    if (!cfg) return;
    this._tier = t;
    this.cfg = cfg;
    const r = this.renderer, h = this.hooks;

    // pixel ratio
    if (r && typeof r.setPixelRatio === 'function') r.setPixelRatio(cfg.dpr);
    if (typeof h.setPixelRatio === 'function') h.setPixelRatio(cfg.dpr);

    // shadow map + lights
    if (r && r.shadowMap) {
      r.shadowMap.enabled = true;
      r.shadowMap.type = (t === 'low') ? 0 : 2; // 0=Basic, 2=PCFSoft
      r.shadowMap.needsUpdate = true;
    }
    const size = cfg.shadow.size, f = cfg.shadow.frustum;
    for (const light of this._lights()) {
      const sh = light.shadow;
      if (!sh) continue;
      if (sh.mapSize && typeof sh.mapSize.set === 'function') sh.mapSize.set(size, size);
      const cam = sh.camera;
      if (cam) {
        cam.left = -f; cam.right = f; cam.top = f; cam.bottom = -f;
        if (typeof cam.updateProjectionMatrix === 'function') cam.updateProjectionMatrix();
      }
      if (sh.map) { if (typeof sh.map.dispose === 'function') sh.map.dispose(); sh.map = null; }
    }
    if (typeof h.setShadow === 'function') h.setShadow(size, f);

    // feature hooks
    if (typeof h.setEffectsTier === 'function') h.setEffectsTier(t);
    if (typeof h.setPropDensity === 'function') h.setPropDensity(cfg.propDensity);

    // reset hysteresis so a fresh tier gets a full observation window
    this._lowT = 0; this._highT = 0; this._cool = 5;
    this._win = 0; this._frames = 0;
  }

  // manual override (also used by tests)
  setTier(t) { if (QualityGovernor.CONFIG[t] && t !== this._tier) this.applyTier(t); }

  update(dt) {
    if (!(dt > 0)) return;
    if (dt > 1) dt = 1; // clamp tab-switch spikes

    // rolling 2s average
    this._win += dt;
    this._frames++;
    if (this._win >= 2) {
      this._avg = this._frames / this._win;
      this._win = 0; this._frames = 0;
    }

    if (this._cool > 0) { this._cool -= dt; return; }

    // hysteresis: <45 for 3s drops, >57 for 10s rises
    if (this._avg < 45) { this._lowT += dt; this._highT = 0; }
    else if (this._avg > 57) { this._highT += dt; this._lowT = 0; }
    else { this._lowT = 0; this._highT = 0; }

    if (this._lowT >= 3) this._step(-1);
    else if (this._highT >= 10) this._step(1);
  }

  _step(dir) {
    const i = QualityGovernor.TIERS.indexOf(this._tier);
    const j = Math.max(0, Math.min(QualityGovernor.TIERS.length - 1, i + dir));
    if (j === i) { this._lowT = 0; this._highT = 0; return; } // never below 'low'
    this.applyTier(QualityGovernor.TIERS[j]);
  }
}

export default QualityGovernor;
export { QualityGovernor };