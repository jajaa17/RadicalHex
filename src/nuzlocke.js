// Nuzlocke tools: official level caps, graveyard box, an encounter log built from where each Pokémon was met,
// locations still open for an encounter, and owned evolution families for the dupes clause.
window.RHNuzlocke = function (ui) {
  'use strict';
  const { h, sprite, D } = ui, X = window.RH_DEX, C = window.RHCore, M = C.mon;
  const WILD_METHODS = X.methods.map((m, i) => (/Grass|Surfing|Rock Smash|Rod/.test(m) ? i : -1)).filter(i => i >= 0);
  const norm = s => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

  // Per-trainer settings, kept on this computer only.
  const key = () => { const t = C.trainer(ui.save()); return `radicalhex-nuzlocke-${t.tid}-${t.sid}`; };
  const defaults = { mode: 'normal', cap: 0, grave: -1 };
  function settings() { try { return { ...defaults, ...JSON.parse(localStorage.getItem(key()) || '{}') }; } catch { return { ...defaults }; } }
  function store(s) { try { localStorage.setItem(key(), JSON.stringify(s)); } catch { /* settings are a convenience */ } }

  // Met locations that have wild encounters in the official location data (matched by name).
  const metIds = Object.keys(X.metNames).map(Number).filter(i => i < 253);
  const wildAreas = new Set();
  for (const rows of Object.values(X.enc)) for (const r of rows) if (WILD_METHODS.includes(r[1])) wildAreas.add(r[0]);
  const wildMet = new Set();
  for (const a of wildAreas) {
    const an = norm(X.areas[a]);
    let best = -1, len = 0;
    for (const i of metIds) { const mn = norm(X.metNames[i]); if ((an === mn || an.startsWith(mn + ' ')) && mn.length > len) { best = i; len = mn.length; } }
    if (best >= 0) wildMet.add(best);
  }

  function everyone(sv, grave) {
    const out = [];
    for (let i = 0; i < C.partyCount(sv); i++) { const r = C.partyRef(sv, i); if (!M.empty(r)) out.push({ r, party: true, box: 0, slot: i, where: 'Party' }); }
    for (let b = 0; b < C.BOXES; b++) for (let s = 0; s < C.SLOTS; s++) {
      const r = C.boxRef(sv, b, s);
      if (!M.empty(r)) out.push({ r, party: false, box: b, slot: s, where: b === grave ? 'Graveyard' : C.boxName(sv, b), dead: b === grave });
    }
    return out;
  }
  // The encounter log can hold hundreds of Pokémon, so its chips skip the sprite to keep memory low.
  const chip = (m, extra, pic = true) => h('button', { type: 'button', class: 'nz-mon' + (m.dead ? ' dead' : '') + (pic ? '' : ' plain'), title: `${M.nickname(m.r)} — ${m.where}`, onclick: () => ui.select(m.party, m.box, m.slot) },
    pic ? sprite(M.species(m.r), M.shiny(m.r), 32, M.isEgg(m.r)) : null,
    h('span', { class: 'nz-name' }, M.nickname(m.r)),
    h('span', { class: 'nz-tag' + (m.dead ? ' dead' : m.party ? ' party' : '') }, extra || m.where));

  function render(pane) {
    const sv = ui.save(), s = settings();
    const cap = X.caps[Math.min(s.cap, X.caps.length - 1)], limit = cap[s.mode];
    const mons = everyone(sv, s.grave), alive = mons.filter(m => !m.dead);
    const over = alive.filter(m => (C.levelOf(D, m.r) || 0) > limit);
    const set = patch => { store({ ...settings(), ...patch }); render(pane); ui.refresh(); };

    // Encounter log grouped by met location.
    const groups = new Map();
    for (const m of mons) { const loc = M.metLocation(m.r); if (!groups.has(loc)) groups.set(loc, []); groups.get(loc).push(m); }
    const locs = [...groups.keys()].sort((a, b) => a - b);
    const open = [...wildMet].filter(i => !groups.has(i)).sort((a, b) => a - b);

    // Evolution families for the dupes clause.
    const fam = new Map();
    for (const m of mons) { const x = X.species[M.species(m.r)]; if (x) fam.set(x.anc, (fam.get(x.anc) || 0) + 1); }

    pane.replaceChildren(
      h('div', { class: 'cards' },
        h('section', { class: 'card' }, h('h3', {}, 'Level cap'),
          h('div', { class: 'form', style: 'grid-template-columns:1fr' },
            h('label', { class: 'f' }, h('span', {}, 'Difficulty'), h('select', { id: 'nz-mode', onchange: e => set({ mode: e.target.value }) },
              h('option', { value: 'normal', selected: s.mode === 'normal' }, 'Normal'), h('option', { value: 'hardcore', selected: s.mode === 'hardcore' }, 'Hardcore / Restricted'))),
            h('label', { class: 'f' }, h('span', {}, 'Next boss'), h('select', { id: 'nz-cap', onchange: e => set({ cap: +e.target.value }) },
              X.caps.map((c, i) => h('option', { value: i, selected: i === s.cap }, `${c.n} — Lv ${c[s.mode]}`))))),
          h('div', { class: 'cap-big' }, h('span', { class: 'note' }, 'Current cap'), h('strong', {}, `Lv ${limit}`)),
          over.length ? h('div', { style: 'display:grid;gap:6px' }, h('span', { class: 'warn' }, `${over.length} Pokémon above the cap`), h('div', { class: 'nz-chips' }, over.slice(0, 24).map(m => chip(m, 'Lv ' + C.levelOf(D, m.r)))),
              over.length > 24 ? h('span', { class: 'note' }, `+${over.length - 24} more`) : null)
            : h('p', { class: 'note' }, 'Nobody is above the cap.')),
        h('section', { class: 'card' }, h('h3', {}, 'Graveyard'),
          h('label', { class: 'f' }, h('span', {}, 'Box for fainted Pokémon'), h('select', { id: 'nz-grave', onchange: e => set({ grave: +e.target.value }) },
            h('option', { value: -1, selected: s.grave < 0 }, 'None'),
            Array.from({ length: C.BOXES }, (_, b) => h('option', { value: b, selected: b === s.grave }, C.boxName(sv, b))))),
          s.grave >= 0 ? h('p', { class: 'note' }, `${mons.filter(m => m.dead).length} in the graveyard. Select a Pokémon in a box and use "Move to graveyard" in the editor.`)
            : h('p', { class: 'note' }, 'Pick a box. Pokémon in it count as fainted in these tools.')),
        h('section', { class: 'card' }, h('h3', {}, 'Run summary'),
          h('dl', { class: 'kv' }, h('dt', {}, 'Alive'), h('dd', {}, String(alive.length)), h('dt', {}, 'Fainted'), h('dd', {}, String(mons.length - alive.length)),
            h('dt', {}, 'Locations with a catch'), h('dd', {}, String(locs.filter(l => l < 253).length)),
            h('dt', {}, 'Evolution families'), h('dd', {}, String(fam.size))))),
      h('div', { class: 'section-title' }, 'Encounter log'),
      h('p', { class: 'note' }, 'Built from where each Pokémon in your save was met. A location with more than one Pokémon is flagged so you can check it against your rules (gifts, shinies and dupes may be allowed).'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'enc nz-log' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Location'), h('th', {}, 'Pokémon'))),
        h('tbody', {}, locs.map(l => h('tr', { class: groups.get(l).length > 1 && l < 253 ? 'flag' : '' },
          h('td', {}, X.metNames[l] || `Location #${l}`, groups.get(l).length > 1 && l < 253 ? h('div', { class: 'warn' }, `${groups.get(l).length} Pokémon met here`) : null),
          h('td', {}, h('div', { class: 'nz-chips' }, groups.get(l).map(m => chip(m, null, false))))))))),
      h('div', { class: 'section-title' }, 'No encounter yet'),
      open.length ? h('div', { class: 'nz-open' }, open.map(i => h('span', { class: 'chip' }, X.metNames[i])))
        : h('p', { class: 'note' }, 'You have a catch from every location with wild Pokémon that RadicalHex can match.'),
      h('p', { class: 'note' }, 'Locations with wild Pokémon in the official Radical Red 4.1 data where none of your Pokémon was met. Open the RadicalDex to see what lives there.'),
      h('div', { class: 'section-title' }, 'Evolution families you own'),
      h('div', { class: 'nz-open' }, [...fam.entries()].sort((a, b) => X.species[a[0]].nat - X.species[b[0]].nat).map(([anc, n]) =>
        h('button', { type: 'button', class: 'chip-btn', onclick: () => ui.openDex(anc) }, sprite(anc, false, 24), D.species[anc] ? D.species[anc].n : '#' + anc, n > 1 ? h('span', { class: 'note' }, ` ×${n}`) : null))));
  }
  return { render, graveBox: () => (ui.save() ? settings().grave : -1) };
};
