'use strict';
// Beat Battle author page. Plain JS, no build step.
// Section 1 is pure (no DOM, no network): the empty-state wording.
// Section 2 is the DOM and fetch code that uses it.

// ---------- 1. pure helpers ----------
function emptyText(author) {
  return 'No beats from ' + author + ' yet.';
}

if (typeof module !== 'undefined') {
  module.exports = { emptyText };
}

// ---------- 2. DOM, network ----------
if (typeof document !== 'undefined') {
  const $ = (id) => document.getElementById(id);
  const author = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop());

  // ----- errors -----
  function showError(msg) {
    const el = $('error');
    el.textContent = msg;
    el.hidden = !msg;
  }

  // ----- rendering -----
  function beatEntry(p) {
    const li = document.createElement('li');
    const link = document.createElement('a');
    link.className = 'load';
    link.href = '/beat/' + encodeURIComponent(p.id);
    link.textContent = p.name;
    const bpm = document.createElement('span');
    bpm.className = 'meta';
    bpm.textContent = p.bpm + ' bpm';
    const votes = document.createElement('span');
    votes.className = 'votes';
    votes.textContent = '🔥 ' + p.votes;
    li.append(link, bpm, votes);
    return li;
  }

  function render(patterns) {
    const list = $('beats');
    if (patterns.length === 0) {
      const li = document.createElement('li');
      li.className = 'empty';
      li.textContent = emptyText(author);
      list.replaceChildren(li);
      return;
    }
    list.replaceChildren(...patterns.map(beatEntry));
  }

  // ----- loading -----
  async function load() {
    showError('');
    $('name').textContent = author;
    let res;
    try {
      res = await fetch('/api/authors/' + encodeURIComponent(author) + '/patterns?limit=100');
    } catch (e) {
      showError('Network error: ' + e.message);
      return;
    }
    if (!res.ok) {
      let msg = res.status + ' ' + res.statusText;
      try { const j = await res.json(); if (j && j.error) msg = j.error; } catch (_) { /* not JSON */ }
      showError(msg);
      return;
    }
    const patterns = await res.json();
    render(patterns);
  }

  function init() {
    load();
  }

  init();
}
