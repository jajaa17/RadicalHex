// RadicalDex: Radical Red 4.1 species data — types, stats, abilities, evolutions, Megas and forms, locations, moves.
// Data: src/dex.js, built from the official Radical Red dex (dex.radicalred.net) by tools/build-dex.js.
window.RHDexView = function (ui) {
  'use strict';
  const { h, sprite, D } = ui, X = window.RH_DEX;
  const C = window.RHCore;
  const name = id => (D.species[id] && D.species[id].n) || `#${id}`;
  const all = Object.keys(X.species).map(Number).filter(id => D.species[id] && D.species[id].n)
    .sort((a, b) => X.species[a].nat - X.species[b].nat || a - b);
  const squash = s => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
  let current = all[0], query = '', type = -1, ownedOnly = false, shiny = false, listTop = 0;

  const typeBadge = t => { const x = X.types.find(y => y.id === t); return x ? h('span', { class: 'type', style: `--type:${x.c}` }, x.n) : null; };
  const pad = n => String(n).padStart(4, '0');

  // Who in the open save has this species or this evolution family.
  function owned() {
    const sv = ui.save(), bySpecies = new Map(), families = new Set();
    if (!sv) return { bySpecies, families };
    const add = (r, where) => {
      if (!r || C.mon.empty(r)) return;
      const sp = C.mon.species(r);
      if (!bySpecies.has(sp)) bySpecies.set(sp, []);
      bySpecies.get(sp).push(where);
      if (X.species[sp]) families.add(X.species[sp].anc);
    };
    for (let i = 0; i < C.partyCount(sv); i++) add(C.partyRef(sv, i), 'Party');
    for (let b = 0; b < C.BOXES; b++) for (let s = 0; s < C.SLOTS; s++) add(C.boxRef(sv, b, s), C.boxName(sv, b));
    return { bySpecies, families };
  }

  // Only the rows in view are in the page (plus a few either side), so the list stays light with 1,300+ Pokémon.
  const ROW = 35, EXTRA = 8;
  let rows = [];
  function list(own) {
    const q = squash(query);
    rows = all.filter(id => (!q || squash(name(id)).includes(q) || String(X.species[id].nat) === query.trim())
      && (type < 0 || X.species[id].t.includes(type)) && (!ownedOnly || own.bySpecies.has(id)));
    const inner = h('div', { class: 'dex-vlist', style: `height:${rows.length * ROW}px` });
    const box = h('div', { class: 'dex-list', role: 'listbox', 'aria-label': 'Pokémon' }, inner);
    let first = -1, last = -1;
    const row = (id, i) => {
      const b = h('button', { type: 'button', class: 'dex-row' + (id === current ? ' cur' : ''), role: 'option', 'aria-selected': String(id === current),
        onclick: () => { listTop = box.scrollTop; show(id); } },
      sprite(id, false, 32), h('span', { class: 'grow' }, name(id)),
      own.bySpecies.has(id) ? h('span', { class: 'own-dot', title: 'In your save' }) : null,
      h('span', { class: 'pick-id' }, pad(X.species[id].nat)));
      b.style.top = i * ROW + 'px';
      return b;
    };
    const paint = () => {
      const a = Math.max(0, Math.floor(box.scrollTop / ROW) - EXTRA);
      const z = Math.min(rows.length, Math.ceil((box.scrollTop + (box.clientHeight || 600)) / ROW) + EXTRA);
      if (a === first && z === last) return;
      first = a; last = z;
      inner.replaceChildren(...rows.slice(a, z).map((id, k) => row(id, a + k)));
    };
    box.addEventListener('scroll', () => { paint(); if (ui.trim) ui.trim(); }, { passive: true });
    box.paint = paint;
    const page = d => box.scrollBy({ top: d * (box.clientHeight - 40) });
    return [h('div', { class: 'dex-count note' }, `${rows.length} Pokémon`), box,
      h('div', { class: 'pop-pager' },
        h('button', { type: 'button', class: 'btn small', title: 'Page up', onclick: () => page(-1) }, '▲ Up'),
        h('button', { type: 'button', class: 'btn small', onclick: () => { box.scrollTop = 0; } }, 'Top'),
        h('button', { type: 'button', class: 'btn small', title: 'Page down', onclick: () => page(1) }, '▼ Down'))];
  }

  const monChip = (id, extra) => h('button', { type: 'button', class: 'mon-chip' + (id === current ? ' cur' : ''), onclick: () => show(id) },
    sprite(id, false, 48), h('span', {}, name(id)), extra ? h('span', { class: 'note' }, extra) : null);

  // Evolution family from the base form, without Mega/form-change branches.
  function tree(id, seen = new Set()) {
    seen.add(id);
    const evos = (X.species[id] ? X.species[id].evo : []).filter(e => !e[2] && !seen.has(e[0]) && X.species[e[0]]);
    return h('div', { class: 'evo' }, monChip(id),
      evos.length ? h('div', { class: 'evo-branches' }, evos.map(([to, how]) =>
        h('div', { class: 'evo-branch' }, h('div', { class: 'evo-how' }, h('span', { 'aria-hidden': 'true' }, '→'), h('span', {}, how)), tree(to, seen)))) : null);
  }
  function familyMembers(root) {
    const out = [], stack = [root], seen = new Set();
    while (stack.length) { const id = stack.pop(); if (seen.has(id) || !X.species[id]) continue; seen.add(id); out.push(id); for (const e of X.species[id].evo) if (!e[2]) stack.push(e[0]); }
    return out;
  }

  function stats(st) {
    const total = st.reduce((a, b) => a + b, 0);
    return h('div', { class: 'stat-bars' }, C.STATS.map((s, i) => [
      h('span', { class: 'stat-name' }, s), h('span', { class: 'stat-val' }, st[i]),
      h('span', { class: 'stat-track' }, h('span', { class: 'stat-fill ' + (st[i] >= 100 ? 'hi' : st[i] >= 60 ? 'mid' : 'lo'), style: `width:${Math.min(100, st[i] / 2.55)}%` }))]),
    h('span', { class: 'stat-name' }, 'Total'), h('span', { class: 'stat-val' }, total), h('span'));
  }

  function detail(id, own) {
    const s = X.species[id], root = s.anc && X.species[s.anc] ? s.anc : id;
    const members = familyMembers(root);
    const changes = members.flatMap(m => X.species[m].evo.filter(e => e[2] && X.species[e[0]]).map(e => [m, e[0], e[1]]));
    const forms = all.filter(x => x !== id && X.species[x].nat === s.nat);
    const enc = (X.enc[id] || []).slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const where = own.bySpecies.get(id) || [];
    const sv = ui.save();
    const dexState = sv && s.nat <= 1000 ? (C.dex.caught(sv, s.nat) ? 'Caught' : C.dex.seen(sv, s.nat) ? 'Seen' : 'Not seen') : null;
    const abil = s.ab.map((a, i) => (a ? h('div', { class: 'kv-row' }, h('span', { class: 'muted' }, ['Ability 1', 'Ability 2', 'Hidden ability'][i]), h('span', {}, a)) : null));
    return h('div', { class: 'dex-detail' },
      h('div', { class: 'dex-hero' },
        sprite(id, shiny, innerWidth < 1180 || innerHeight < 700 ? 96 : 144),
        h('div', { style: 'min-width:0;display:grid;gap:6px' },
          h('div', { class: 'note' }, `No. ${pad(s.nat)}`),
          h('h2', {}, name(id)),
          h('div', { class: 'row' }, s.t.map(typeBadge)),
          h('div', { class: 'row' },
            h('button', { type: 'button', class: 'btn small', 'aria-pressed': String(shiny), onclick: () => { shiny = !shiny; show(id); } }, shiny ? '★ Shiny' : '☆ Normal'),
            dexState ? h('span', { class: 'chip' }, 'Pokédex: ' + dexState) : null,
            where.length ? h('span', { class: 'chip accent-chip' }, `You have ${where.length}`) : own.families.has(root) ? h('span', { class: 'chip' }, 'You own this family') : null))),
      where.length ? h('p', { class: 'note' }, 'In your save: ' + [...new Set(where)].map(w => `${w}${where.filter(x => x === w).length > 1 ? ' ×' + where.filter(x => x === w).length : ''}`).join(', ')) : null,
      h('div', { class: 'dex-grid' },
        h('section', { class: 'card' }, h('h3', {}, 'Base stats'), stats(s.st)),
        h('section', { class: 'card' }, h('h3', {}, 'Abilities'), h('div', { class: 'kv-list' }, abil),
          h('p', { class: 'note' }, 'Radical Red values, which can differ from the official games.'))),
      h('section', { class: 'card' }, h('h3', {}, 'Evolution'),
        members.length > 1 ? h('div', { class: 'evo-scroll' }, tree(root)) : h('p', { class: 'note' }, 'This Pokémon does not evolve.')),
      changes.length ? h('section', { class: 'card' }, h('h3', {}, 'Mega Evolution and form changes'),
        h('div', { class: 'change-list' }, changes.map(([from, to, how]) => h('div', { class: 'change' }, monChip(from), h('span', { class: 'evo-how' }, h('span', { 'aria-hidden': 'true' }, '→'), h('span', {}, how)), monChip(to))))) : null,
      forms.length ? h('section', { class: 'card' }, h('h3', {}, 'Other forms'), h('div', { class: 'row wrap-chips' }, forms.map(f => monChip(f)))) : null,
      h('section', { class: 'card' }, h('h3', {}, 'Where to find it'),
        enc.length ? h('div', { class: 'table-wrap' }, h('table', { class: 'enc' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Location'), h('th', {}, 'How'), h('th', {}, 'Levels'), h('th', {}, 'Chance'))),
          h('tbody', {}, enc.map(e => h('tr', {}, h('td', {}, X.areas[e[0]]), h('td', {}, X.methods[e[1]]),
            h('td', { class: 'mono' }, e[3] == null ? '—' : e[3] === e[4] ? String(e[3]) : `${e[3]}–${e[4]}`),
            h('td', { class: 'mono' }, e[2] == null ? '—' : e[2] + '%'))))))
          : h('p', { class: 'note' }, members.length > 1 && root !== id
            ? `Not listed in the wild, as a gift, trade or raid. Evolve it from ${name(root)} instead.`
            : 'Not listed in the wild, as a gift, trade or raid in Radical Red 4.1.'),
        enc.length ? h('p', { class: 'note' }, 'Wild levels scale with your progress in Radical Red. Chances are per encounter for that method.') : null),
      s.lv.length ? h('section', { class: 'card' }, h('h3', {}, 'Level-up moves'),
        h('div', { class: 'moves-grid' }, s.lv.map(([m, lv]) => [h('span', { class: 'mono muted' }, lv ? 'Lv ' + lv : 'Evo'), h('span', {}, D.moves[m] || '#' + m)]))) : null);
  }

  let pane = null, sizer = null;
  function render(el) {
    pane = el || pane;
    const own = owned();
    if (!X.species[current]) current = all[0];
    const search = h('input', { id: 'dex-search', type: 'text', value: query, placeholder: 'Filter by name or number (optional)', autocomplete: 'off',
      oninput: e => { query = e.target.value; listTop = 0; render(); const s = document.getElementById('dex-search'); s.focus(); s.setSelectionRange(query.length, query.length); } });
    const types = h('select', { id: 'dex-type', 'aria-label': 'Type', onchange: e => { type = +e.target.value; listTop = 0; render(); } },
      h('option', { value: -1 }, 'All types'), X.types.map(t => h('option', { value: t.id, selected: t.id === type }, t.n)));
    const ownBox = ui.save() ? h('label', { class: 'check' }, h('input', { id: 'dex-owned', type: 'checkbox', checked: ownedOnly, onchange: e => { ownedOnly = e.target.checked; listTop = 0; render(); } }), 'Only Pokémon in my save') : null;
    const [count, box, pager] = list(own);
    pane.replaceChildren(h('div', { class: 'dex' },
      h('aside', { class: 'dex-side' }, h('div', { class: 'dex-filters' }, search, types, ownBox), count, box, pager),
      detail(current, own)));
    box.scrollTop = listTop;
    const at = rows.indexOf(current) * ROW;
    if (at >= 0 && (at < box.scrollTop || at + ROW > box.scrollTop + box.clientHeight)) box.scrollTop = Math.max(0, at - box.clientHeight / 2);
    box.paint();
    // The list's height is only known once the page is laid out (and changes when the window is resized).
    if (window.ResizeObserver) { if (!sizer) sizer = new ResizeObserver(es => { for (const e of es) if (e.target.paint) e.target.paint(); }); sizer.disconnect(); sizer.observe(box); }
  }
  function show(id) {
    if (!X.species[id]) return;
    const box = pane && pane.querySelector('.dex-list');
    if (box) listTop = box.scrollTop;
    current = id;
    render();
    const d = pane.querySelector('.dex-detail');
    if (d) d.scrollTop = 0;
  }
  return { render, show, has: id => !!X.species[id] };
};
