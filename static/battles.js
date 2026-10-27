'use strict';
// Beat Battle battles list + start form. Plain JS, no build step.
// Section 1 is pure (no DOM, no network): the "who's ahead" wording shared by
// this page's list and the battle page's score line.
// Section 2 is the DOM and fetch code that uses it.

// ---------- 1. pure helpers ----------
function aheadText(b) {
  if (b.votesA === b.votesB) return 'Tied';
  return (b.votesA > b.votesB ? b.patternA.name : b.patternB.name) + ' leads';
}

if (typeof module !== 'undefined') {
  module.exports = { aheadText };
}

// ---------- 2. DOM, network ----------
if (typeof document !== 'undefined') {
  const $ = (id) => document.getElementById(id);

  function showError(msg) {
    const el = $('error');
    el.textContent = msg;
    el.hidden = !msg;
  }

  async function call(method, url, body) {
    const opts = { method, headers: {} };
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
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (_) { /* not JSON */ }
      throw new Error(msg);
    }
    return res;
  }

  async function guarded(fn) {
    showError('');
    try { await fn(); } catch (e) { showError(e.message); }
  }

  function empty(list, text) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = text;
    list.replaceChildren(li);
  }

  function optionFor(p) {
    const o = document.createElement('option');
    o.value = p.id;
    o.textContent = p.name + ' — ' + p.author;
    return o;
  }

  function battleEntry(b) {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'load';
    link.href = '/battles/' + encodeURIComponent(b.id);
    link.textContent = b.patternA.name + ' vs ' + b.patternB.name;
    const score = document.createElement('span');
    score.className = 'votes';
    score.textContent = b.votesA + ' : ' + b.votesB;
    const ahead = document.createElement('span');
    ahead.className = 'meta';
    ahead.textContent = aheadText(b);
    li.append(link, score, ahead);
    return li;
  }

  async function loadPatterns() {
    const res = await call('GET', '/api/patterns?limit=100');
    const patterns = await res.json();
    const a = $('pattern-a');
    const b = $('pattern-b');
    a.replaceChildren(...patterns.map(optionFor));
    b.replaceChildren(...patterns.map((p) => optionFor(p)));
    if (!Array.isArray(patterns) || patterns.length < 2) {
      a.disabled = true;
      b.disabled = true;
      $('start-form').querySelector('button').disabled = true;
      showError('Save at least two beats to start a battle.');
    } else {
      b.selectedIndex = 1;
    }
  }

  async function loadBattles() {
    const list = $('battles');
    const res = await call('GET', '/api/battles?limit=20');
    const battles = await res.json();
    if (!Array.isArray(battles) || battles.length === 0) return empty(list, 'No battles yet. Start the first!');
    list.replaceChildren(...battles.map(battleEntry));
  }

  async function startBattle(ev) {
    ev.preventDefault();
    const a = $('pattern-a').value;
    const b = $('pattern-b').value;
    if (a === b) {
      showError('Pick two different beats.');
      return;
    }
    await guarded(async () => {
      const res = await call('POST', '/api/battles', { patternAId: a, patternBId: b });
      const created = await res.json();
      location.href = '/battles/' + encodeURIComponent(created.id);
    });
  }

  async function init() {
    $('start-form').addEventListener('submit', startBattle);
    await guarded(async () => {
      await loadPatterns();
      await loadBattles();
    });
  }

  init();
}
