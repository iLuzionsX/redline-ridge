// js/audio-engine.js — bridges the game's AudioAdapter to the standalone
// RedlineAudio engine (js/new-audio-engine.js, loaded as a classic script in
// index.html so its global lexical binding `RedlineAudio` is visible here).
//
// Exposes the class AudioEngine interface the adapter expects:
//   async init()
//   setState({ rpm, throttle, brake, slip, gear, speed, nitro })
//   playCrash(intensity01)
//   countdownBeep(final)
//   setMuted(bool)
// The engine derives its own rpm/gear from speed (six-gear model), so we
// forward speed and driving inputs and let it do the rest.

export class AudioEngine {
  constructor() {
    this._eng = null;
  }

  async init() {
    try {
      if (typeof RedlineAudio === 'undefined' || !RedlineAudio.create) return this;
      this._eng = RedlineAudio.create({
        sampleBaseUrl: 'assets/audio/',
        samples: {}
      });
      await this._eng.init();
    } catch (e) {
      this._eng = null;
    }
    return this;
  }

  setState(s) {
    if (!this._eng || !s) return;
    try {
      const slip = Math.abs(s.slip || 0);
      this._eng.setState({
        speed: Math.abs(s.speed || 0),
        throttle: s.throttle || 0,
        brake: s.brake || 0,
        slip: slip,
        nitro: !!s.nitro,
        drifting: slip > 0.18
      });
    } catch (e) {}
  }

  playCrash(intensity01) {
    try { this._eng?.playCrash?.(intensity01 == null ? 0.5 : intensity01); } catch (e) {}
  }

  countdownBeep(final) {
    try { this._eng?.playCountdownBeep?.(!!final); } catch (e) {}
  }

  setMuted(m) {
    try { this._eng?.setMuted?.(!!m); } catch (e) {}
  }

  playUiClick() {
    try { this._eng?.playUiClick?.(); } catch (e) {}
  }

  playCheer() {
    try { this._eng?.playCheer?.(); } catch (e) {}
  }

  get muted() {
    try { return this._eng ? !!this._eng.isMuted() : false; } catch (e) { return false; }
  }
}
