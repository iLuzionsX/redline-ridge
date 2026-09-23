class AudioAdapter {
  constructor() {
    this.engine = null;
    this.ready = false;
    this._muted = false;
    try { this._muted = localStorage.getItem('rr_muted') === '1'; } catch (e) { this._muted = false; }
  }

  async init() {
    // AUDIO INTEGRATION POINT — real engine (agent 1) exposes class AudioEngine with async init(), setState({rpm,throttle,brake,slip,gear,speed}), playCrash(intensity), setMuted(bool).
    try {
      const mod = await import('./audio-engine.js');
      this.engine = new mod.AudioEngine();
      await this.engine.init();
    } catch (e) {
      this.engine = null;
    }
    this.ready = true;
    this.setMuted(this._muted);
    return this;
  }

  get muted() { return this._muted; }

  setMuted(m) {
    this._muted = !!m;
    try { localStorage.setItem('rr_muted', this._muted ? '1' : '0'); } catch (e) {}
    try { this.engine?.setMuted?.(this._muted); } catch (e) {}
  }

  _num(v, d = 0) {
    const n = typeof v === 'number' ? v : Number(v);
    return Number.isFinite(n) ? n : d;
  }

  setState(s) {
    if (!this.engine || !s) return;
    try {
      if (typeof document !== 'undefined' && document.hidden) return;
      this.engine.setState?.({
        rpm: this._num(s.rpm),
        throttle: this._num(s.throttle),
        brake: this._num(s.brake),
        slip: this._num(s.slip),
        gear: this._num(s.gear),
        speed: this._num(s.speed)
      });
    } catch (e) {}
  }

  playCrash(intensity01) {
    if (!this.engine) return;
    try {
      const i = Math.min(1, Math.max(0, this._num(intensity01)));
      this.engine.playCrash?.(i);
    } catch (e) {}
  }

  countdownBeep(final) {
    if (!this.engine) return;
    try { this.engine.countdownBeep?.(!!final); } catch (e) {}
  }
}
export default AudioAdapter;
export { AudioAdapter };
