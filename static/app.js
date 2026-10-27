'use strict';
// Beat Battle web UI. Plain JS, no build step.
// Section 1 is pure (no DOM, no network, no clock): pattern <-> JSON and step timing.
// Section 2 is the DOM, WebAudio and fetch code that uses it.

// ---------- 1. pure helpers ----------
const TRACKS = ['kick', 'snare', 'hat'];
const STEPS = 16;
const BPM_MIN = 60;
const BPM_MAX = 200;
const SWING_MIN = 0;
const SWING_MAX = 60;

function emptyTracks() {
  const tracks = {};
  for (const t of TRACKS) tracks[t] = new Array(STEPS).fill(false);
  return tracks;
}

function clampBpm(bpm) {
  const n = Math.round(Number(bpm));
  if (!Number.isFinite(n)) return 120;
  return Math.min(BPM_MAX, Math.max(BPM_MIN, n));
}

function clampSwing(swing) {
  const n = Math.round(Number(swing));
  if (!Number.isFinite(n)) return 0;
  return Math.min(SWING_MAX, Math.max(SWING_MIN, n));
}

// Seconds per sixteenth-note step; matches the render service (60 / bpm / 4).
function stepSeconds(bpm) {
  return 60 / clampBpm(bpm) / 4;
}

// How much later an odd (off-beat) step sounds, in seconds; matches the render service.
function swingDelaySeconds(bpm, swing) {
  return stepSeconds(bpm) * clampSwing(swing) / 100;
}

// The grid + form values as the shared pattern JSON the api and render service accept.
function toPattern({ name, author, bpm, swing, tracks }) {
  const out = {};
  for (const t of TRACKS) out[t] = Array.from({ length: STEPS }, (_, i) => Boolean(tracks[t] && tracks[t][i]));
  return {
    name: String(name).trim(), author: String(author).trim(), bpm: clampBpm(bpm), swing: clampSwing(swing),
    tracks: out,
  };
}

// A pattern from the api back into editable state; tolerant of missing fields.
function fromPattern(p) {
  const tracks = emptyTracks();
  for (const t of TRACKS) {
    const src = (p && p.tracks && p.tracks[t]) || [];
    for (let i = 0; i < STEPS; i++) tracks[t][i] = src[i] === true;
  }
  return {
    name: (p && p.name) || '', author: (p && p.author) || '', bpm: clampBpm(p && p.bpm),
    swing: clampSwing(p && p.swing), tracks,
  };
}

if (typeof module !== 'undefined') {
  module.exports = {
    TRACKS, STEPS, emptyTracks, clampBpm, clampSwing, stepSeconds, swingDelaySeconds, toPattern, fromPattern,
  };
}

