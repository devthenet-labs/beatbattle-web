'use strict';
// Beat Battle head-to-head page. Plain JS, no build step.
// Section 1 is pure (no DOM, no network, no clock): the "who's ahead" wording,
// matching /battles.js's wording for the same battle.
// Section 2 is the DOM, WebAudio and fetch code that uses it.

// ---------- 1. pure helpers ----------
const TRACKS = ['kick', 'snare', 'hat'];
const STEPS = 16;

function stepSeconds(bpm) {
  return 60 / bpm / 4;
}

function aheadText(b) {
  if (b.votesA === b.votesB) return 'Tied';
  return (b.votesA > b.votesB ? b.patternA.name : b.patternB.name) + ' leads';
}

if (typeof module !== 'undefined') {
  module.exports = { stepSeconds, aheadText };
}

// ---------- 2. DOM, audio, network ----------
if (typeof document !== 'undefined') {
  const $ = (id) => document.getElementById(id);
  const battleId = location.pathname.split('/').filter(Boolean).pop();
  let battle = null;
  let ctx = null;
  let noise = null;
  let timer = null;
  let playingSide = null;

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

  async function guarded(fn) {
    showError('');
    try { await fn(); } catch (e) { showError(e.message); }
  }

  // ----- WebAudio voices (same synthesis as app.js, kept in step) -----
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

  // ----- scheduler: one side at a time, looping over its 16 steps -----
  function startSide(side, pattern) {
    audio();
    stopSide();
    ctx.resume();
    playingSide = side;
    $('play-' + side).textContent = '■ Stop';
    let step = 0;
    let nextTime = ctx.currentTime + 0.05;
    const seconds = stepSeconds(pattern.bpm);
    timer = setInterval(() => {
      while (nextTime < ctx.currentTime + 0.1) {
        const s = step % STEPS;
        for (const t of TRACKS) if (pattern.tracks && pattern.tracks[t] && pattern.tracks[t][s]) voices[t](nextTime);
        step++;
        nextTime += seconds;
      }
    }, 25);
  }

  function stopSide() {
    if (timer) clearInterval(timer);
    timer = null;
    if (playingSide) $('play-' + playingSide).textContent = '▶ Play';
    playingSide = null;
  }

  function toggleSide(side) {
    if (playingSide === side) {
      stopSide();
      return;
    }
    const pattern = side === 'a' ? battle.patternA : battle.patternB;
    startSide(side, pattern);
  }

  // ----- rendering -----
  function renderSide(side, pattern) {
    $('name-' + side).textContent = pattern.name;
    $('meta-' + side).textContent = 'by ' + pattern.author + ' · ' + pattern.bpm + ' bpm';
  }

  function render() {
    renderSide('a', battle.patternA);
    renderSide('b', battle.patternB);
    $('score-a').textContent = String(battle.votesA);
    $('score-b').textContent = String(battle.votesB);
    $('ahead').textContent = aheadText(battle);
  }

  // ----- actions -----
  async function vote(side) {
    await guarded(async () => {
      const res = await call('POST', '/api/battles/' + encodeURIComponent(battleId) + '/votes', { side });
      battle = await res.json();
      render();
    });
  }

  async function load() {
    showError('');
    let res;
    try {
      res = await fetch('/api/battles/' + encodeURIComponent(battleId));
    } catch (e) {
      showError('Network error: ' + e.message);
      return;
    }
    if (res.status === 404) {
      showError('Battle not found.');
      return;
    }
    if (!res.ok) {
      let msg = res.status + ' ' + res.statusText;
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (_) { /* not JSON */ }
      showError(msg);
      return;
    }
    battle = await res.json();
    render();
  }

  function init() {
    $('play-a').addEventListener('click', () => toggleSide('a'));
    $('play-b').addEventListener('click', () => toggleSide('b'));
    $('vote-a').addEventListener('click', () => vote('a'));
    $('vote-b').addEventListener('click', () => vote('b'));
    load();
  }

  init();
}
