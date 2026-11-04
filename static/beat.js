'use strict';
// Beat Battle beat page. Plain JS, no build step.
// Section 1 is pure (no DOM, no network, no clock): the battle record wording.
// Section 2 is the DOM and fetch code that uses it.

// ---------- 1. pure helpers ----------
const TRACKS = ['kick', 'snare', 'hat'];
const STEPS = 16;

function plural(n, one, many) {
  return n + ' ' + (n === 1 ? one : many);
}

function recordText(r) {
  return plural(r.wins, 'win', 'wins') + ', ' + plural(r.losses, 'loss', 'losses');
}

function lengthText(ms) {
  return (Number(ms) / 1000).toFixed(1) + ' s';
}

function deltaText(entry) {
  const delta = entry.after - entry.before;
  return (delta >= 0 ? '+' : '') + delta;
}

function historyEntryText(entry, opponentName) {
  return deltaText(entry) + ' vs ' + opponentName;
}

function authorPath(author) {
  return '/author/' + encodeURIComponent(author);
}

if (typeof module !== 'undefined') {
  module.exports = { TRACKS, STEPS, plural, recordText, lengthText, deltaText, historyEntryText, authorPath };
}

// ---------- 2. DOM, network ----------
if (typeof document !== 'undefined') {
  const $ = (id) => document.getElementById(id);
  const beatId = location.pathname.split('/').filter(Boolean).pop();
  const HISTORY_SHOWN = 5;

  // ----- errors -----
  function showError(msg) {
    const el = $('error');
    el.textContent = msg;
    el.hidden = !msg;
  }

  // ----- rendering -----
  function buildGrid(pattern) {
    const grid = $('grid');
    grid.replaceChildren();
    for (const t of TRACKS) {
      const row = document.createElement('div');
      row.className = 'row';
      row.dataset.track = t;
      const label = document.createElement('span');
      label.className = 'row-label';
      label.textContent = t;
      const steps = document.createElement('div');
      steps.className = 'steps';
      const track = (pattern.tracks && pattern.tracks[t]) || [];
      for (let i = 0; i < STEPS; i++) {
        const s = document.createElement('span');
        s.className = 'step' + (Math.floor(i / 4) % 2 ? ' group-odd' : '') + (track[i] ? ' on' : '');
        steps.appendChild(s);
      }
      row.append(label, steps);
      grid.appendChild(row);
    }
  }

  function render(pattern, record) {
    $('name').textContent = pattern.name;
    const description = pattern.description || '';
    $('description').textContent = description;
    $('description').hidden = !description;
    const authorLink = document.createElement('a');
    authorLink.href = authorPath(pattern.author);
    authorLink.textContent = pattern.author;
    $('meta').replaceChildren(
      'by ',
      authorLink,
      ' · ' + pattern.bpm + ' bpm (' + lengthText(pattern.lengthMs) + ') · ' + pattern.level + ' · swing ' + pattern.swing + '%'
    );
    $('score').textContent = '🔥 ' + pattern.votes + ' · rating ' + pattern.rating;
    $('record').textContent = recordText(record);
    buildGrid(pattern);
    $('content').hidden = false;
  }

  // ----- loading -----
  async function fetchRecord() {
    try {
      const res = await fetch('/api/patterns/' + encodeURIComponent(beatId) + '/record');
      if (!res.ok) return { wins: 0, losses: 0, battles: 0 };
      return await res.json();
    } catch (_) {
      return { wins: 0, losses: 0, battles: 0 };
    }
  }

  async function fetchHistory() {
    try {
      const res = await fetch('/api/patterns/' + encodeURIComponent(beatId) + '/history');
      if (!res.ok) return [];
      return await res.json();
    } catch (_) {
      return [];
    }
  }

  async function fetchBattle(battleId) {
    try {
      const res = await fetch('/api/battles/' + encodeURIComponent(battleId));
      if (!res.ok) return null;
      return await res.json();
    } catch (_) {
      return null;
    }
  }

  function opponentName(view, id) {
    return view.patternA.id === id ? view.patternB.name : view.patternA.name;
  }

  function historyEntry(entry, battle) {
    const li = document.createElement('li');
    li.textContent = historyEntryText(entry, battle ? opponentName(battle, beatId) : '?');
    return li;
  }

  async function renderHistory() {
    const list = $('history');
    const entries = await fetchHistory();
    if (entries.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = 'No battle votes yet.';
      list.replaceChildren(li);
      return;
    }
    const shown = entries.slice(0, HISTORY_SHOWN);
    const battles = await Promise.all(shown.map((e) => fetchBattle(e.battleId)));
    list.replaceChildren(...shown.map((e, i) => historyEntry(e, battles[i])));
  }

  async function load() {
    showError('');
    let res;
    try {
      res = await fetch('/api/patterns/' + encodeURIComponent(beatId));
    } catch (e) {
      showError('Network error: ' + e.message);
      return;
    }
    if (res.status === 404) {
      $('not-found').hidden = false;
      return;
    }
    if (!res.ok) {
      let msg = res.status + ' ' + res.statusText;
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (_) { /* not JSON */ }
      showError(msg);
      return;
    }
    const pattern = await res.json();
    const record = await fetchRecord();
    render(pattern, record);
    renderHistory();
  }

  function init() {
    load();
  }

  init();
}