// ---------- 2. DOM, audio, network ----------
if (typeof document !== 'undefined') {
  const $ = (id) => document.getElementById(id);
  const state = { tracks: emptyTracks(), bpm: 120, swing: 0, remixOf: null };
  const cells = {}; // track -> [button]
  let ctx = null;
  let noise = null;
  let timer = null;
  let nextStep = 0;
  let nextTime = 0;
  let lastBlobURL = null;
  const visual = []; // {step, at} queue for the playhead

  // ----- errors -----
  function showError(msg) {
    const el = $('error');
    el.textContent = msg;
    el.hidden = !msg;
  }

  // A stable id for this browser, sent as X-Client-Id so the api can
  // rate-limit votes per client; kept in localStorage across reloads.
  function clientId() {
    const KEY = 'bb-client-id';
    try {
      let id = localStorage.getItem(KEY);
      if (!id) {
        id = (crypto.randomUUID && crypto.randomUUID()) || (Math.random().toString(36).slice(2) + Date.now().toString(36));
        localStorage.setItem(KEY, id);
      }
      return id;
    } catch (_) {
      return '';
    }
  }

  async function call(method, url, body) {
    const opts = { method, headers: { 'X-Client-Id': clientId() } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(url, opts);
    } catch (e) {
      throw new Error('Network error: ' + e.message);
    }
    if (!res.ok) {
      let msg = res.status + ' ' + res.statusText;
      if (res.status === 429) {
        const retryAfter = res.headers.get('Retry-After');
        msg = retryAfter
          ? 'Too many votes - wait ' + retryAfter + 's and try again.'
          : 'Too many votes - try again shortly.';
      } else {
        try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (_) { /* not JSON */ }
      }
      throw new Error(msg);
    }
    return res;
  }

  // Run an async action; show any failure inline rather than throwing.
  async function guarded(fn) {
    showError('');
    try { await fn(); } catch (e) { showError(e.message); }
  }

  // ----- grid -----
  function buildGrid() {
    const grid = $('grid');
    for (const t of TRACKS) {
      const row = document.createElement('div');
      row.className = 'row';
      row.dataset.track = t;
      const label = document.createElement('span');
      label.className = 'row-label';
      label.textContent = t;
      const steps = document.createElement('div');
      steps.className = 'steps';
      cells[t] = [];
      for (let i = 0; i < STEPS; i++) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'step' + (Math.floor(i / 4) % 2 ? ' group-odd' : '');
        b.setAttribute('aria-label', t + ' step ' + (i + 1));
        b.setAttribute('aria-pressed', 'false');
        b.addEventListener('click', () => {
          state.tracks[t][i] = !state.tracks[t][i];
          paintCell(t, i);
        });
        steps.appendChild(b);
        cells[t].push(b);
      }
      row.append(label, steps);
      grid.appendChild(row);
    }
  }

  function paintCell(t, i) {
    cells[t][i].classList.toggle('on', state.tracks[t][i]);
    cells[t][i].setAttribute('aria-pressed', String(state.tracks[t][i]));
  }

  function paintAll() {
    for (const t of TRACKS) for (let i = 0; i < STEPS; i++) paintCell(t, i);
  }

  function setBpm(bpm) {
    state.bpm = clampBpm(bpm);
    $('bpm').value = state.bpm;
    $('bpm-out').textContent = state.bpm;
  }

  function setSwing(swing) {
    state.swing = clampSwing(swing);
    $('swing').value = state.swing;
    $('swing-out').textContent = state.swing;
  }

  function currentPattern() {
    return toPattern({
      name: $('name').value, author: $('author').value, bpm: state.bpm, swing: state.swing, tracks: state.tracks,
    });
  }

  function setRemixOf(info) {
    state.remixOf = info;
    const el = $('remix-of');
    el.textContent = info ? 'Remixed from ' + info.name : '';
    el.hidden = !info;
  }

  function loadPattern(p, remixOf = null) {
    const s = fromPattern(p);
    state.tracks = s.tracks;
    setBpm(s.bpm);
    setSwing(s.swing);
    $('name').value = s.name;
    $('author').value = s.author;
    paintAll();
    setRemixOf(remixOf);
  }

  // ----- WebAudio voices -----
  function audio() {
    if (!ctx) {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
      const d = noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return ctx;
  }

  function kick(t) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(150, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.12);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.12);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.13);
  }

  function noiseHit(t, decay, gain, highpassHz) {
    const src = ctx.createBufferSource();
    src.buffer = noise;
    const f = ctx.createBiquadFilter();
    f.type = 'highpass';
    f.frequency.value = highpassHz;
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + decay);
    src.connect(f).connect(g).connect(ctx.destination);
    src.start(t);
    src.stop(t + decay + 0.01);
  }

  function snare(t) {
    noiseHit(t, 0.1, 0.5, 1000);
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.value = 200;
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.1);
    o.connect(g).connect(ctx.destination);
    o.start(t);
    o.stop(t + 0.11);
  }

  function hat(t) { noiseHit(t, 0.04, 0.3, 7000); }

  const voices = { kick, snare, hat };

  // ----- scheduler: look ahead 100 ms, tick every 25 ms -----
  function schedule() {
    while (nextTime < ctx.currentTime + 0.1) {
      const step = nextStep % STEPS;
      const playAt = nextTime + (step % 2 === 1 ? swingDelaySeconds(state.bpm, state.swing) : 0);
      for (const t of TRACKS) if (state.tracks[t][step]) voices[t](playAt);
      visual.push({ step, at: playAt });
      nextStep++;
      nextTime += stepSeconds(state.bpm);
    }
  }

  let shown = -1;
  function frame() {
    if (!timer) return;
    while (visual.length && visual[0].at <= ctx.currentTime) {
      const { step } = visual.shift();
      setPlayhead(step);
    }
    requestAnimationFrame(frame);
  }

  function setPlayhead(step) {
    if (shown >= 0) for (const t of TRACKS) cells[t][shown].classList.remove('playhead');
    shown = step;
    if (step >= 0) for (const t of TRACKS) cells[t][step].classList.add('playhead');
  }

  function play() {
    audio();
    stop();
    ctx.resume();
    nextStep = 0;
    nextTime = ctx.currentTime + 0.05;
    timer = setInterval(schedule, 25);
    schedule();
    requestAnimationFrame(frame);
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
    visual.length = 0;
    setPlayhead(-1);
  }

  // ----- lists -----
  function empty(list, text) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = text;
    list.replaceChildren(li);
  }

  function entry(p, withVote) {
    const li = document.createElement('li');
    const load = document.createElement('button');
    load.type = 'button';
    load.className = 'load';
    load.title = 'Load into the grid';
    load.textContent = p.name;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = 'by ' + p.author + ' · ' + p.bpm + ' bpm';
    const votes = document.createElement('span');
    votes.className = 'votes';
    votes.textContent = '🔥 ' + p.votes;
    load.addEventListener('click', () => loadPattern(p));
    const remix = document.createElement('button');
    remix.type = 'button';
    remix.className = 'remix';
    remix.title = 'Load as a remix';
    remix.textContent = 'Remix';
    remix.setAttribute('aria-label', 'Remix ' + p.name);
    remix.addEventListener('click', () => loadPattern(p, { id: p.id, name: p.name }));
    li.append(load, remix, meta, votes);
    if (withVote) {
      const v = document.createElement('button');
      v.type = 'button';
      v.className = 'vote';
      v.textContent = '🔥';
      v.setAttribute('aria-label', 'Vote for ' + p.name);
      v.addEventListener('click', () => guarded(async () => {
        await call('POST', '/api/patterns/' + encodeURIComponent(p.id) + '/votes');
        await refresh();
      }));
      li.appendChild(v);
    }
    return li;
  }

  async function refreshList(url, listId, withVote, emptyText) {
    const list = $(listId);
    const res = await call('GET', url);
    const items = await res.json();
    if (!Array.isArray(items) || items.length === 0) return empty(list, emptyText);
    list.replaceChildren(...items.map((p) => entry(p, withVote)));
  }

  async function refresh() {
    await refreshList('/api/patterns?limit=20', 'fresh', true, 'No beats yet. Be the first!');
    await refreshList('/api/leaderboard', 'board', false, 'Nobody has scored yet.');
  }

  // ----- actions -----
  async function save(ev) {
    ev.preventDefault();
    await guarded(async () => {
      if (state.remixOf) {
        await call('POST', '/api/patterns/' + encodeURIComponent(state.remixOf.id) + '/remix', {
          name: $('name').value.trim(), author: $('author').value.trim(),
        });
      } else {
        await call('POST', '/api/patterns', currentPattern());
      }
      setRemixOf(null);
      await refresh();
    });
  }

  async function render() {
    const btn = $('render');
    btn.disabled = true;
    await guarded(async () => {
      const res = await call('POST', '/render/wav', currentPattern());
      const url = URL.createObjectURL(await res.blob());
      if (lastBlobURL) URL.revokeObjectURL(lastBlobURL);
      lastBlobURL = url;
      $('audio').src = url;
      $('download').href = url;
      $('render-out').hidden = false;
    });
    btn.disabled = false;
  }

  function init() {
    buildGrid();
    paintAll();
    setBpm(state.bpm);
    setSwing(state.swing);
    $('bpm').addEventListener('input', (e) => setBpm(e.target.value));
    $('swing').addEventListener('input', (e) => setSwing(e.target.value));
    $('play').addEventListener('click', play);
    $('stop').addEventListener('click', stop);
    $('save-form').addEventListener('submit', save);
    $('render').addEventListener('click', render);
    guarded(refresh);
  }

  init();
}
