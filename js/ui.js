class UI {
  constructor(audio) {
    this.audio = audio;
    this.muted = false;
    this._cache = {};
    this._toastT = 0;
    this._injectStyle();
    this._build();
    this._onKey = (e) => { if (e.key === 'm' || e.key === 'M') this._toggleMute(); };
    window.addEventListener('keydown', this._onKey);
  }

  _injectStyle() {
    const s = document.createElement('style');
    s.textContent = `
#rr-ui{position:fixed;inset:0;z-index:10;pointer-events:none;color:#f2f2f2;text-transform:uppercase;letter-spacing:.06em;
font-family:"Oswald","Arial Narrow",-apple-system,"Segoe UI",Roboto,"Helvetica Neue",sans-serif;-webkit-font-smoothing:antialiased}
#rr-ui .hidden{display:none!important}
#rr-ui .rr-panel{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);background:rgba(10,10,12,.84);
border:1px solid rgba(255,255,255,.12);border-left:3px solid #e10600;padding:28px 34px;min-width:320px;text-align:center;
pointer-events:auto;backdrop-filter:blur(6px)}
#rr-ui .rr-title{font-size:34px;font-weight:700;letter-spacing:.14em;line-height:1}
#rr-ui .rr-title.rr-red{color:#e10600}
#rr-ui .rr-sub{margin-top:10px;font-size:13px;color:#b9b9bd;letter-spacing:.08em}
#rr-ui .rr-dim{color:#9a9aa0;font-size:12px}
#rr-ui .rr-note{margin-top:14px;font-size:11px;color:#7d7d84}
#rr-ui .rr-btn{margin-top:18px;display:block;width:100%;padding:12px 18px;background:#e10600;color:#fff;border:0;font:inherit;
font-size:16px;font-weight:700;letter-spacing:.16em;cursor:pointer;text-transform:uppercase}
#rr-ui .rr-btn:hover{background:#ff1a10}
#rr-ui .rr-small{margin-top:8px;background:rgba(255,255,255,.08);font-size:11px;padding:8px}
#rr-ui .rr-bar{margin:18px 0 8px;height:6px;background:rgba(255,255,255,.12);overflow:hidden}
#rr-ui .rr-bar i{display:block;height:100%;width:0;background:#e10600;transition:width .2s linear}
#rr-ui #rr-countdown{position:absolute;inset:0;display:flex;align-items:center;justify-content:center}
#rr-ui #rr-count-num{font-size:22vh;font-weight:700;color:#fff;text-shadow:0 0 40px rgba(225,6,0,.85)}
#rr-ui #rr-hud{position:absolute;inset:0}
#rr-ui .rr-tl{position:absolute;left:22px;top:18px;background:rgba(10,10,12,.6);border-left:3px solid #e10600;padding:8px 14px}
#rr-ui .rr-lap{font-size:22px;font-weight:700}
#rr-ui .rr-tc{position:absolute;left:50%;top:16px;transform:translateX(-50%);font-size:26px;font-weight:700;
font-variant-numeric:tabular-nums;text-shadow:0 2px 8px #000}
#rr-ui .rr-tr{position:absolute;right:22px;top:18px;font-size:26px;font-weight:700;background:rgba(10,10,12,.6);
padding:6px 14px;border-right:3px solid #e10600}
#rr-ui .rr-br{position:absolute;right:22px;bottom:20px;text-align:right;font-size:56px;font-weight:700;line-height:.9;
font-variant-numeric:tabular-nums;text-shadow:0 2px 10px #000}
#rr-ui .rr-br small{display:block;font-size:12px;color:#b9b9bd;letter-spacing:.2em}
#rr-ui .rr-bc{position:absolute;left:50%;bottom:26px;transform:translateX(-50%);width:min(38vw,420px)}
#rr-ui .rr-nitro{height:10px;background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.18)}
#rr-ui .rr-nitro i{display:block;height:100%;width:0;background:linear-gradient(90deg,#e10600,#ff8a00)}
#rr-ui .rr-hint{position:absolute;left:22px;bottom:20px;font-size:11px;color:#9a9aa0;background:none;border:0;
font-family:inherit;letter-spacing:.12em;pointer-events:auto;cursor:pointer;text-transform:uppercase}
#rr-ui .rr-standings{list-style:none;margin:18px 0 0;padding:0;text-align:left;min-width:340px}
#rr-ui .rr-standings li{display:flex;gap:12px;padding:6px 8px;font-size:14px;border-bottom:1px solid rgba(255,255,255,.08)}
#rr-ui .rr-standings li.me{background:rgba(225,6,0,.18);font-weight:700}
#rr-ui .rr-standings .p{width:26px;color:#e10600;font-weight:700}
#rr-ui .rr-standings .n{flex:1}
#rr-ui .rr-standings .t{font-variant-numeric:tabular-nums;color:#c9c9cf}
#rr-ui #rr-error{position:absolute;inset:0;background:rgba(0,0,0,.86);pointer-events:auto}
#rr-ui #rr-toast{position:absolute;left:50%;top:22%;transform:translateX(-50%);background:rgba(10,10,12,.82);
border-left:3px solid #e10600;padding:8px 18px;font-size:15px;font-weight:700;letter-spacing:.14em}`;
    document.head.appendChild(s);
  }

  _build() {
    const root = document.createElement('div');
    root.id = 'rr-ui';
    root.innerHTML = `
<div id="rr-loading" class="rr-panel">
  <div class="rr-title">REDLINE RIDGE</div>
  <div class="rr-bar"><i id="rr-load-bar"></i></div>
  <div id="rr-load-label" class="rr-dim">LOADING</div>
</div>
<div id="rr-menu" class="rr-panel hidden">
  <div class="rr-title">REDLINE RIDGE</div>
  <div class="rr-sub">Three laps. Seven rivals. One mountain circuit.</div>
  <button id="rr-start" class="rr-btn">START RACE</button>
  <button id="rr-mute-menu" class="rr-btn rr-small">SOUND: ON</button>
  <div class="rr-note">Quality auto-adjusts to your device. Best with headphones.</div>
  <div class="rr-note" style="opacity:.75">BMW G90 M5 by JUSTGAME, CC-BY 4.0, via Sketchfab · Full credits: assets/ATTRIBUTION.md</div>
</div>
<div id="rr-countdown" class="hidden"><span id="rr-count-num">3</span></div>
<div id="rr-hud" class="hidden">
  <div class="rr-tl"><div class="rr-lap">LAP <span id="rr-lap">1</span>/<span id="rr-laps">3</span></div>
    <div class="rr-dim" id="rr-cp">CHECKPOINT 0/3</div></div>
  <div class="rr-tc" id="rr-time">0:00.000</div>
  <div class="rr-tr" id="rr-pos">P8/8</div>
  <div class="rr-br"><span id="rr-speed">0</span><small>KM/H</small></div>
  <div class="rr-bc"><div class="rr-nitro"><i id="rr-nitro"></i></div></div>
  <button class="rr-hint" id="rr-mute-hud">M - SOUND ON</button>
</div>
<div id="rr-results" class="rr-panel hidden">
  <div class="rr-title">RACE COMPLETE</div>
  <ol id="rr-standings" class="rr-standings"></ol>
  <button id="rr-again" class="rr-btn">RACE AGAIN</button>
</div>
<div id="rr-error" class="hidden">
  <div class="rr-panel"><div class="rr-title rr-red">ERROR</div><div id="rr-error-msg" class="rr-sub"></div></div>
</div>
<div id="rr-toast" class="hidden"></div>`;
    document.body.appendChild(root);
    this.root = root;
    const q = (id) => root.querySelector('#' + id);
    this.el = {
      loading: q('rr-loading'), loadBar: q('rr-load-bar'), loadLabel: q('rr-load-label'),
      menu: q('rr-menu'), start: q('rr-start'), muteMenu: q('rr-mute-menu'),
      countdown: q('rr-countdown'), countNum: q('rr-count-num'),
      hud: q('rr-hud'), lap: q('rr-lap'), laps: q('rr-laps'), cp: q('rr-cp'),
      time: q('rr-time'), pos: q('rr-pos'), speed: q('rr-speed'), nitro: q('rr-nitro'),
      muteHud: q('rr-mute-hud'),
      results: q('rr-results'), standings: q('rr-standings'), again: q('rr-again'),
      error: q('rr-error'), errorMsg: q('rr-error-msg'), toast: q('rr-toast')
    };
    this.el.muteMenu.onclick = () => this._toggleMute();
    this.el.muteHud.onclick = () => this._toggleMute();
  }

  _show(k) { this.el[k].classList.remove('hidden'); }
  _hide(k) { this.el[k].classList.add('hidden'); }

  _toggleMute() {
    this.muted = !this.muted;
    if (this.audio && this.audio.setMuted) this.audio.setMuted(this.muted);
    this.setMuteLabel(this.muted);
  }

  setMuteLabel(muted) {
    this.muted = !!muted;
    const t = 'SOUND: ' + (muted ? 'OFF' : 'ON');
    this.el.muteMenu.textContent = t;
    this.el.muteHud.textContent = 'M - ' + t;
  }

  showLoading(p01, label) {
    this._show('loading');
    const p = Math.max(0, Math.min(1, p01 || 0));
    this.el.loadBar.style.width = (p * 100).toFixed(1) + '%';
    this.el.loadLabel.textContent = label || 'LOADING';
  }

  hideLoading() { this._hide('loading'); }

  showMenu(onStart) {
    this.hideLoading();
    this._show('menu');
    const b = this.el.start;
    b.onclick = () => {
      b.onclick = null;
      this._hide('menu');
      if (onStart) onStart();
    };
  }

  async countdown() {
    const n = this.el.countNum;
    this._show('countdown');
    const steps = [['3', false], ['2', false], ['1', false], ['GO!', true]];
    for (let i = 0; i < steps.length; i++) {
      n.textContent = steps[i][0];
      n.style.color = steps[i][1] ? '#e10600' : '#ffffff';
      if (this.audio && this.audio.countdownBeep) this.audio.countdownBeep(steps[i][1]);
      await new Promise((r) => setTimeout(r, 800));
    }
    this._hide('countdown');
  }

  updateHUD(s) {
    if (!s) return;
    if (this.el.hud.classList.contains('hidden')) this._show('hud');
    const c = this._cache;
    const set = (k, el, v) => { if (c[k] !== v) { c[k] = v; el.textContent = v; } };
    set('lap', this.el.lap, String(s.lap == null ? 1 : s.lap));
    set('laps', this.el.laps, String(s.totalLaps == null ? 3 : s.totalLaps));
    if (s.checkpoint != null) {
      set('cp', this.el.cp, 'CHECKPOINT ' + s.checkpoint + '/' + (s.totalCheckpoints == null ? 3 : s.totalCheckpoints));
    }
    set('time', this.el.time, UI.fmtTime(s.raceTime || 0));
    set('pos', this.el.pos, 'P' + (s.position == null ? 1 : s.position) + '/' + (s.totalRacers == null ? 8 : s.totalRacers));
    set('spd', this.el.speed, String(Math.round(Math.abs(s.forwardSpeed || 0) * 3.6)));
    let n = s.nitro || 0;
    if (n > 1) n /= 100;
    n = Math.max(0, Math.min(1, n));
    const w = (n * 100).toFixed(1) + '%';
    if (c.nitro !== w) { c.nitro = w; this.el.nitro.style.width = w; }
  }

  toast(msg, ms = 1800) {
    const t = this.el.toast;
    t.textContent = msg;
    this._show('toast');
    clearTimeout(this._toastT);
    this._toastT = setTimeout(() => this._hide('toast'), ms);
  }

  showResults(standings, onRestart) {
    const list = this.el.standings;
    list.innerHTML = '';
    const rows = standings || [];
    const best = rows.length && rows[0].totalTime != null ? rows[0].totalTime : 0;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const li = document.createElement('li');
      if (r.isPlayer) li.className = 'me';
      const p = document.createElement('span'); p.className = 'p'; p.textContent = String(i + 1);
      const nm = document.createElement('span'); nm.className = 'n'; nm.textContent = r.name || 'RIVAL';
      const tm = document.createElement('span'); tm.className = 't';
      if (r.totalTime == null) tm.textContent = 'DNF';
      else if (i === 0) tm.textContent = UI.fmtTime(r.totalTime);
      else tm.textContent = '+' + UI.fmtTime(Math.max(0, r.totalTime - best));
      li.appendChild(p); li.appendChild(nm); li.appendChild(tm);
      list.appendChild(li);
    }
    const b = this.el.again;
    b.onclick = () => {
      b.onclick = null;
      this._hide('results');
      if (onRestart) onRestart();
    };
    this._show('results');
  }

  showError(msg) {
    this.el.errorMsg.textContent = msg || 'UNKNOWN ERROR';
    this._show('error');
  }

  static fmtTime(t) {
    t = Math.max(0, t || 0);
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const ms = Math.floor((t * 1000) % 1000);
    return m + ':' + String(s).padStart(2, '0') + '.' + String(ms).padStart(3, '0');
  }
}

export default UI;