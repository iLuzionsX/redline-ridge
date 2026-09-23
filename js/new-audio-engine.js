const RedlineAudio = (function () {
  "use strict";

  const SAMPLE_KEYS = ["engine_loop", "skid_loop", "crash", "crowd_ambience", "ui_click"];
  const MUTE_KEY = "redline_ridge_muted";
  const GEAR_FRACTIONS = [0, 0.176, 0.324, 0.471, 0.618, 0.765, 1.0];
  const IDLE_RPM = 900;
  const REDLINE_RPM = 7000;

  function clamp(v, lo, hi) {
    v = +v;
    if (!isFinite(v)) return lo;
    return v < lo ? lo : v > hi ? hi : v;
  }

  function readPersistedMute() {
    try {
      return window.localStorage.getItem(MUTE_KEY) === "1";
    } catch (e) {
      return false;
    }
  }

  function writePersistedMute(m) {
    try {
      window.localStorage.setItem(MUTE_KEY, m ? "1" : "0");
    } catch (e) {}
  }

  function create(opts) {
    opts = opts || {};
    const sampleBaseUrl = typeof opts.sampleBaseUrl === "string" ? opts.sampleBaseUrl : "";
    const sampleMap = opts.samples && typeof opts.samples === "object" ? opts.samples : {};
    const topSpeedMps = isFinite(opts.topSpeedMps) && opts.topSpeedMps > 0 ? +opts.topSpeedMps : 70;
    const masterVolume = isFinite(opts.masterVolume) ? clamp(opts.masterVolume, 0, 1) : 0.9;

    // ---- internal state ----
    let ctx = null;
    let ready = false;
    let failed = false;
    let initPromise = null;

    let masterGain = null;
    let analyser = null;
    let engineGain = null;
    let engineFilter = null;
    let engineEq = null;
    let shaper = null;
    let osc1 = null, osc2 = null, osc3 = null;
    let engineSampleSrc = null, engineSampleGain = null;
    let skidGain = null, skidFilter = null, skidSrc = null;
    let crowdGain = null, crowdFilter = null, crowdSrc = null;
    let cheerGain = null;
    let noiseBuffer = null;

    const buffers = {
      engine_loop: null,
      skid_loop: null,
      crash: null,
      crowd_ambience: null,
      ui_click: null
    };

    const warned = {};

    function warnOnce(key, msg) {
      if (warned[key]) return;
      warned[key] = true;
      try { console.warn("[RedlineAudio] " + msg); } catch (e) {}
    }

    // ---- model state (always available, even without audio) ----
    const model = {
      speed: 0,
      throttle: 0,
      brake: 0,
      slip: 0,
      nitro: 0,
      drifting: false,
      rpm: IDLE_RPM,
      gear: 0,
      shiftDrop: 0,
      downshiftBlip: 0,
      lastGear: 0
    };

    let muted = readPersistedMute();
    let crowdLevel = 0;
    let lastCrashTime = -1;
    let cheerUntil = 0;

    // ---- helpers ----
    function now() {
      return ctx ? ctx.currentTime : 0;
    }

    function setTarget(param, value, tc) {
      if (!param) return;
      try {
        param.setTargetAtTime(value, now(), tc);
      } catch (e) {
        try { param.value = value; } catch (e2) {}
      }
    }

    function rampTo(param, value, time) {
      if (!param) return;
      try {
        const t = now();
        param.cancelScheduledValues(t);
        param.setValueAtTime(param.value, t);
        param.linearRampToValueAtTime(value, t + time);
      } catch (e) {}
    }

    function makeDriveCurve() {
      const n = 1024;
      const curve = new Float32Array(n);
      for (let i = 0; i < n; i++) {
        const x = (i / (n - 1)) * 2 - 1;
        curve[i] = Math.tanh(x * 1.6) * 0.85;
      }
      return curve;
    }

    function makeNoiseBuffer() {
      const len = Math.floor(ctx.sampleRate * 2);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
      return buf;
    }

    function makeLoopSource(buffer) {
      const src = ctx.createBufferSource();
      src.buffer = buffer;
      src.loop = true;
      return src;
    }

    // ---- sample loading ----
    function fetchArrayBuffer(url) {
      return fetch(url).then(function (res) {
        if (!res.ok) throw new Error("HTTP " + res.status);
        return res.arrayBuffer();
      });
    }

    function loadOne(key) {
      let url = null;
      if (typeof sampleMap[key] === "string" && sampleMap[key]) {
        url = sampleMap[key];
      } else if (sampleBaseUrl) {
        url = sampleBaseUrl + key + ".wav";
      }
      if (!url) return Promise.resolve();
      return fetchArrayBuffer(url)
        .then(function (ab) {
          return new Promise(function (resolve, reject) {
            // callback form for older browsers, promise form for modern
            let settled = false;
            const done = function (buf) {
              if (settled) return;
              settled = true;
              buffers[key] = buf || null;
              resolve();
            };
            const fail = function () {
              if (settled) return;
              settled = true;
              warnOnce("decode_" + key, "could not decode sample '" + key + "'; using synthesis fallback");
              resolve();
            };
            try {
              const p = ctx.decodeAudioData(ab, done, fail);
              if (p && typeof p.then === "function") p.then(done, fail);
            } catch (e) {
              fail();
            }
          });
        })
        .catch(function () {
          warnOnce("fetch_" + key, "could not load sample '" + key + "'; using synthesis fallback");
        });
    }

    function loadAllSamples() {
      const jobs = [];
      for (let i = 0; i < SAMPLE_KEYS.length; i++) jobs.push(loadOne(SAMPLE_KEYS[i]));
      return Promise.all(jobs);
    }

    // ---- graph construction ----
    function buildGraph() {
      masterGain = ctx.createGain();
      masterGain.gain.value = muted ? 0 : masterVolume;

      analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.75;

      masterGain.connect(analyser);
      analyser.connect(ctx.destination);

      noiseBuffer = makeNoiseBuffer();

      // --- engine voice ---
      engineGain = ctx.createGain();
      engineGain.gain.value = 0.015;

      engineEq = ctx.createBiquadFilter();
      engineEq.type = "peaking";
      engineEq.frequency.value = 90;
      engineEq.Q.value = 1;
      engineEq.gain.value = 6;

      engineFilter = ctx.createBiquadFilter();
      engineFilter.type = "lowpass";
      engineFilter.frequency.value = 400;
      engineFilter.Q.value = 0.9;

      shaper = ctx.createWaveShaper();
      shaper.curve = makeDriveCurve();
      shaper.oversample = "2x";

      osc1 = ctx.createOscillator();
      osc1.type = "sawtooth";
      osc1.frequency.value = 30;

      osc2 = ctx.createOscillator();
      osc2.type = "sine";
      osc2.frequency.value = 15;

      osc3 = ctx.createOscillator();
      osc3.type = "sawtooth";
      osc3.frequency.value = 45;
      osc3.detune.value = 7;

      const osc1g = ctx.createGain(); osc1g.gain.value = 0.6;
      const osc2g = ctx.createGain(); osc2g.gain.value = 0.5;
      const osc3g = ctx.createGain(); osc3g.gain.value = 0.35;

      osc1.connect(osc1g).connect(shaper);
      osc2.connect(osc2g).connect(shaper);
      osc3.connect(osc3g).connect(shaper);

      shaper.connect(engineFilter);
      engineFilter.connect(engineEq);
      engineEq.connect(engineGain);
      engineGain.connect(masterGain);

      osc1.start();
      osc2.start();
      osc3.start();

      // engine sample layer
      if (buffers.engine_loop) {
        engineSampleGain = ctx.createGain();
        engineSampleGain.gain.value = 0;
        engineSampleSrc = makeLoopSource(buffers.engine_loop);
        engineSampleSrc.connect(engineSampleGain);
        engineSampleGain.connect(masterGain);
        engineSampleSrc.start();
      }

      // --- skid ---
      skidFilter = ctx.createBiquadFilter();
      skidFilter.type = "bandpass";
      skidFilter.frequency.value = 800;
      skidFilter.Q.value = 1.5;

      skidGain = ctx.createGain();
      skidGain.gain.value = 0;

      skidFilter.connect(skidGain);
      skidGain.connect(masterGain);

      if (buffers.skid_loop) {
        skidSrc = makeLoopSource(buffers.skid_loop);
      } else {
        skidSrc = makeLoopSource(noiseBuffer);
      }
      skidSrc.connect(skidFilter);
      skidSrc.start();

      // --- crowd ---
      crowdFilter = ctx.createBiquadFilter();
      crowdFilter.type = "lowpass";
      crowdFilter.frequency.value = 1200;

      crowdGain = ctx.createGain();
      crowdGain.gain.value = 0.02;

      cheerGain = ctx.createGain();
      cheerGain.gain.value = 0;

      crowdFilter.connect(crowdGain);
      crowdGain.connect(cheerGain);
      cheerGain.connect(masterGain);

      if (buffers.crowd_ambience) {
        crowdSrc = makeLoopSource(buffers.crowd_ambience);
      } else {
        crowdSrc = makeLoopSource(noiseBuffer);
      }
      crowdSrc.connect(crowdFilter);
      crowdSrc.start();
    }

    // ---- engine model update ----
    function updateModel(s) {
      const speed = clamp(s.speed, 0, 1000);
      const throttle = clamp(s.throttle, 0, 1);
      const brake = clamp(s.brake, 0, 1);
      const slip = clamp(s.slip, 0, 1);
      const nitro = clamp(s.nitro, 0, 1);

      model.speed = speed;
      model.throttle = throttle;
      model.brake = brake;
      model.slip = slip;
      model.nitro = nitro;
      model.drifting = !!s.drifting;

      // gear mapping
      let gear = 0;
      if (speed >= 0.5 || throttle >= 0.05) {
        gear = 6;
        for (let g = 1; g <= 6; g++) {
          if (speed <= topSpeedMps * GEAR_FRACTIONS[g]) { gear = g; break; }
        }
      }

      const prevGear = model.lastGear;
      if (gear > 0 && prevGear > 0 && gear > prevGear) {
        model.shiftDrop = 1; // upshift
      }
      if (gear > 0 && prevGear > 0 && gear < prevGear && brake > 0.35) {
        model.downshiftBlip = 1; // downshift blip under hard braking
      }
      model.lastGear = gear;
      model.gear = gear;

      let rpm;
      if (gear === 0) {
        rpm = IDLE_RPM;
      } else {
        const lo = topSpeedMps * GEAR_FRACTIONS[gear - 1];
        const hi = topSpeedMps * GEAR_FRACTIONS[gear];
        const span = Math.max(hi - lo, 0.0001);
        const frac = clamp((speed - lo) / span, 0, 1);
        rpm = IDLE_RPM + frac * (REDLINE_RPM - IDLE_RPM);
        // throttle influence: revs rise a bit with throttle even at low speed
        rpm += throttle * 350 * (1 - frac * 0.5);
        rpm += nitro * 250;
      }

      if (model.shiftDrop > 0) {
        rpm *= 1 - 0.28 * model.shiftDrop;
        model.shiftDrop = Math.max(0, model.shiftDrop - 0.12);
      }
      if (model.downshiftBlip > 0) {
        rpm += 900 * model.downshiftBlip;
        model.downshiftBlip = Math.max(0, model.downshiftBlip - 0.1);
      }

      rpm = clamp(rpm, IDLE_RPM * 0.85, REDLINE_RPM + 400);
      model.rpm = rpm;
      return { speed: speed, throttle: throttle, brake: brake, slip: slip, nitro: nitro };
    }

    // ---- per-frame audio update ----
    function applyAudio(m) {
      const t = now();
      const f = (model.rpm / 60) * 2; // 4-cylinder firing frequency

      setTarget(osc1.frequency, f, 0.03);
      setTarget(osc2.frequency, f * 0.5, 0.03);
      setTarget(osc3.frequency, f * 1.5 * 1.007, 0.03);

      const gainTarget = (0.015 + m.throttle * 0.11) * (muted ? 0 : 1);
      setTarget(engineGain.gain, gainTarget, 0.05);

      const cutoff = 300 + f * 7 + m.throttle * 2200;
      setTarget(engineFilter.frequency, clamp(cutoff, 60, 18000), 0.05);

      if (engineSampleGain && engineSampleSrc) {
        setTarget(engineSampleGain.gain, 0.05 * (0.25 + m.throttle * 0.75), 0.08);
        const rate = clamp(model.rpm / 3000, 0.25, 4);
        setTarget(engineSampleSrc.playbackRate, rate, 0.05);
      }

      // skid
      const speedFrac = clamp(m.speed / topSpeedMps, 0, 1);
      const skidTarget = m.slip > 0.05 ? m.slip * speedFrac * 0.28 : 0;
      setTarget(skidGain.gain, skidTarget, 0.05);
      setTarget(skidFilter.frequency, 800 + m.slip * 800, 0.05);

      // crowd
      setTarget(crowdGain.gain, 0.02 + crowdLevel * 0.16, 0.2);
    }

    // ---- one-shots ----
    function playCrashInternal(intensity) {
      const t = now();
      if (lastCrashTime >= 0 && t - lastCrashTime < 0.15) return;
      lastCrashTime = t;

      const amp = clamp(intensity, 0, 1);
      if (amp <= 0) return;

      // noise burst
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;
      const nf = ctx.createBiquadFilter();
      nf.type = "lowpass";
      nf.frequency.setValueAtTime(3000, t);
      nf.frequency.exponentialRampToValueAtTime(300, t + 0.25);
      const ng = ctx.createGain();
      ng.gain.setValueAtTime(0.0001, t);
      ng.gain.linearRampToValueAtTime(0.6 * amp, t + 0.008);
      ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      noise.connect(nf).connect(ng).connect(masterGain);
      noise.start(t);
      noise.stop(t + 0.3);

      // sine thump
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.setValueAtTime(120, t);
      osc.frequency.exponentialRampToValueAtTime(40, t + 0.4);
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.linearRampToValueAtTime(0.5 * amp, t + 0.01);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      osc.connect(og).connect(masterGain);
      osc.start(t);
      osc.stop(t + 0.45);

      // sample layer
      if (buffers.crash) {
        const s = ctx.createBufferSource();
        s.buffer = buffers.crash;
        const sg = ctx.createGain();
        sg.gain.value = 0.5 * amp;
        s.connect(sg).connect(masterGain);
        s.start(t);
      }

      // duck engine
      if (engineGain) {
        const base = (0.015 + model.throttle * 0.11) * (muted ? 0 : 1);
        engineGain.gain.cancelScheduledValues(t);
        engineGain.gain.setValueAtTime(engineGain.gain.value, t);
        engineGain.gain.linearRampToValueAtTime(base * 0.3, t + 0.02);
        engineGain.gain.setTargetAtTime(base, t + 0.25, 0.08);
      }
    }

    function playCheerInternal() {
      const t = now();
      cheerUntil = t + 2.5;
      const g = cheerGain.gain;
      g.cancelScheduledValues(t);
      g.setValueAtTime(g.value, t);
      g.linearRampToValueAtTime(0.3, t + 0.3);
      g.linearRampToValueAtTime(0, t + 2.5);

      if (!buffers.crowd_ambience) {
        // synth swell fallback: filtered noise burst
        const src = ctx.createBufferSource();
        src.buffer = noiseBuffer;
        const f = ctx.createBiquadFilter();
        f.type = "bandpass";
        f.frequency.setValueAtTime(700, t);
        f.frequency.linearRampToValueAtTime(1400, t + 0.4);
        f.frequency.linearRampToValueAtTime(900, t + 2.4);
        f.Q.value = 0.8;
        const g2 = ctx.createGain();
        g2.gain.setValueAtTime(0.0001, t);
        g2.gain.linearRampToValueAtTime(0.18, t + 0.3);
        g2.gain.linearRampToValueAtTime(0.0001, t + 2.5);
        src.connect(f).connect(g2).connect(masterGain);
        src.start(t);
        src.stop(t + 2.6);
      }
    }

    function playUiClickInternal() {
      const t = now();
      if (buffers.ui_click) {
        const s = ctx.createBufferSource();
        s.buffer = buffers.ui_click;
        const g = ctx.createGain();
        g.gain.value = 0.6;
        s.connect(g).connect(masterGain);
        s.start(t);
        return;
      }
      const osc = ctx.createOscillator();
      osc.type = "square";
      osc.frequency.value = 1800;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.12, t + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      osc.connect(g).connect(masterGain);
      osc.start(t);
      osc.stop(t + 0.06);
    }

    function playCountdownBeepInternal(final) {
      const t = now();
      const freq = final ? 990 : 660;
      const dur = final ? 0.5 : 0.15;
      const osc = ctx.createOscillator();
      osc.type = "sine";
      osc.frequency.value = freq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.22, t + 0.01);
      g.gain.setValueAtTime(0.22, t + dur * 0.7);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc.connect(g).connect(masterGain);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    }

    // ---- public engine object ----
    const engine = {
      init: function () {
        if (initPromise) return initPromise;
        initPromise = new Promise(function (resolve) {
          let Ctor = null;
          try {
            Ctor = window.AudioContext || window.webkitAudioContext;
          } catch (e) {
            Ctor = null;
          }
          if (!Ctor) {
            failed = true;
            warnOnce("noctx", "WebAudio unavailable; running silent");
            resolve();
            return;
          }
          try {
            ctx = new Ctor();
          } catch (e) {
            failed = true;
            warnOnce("noctx", "AudioContext creation failed; running silent");
            resolve();
            return;
          }

          const resume = function () {
            if (ctx.state === "suspended" && ctx.resume) {
              try { ctx.resume(); } catch (e) {}
            }
          };
          resume();

          loadAllSamples()
            .then(function () {
              try {
                buildGraph();
                ready = true;
                // apply persisted mute
                masterGain.gain.value = muted ? 0 : masterVolume;
                applyAudio({ speed: 0, throttle: 0, brake: 0, slip: 0, nitro: 0 });
              } catch (e) {
                failed = true;
                warnOnce("build", "audio graph build failed; running silent");
              }
              resolve();
            })
            .catch(function () {
              try {
                buildGraph();
                ready = true;
              } catch (e) {
                failed = true;
              }
              resolve();
            });
        });
        return initPromise;
      },

      setState: function (s) {
        if (!s || typeof s !== "object") s = {};
        const m = updateModel(s);
        if (!ready || failed || !ctx) return;
        try {
          applyAudio(m);
        } catch (e) {}
      },

      playCrash: function (intensity) {
        if (!ready || failed || !ctx) return;
        try { playCrashInternal(clamp(intensity, 0, 1)); } catch (e) {}
      },

      playCheer: function () {
        if (!ready || failed || !ctx) return;
        try { playCheerInternal(); } catch (e) {}
      },

      playUiClick: function () {
        if (!ready || failed || !ctx) return;
        try { playUiClickInternal(); } catch (e) {}
      },

      playCountdownBeep: function (final) {
        if (!ready || failed || !ctx) return;
        try { playCountdownBeepInternal(!!final); } catch (e) {}
      },

      setCrowdLevel: function (x) {
        crowdLevel = clamp(x, 0, 1);
        if (!ready || failed || !ctx) return;
        try { setTarget(crowdGain.gain, 0.02 + crowdLevel * 0.16, 0.2); } catch (e) {}
      },

      setMuted: function (m) {
        muted = !!m;
        writePersistedMute(muted);
        if (!ready || failed || !ctx || !masterGain) return;
        try {
          rampTo(masterGain.gain, muted ? 0 : masterVolume, 0.08);
        } catch (e) {}
      },

      isMuted: function () {
        return muted;
      },

      getTelemetry: function () {
        return { rpm: model.rpm, gear: model.gear };
      },

      getAnalyser: function () {
        return analyser;
      }
    };

    return engine;
  }

  return { create: create };
})();
