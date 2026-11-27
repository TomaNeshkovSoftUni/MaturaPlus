/* Управление на симулациите в tests/manual.html */
(function (MP) {
  'use strict';
  const KEY = 'maturaplus.debug';
  const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } };
  const write = (d) => { if (Object.keys(d).length) localStorage.setItem(KEY, JSON.stringify(d)); else localStorage.removeItem(KEY); show(); };
  const $ = (id) => document.getElementById(id);

  function show() {
    const d = read();
    $('slow').checked = d.latencyMs === 4000;
    $('offline').checked = !!d.offline;
    $('dbDown').checked = !!d.dbDown;
    const on = Object.keys(d);
    $('state').textContent = on.length ? 'Активни симулации: ' + on.join(', ') : 'Няма активни симулации.';
  }

  function rows() {
    const list = MP.getBackend().db.query('Feedback', { orderBy: ['Id', 'desc'], take: 20 }).items;
    $('rows').innerHTML = list.length
      ? MP.ui.html`${list.map((r) => MP.ui.html`<tr><td>${r.Id}</td><td>${r.Type}</td><td>${r.Message.length}</td><td>${r.UserId === null ? 'гост' : r.UserId}</td><td>${r.Status}</td><td><code>${r.RequestId}</code></td></tr>`)}`.toString()
      : '<tr><td colspan="6">Няма записи.</td></tr>';
  }

  $('slow').addEventListener('change', (e) => { const d = read(); if (e.target.checked) d.latencyMs = 4000; else delete d.latencyMs; write(d); });
  $('offline').addEventListener('change', (e) => { const d = read(); if (e.target.checked) d.offline = true; else delete d.offline; write(d); });
  $('dbDown').addEventListener('change', (e) => { const d = read(); if (e.target.checked) d.dbDown = true; else delete d.dbDown; write(d); });
  $('clear').addEventListener('click', () => write({}));
  $('refresh').addEventListener('click', rows);
  $('reset').addEventListener('click', () => {
    if (!window.confirm('Да изтрием ли всички локални данни на Матура+ в този браузър?')) return;
    Object.keys(localStorage).filter((k) => k.startsWith('maturaplus.')).forEach((k) => localStorage.removeItem(k));
    window.location.reload();
  });
  show();
  rows();
})(window.MP = window.MP || {});
