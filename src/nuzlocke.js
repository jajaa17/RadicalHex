// Nuzlocke tools: official level caps, graveyard box, an encounter log built from where each Pokémon was met,
// locations still open for an encounter, and owned evolution families for the dupes clause.
window.RHNuzlocke = function (ui) {
  'use strict';
  const { h, put, sprite, D } = ui, X = ui.X || window.RH_DEX, C = ui.C || window.RHCore, M = C.mon;
  const G = ui.game || { key: 'rr', full: 'Radical Red 4.1', dexName: 'RadicalDex', specialMet: i => i >= 253 };
  const real = l => !G.specialMet(l); // a real place, not "hatched", "traded" or "fateful encounter"
  const WILD_METHODS = X.methods.map((m, i) => (/Grass|Surfing|Rock Smash|Rod/.test(m) ? i : -1)).filter(i => i >= 0);
  const norm = s => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

  // Per-trainer settings, kept on this computer only.
  const key = () => { const t = C.trainer(ui.save()); return `radicalhex-nuzlocke-${G.key === 'rr' ? '' : G.key + '-'}${t.tid}-${t.sid}`; };
  // missed: encounters that were not caught (fainted, ran away...), which still use up their location: { [met location]: { sp, why } }
  const defaults = { mode: 'normal', cap: 0, grave: -1, missed: {} };
  function settings() { try { return { ...defaults, ...JSON.parse(localStorage.getItem(key()) || '{}') }; } catch { return { ...defaults }; } }
  function store(s) { try { localStorage.setItem(key(), JSON.stringify(s)); } catch { /* settings are a convenience */ } }

  // Met locations that have wild encounters in the official location data (matched by name).
  const metIds = Object.keys(X.metNames).map(Number).filter(real);
  const wildAreas = new Set();
  for (const rows of Object.values(X.enc)) for (const r of rows) if (WILD_METHODS.includes(r[1])) wildAreas.add(r[0]);
  const wildMet = new Set();
  for (const a of wildAreas) {
    const an = norm(X.areas[a]);
    let best = -1, len = 0;
    for (const i of metIds) { const mn = norm(X.metNames[i]); if ((an === mn || an.startsWith(mn + ' ')) && mn.length > len) { best = i; len = mn.length; } }
    if (best >= 0) wildMet.add(best);
  }

  // The wild species of each met location (from the areas whose name matches it), for the missed-encounter form.
  const metAreas = new Map();
  for (const a of wildAreas) {
    const an = norm(X.areas[a]);
    let best = -1, len = 0;
    for (const i of metIds) { const mn = norm(X.metNames[i]); if ((an === mn || an.startsWith(mn + ' ')) && mn.length > len) { best = i; len = mn.length; } }
    if (best >= 0) { if (!metAreas.has(best)) metAreas.set(best, new Set()); metAreas.get(best).add(a); }
  }
  // Met locations with any encounter at all (wild, gift, static, trade...): the places a missed encounter can be at.
  const encMet = new Set();
  for (let a = 0; a < X.areas.length; a++) {
    const an = norm(X.areas[a]);
    let best = -1, len = 0;
    for (const i of metIds) { const mn = norm(X.metNames[i]); if ((an === mn || an.startsWith(mn + ' ')) && mn.length > len) { best = i; len = mn.length; } }
    if (best >= 0) encMet.add(best);
  }
  const speciesAt = loc => {
    const areas = metAreas.get(loc), out = new Set();
    if (areas) for (const [sp, rows] of Object.entries(X.enc)) if (rows.some(r => areas.has(r[0]) && WILD_METHODS.includes(r[1]))) out.add(+sp);
    const seen = new Set(); // forms that share a name (Burmy's cloaks) are listed once
    return [...out].filter(sp => D.species[sp] && D.species[sp].n).sort((a, b) => D.species[a].n.localeCompare(D.species[b].n) || a - b)
      .filter(sp => !seen.has(D.species[sp].n) && seen.add(D.species[sp].n));
  };
  const WHY = { fainted: 'Fainted', fled: 'Ran away', failed: "Couldn't catch it", other: 'Other' };
  let form = { loc: -1, sp: 0, why: 'fainted' };

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
    const missed = s.missed || {};
    const missedLocs = Object.keys(missed).map(Number);
    const open = [...wildMet].filter(i => !groups.has(i) && !missed[i]).sort((a, b) => a - b);
    const logLocs = [...new Set([...locs, ...missedLocs])].sort((a, b) => a - b);
    const placeName = l => X.metNames[l] || `Location #${l}`;
    const record = () => {
      if (form.loc < 0) { ui.status('Pick the location of the encounter.', 'err'); return; }
      const msg = `Recorded the encounter at ${placeName(form.loc)} as used${form.sp ? ` (${D.species[form.sp].n}, ${WHY[form.why].toLowerCase()})` : ` (${WHY[form.why].toLowerCase()})`}.`;
      const entry = { [form.loc]: { sp: form.sp, why: form.why } };
      form = { loc: -1, sp: 0, why: form.why };
      set({ missed: { ...missed, ...entry } });
      ui.status(msg, 'ok');
    };
    const forget = l => { const m = { ...missed }; delete m[l]; set({ missed: m }); ui.status(`Removed the missed encounter at ${placeName(l)}.`, 'ok'); };
    const missedText = l => { const x = missed[l]; return `${x.sp && D.species[x.sp] ? D.species[x.sp].n : 'Encounter'} — ${WHY[x.why] || 'Missed'}`; };
    // Locations for the form: the ones still open first, then the other places that have encounters (gifts, statics...).
    const formLocs = [...open, ...[...encMet].filter(i => !open.includes(i) && !missed[i] && !groups.has(i)).sort((a, b) => placeName(a).localeCompare(placeName(b)))];
    if (form.loc >= 0 && (missed[form.loc] || groups.has(form.loc))) form.loc = -1;
    const here = form.loc >= 0 ? speciesAt(form.loc) : [];
    if (form.sp && !here.includes(form.sp)) form.sp = 0;

    // Evolution families for the dupes clause.
    const fam = new Map();
    for (const m of mons) { const x = X.species[M.species(m.r)]; if (x) fam.set(x.anc, (fam.get(x.anc) || 0) + 1); }

    put(pane,
      h('div', { class: 'cards nz-cards' },
        h('section', { class: 'card' }, h('h3', {}, 'Level cap'),
          h('div', { class: 'form', style: 'grid-template-columns:1fr' },
            X.caps.some(c => c.normal !== c.hardcore) ? h('label', { class: 'f' }, h('span', {}, 'Difficulty'), h('select', { id: 'nz-mode', onchange: e => set({ mode: e.target.value }) },
              h('option', { value: 'normal', selected: s.mode === 'normal' }, 'Normal'), h('option', { value: 'hardcore', selected: s.mode === 'hardcore' }, 'Hardcore / Restricted'))) : null,
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
            h('dt', {}, 'Locations with a catch'), h('dd', {}, String(locs.filter(real).length)),
            h('dt', {}, 'Missed encounters'), h('dd', {}, String(missedLocs.length)),
            h('dt', {}, 'Encounters used'), h('dd', {}, String(new Set([...locs.filter(real), ...missedLocs]).size)),
            h('dt', {}, 'Evolution families'), h('dd', {}, String(fam.size)))),
        h('section', { class: 'card' }, h('h3', {}, 'Missed encounter'),
          h('p', { class: 'note' }, 'Fainted or lost your first encounter somewhere? Record it: that location then counts as used, like a catch.'),
          h('label', { class: 'f' }, h('span', {}, 'Location'), h('select', { id: 'nz-miss-loc', onchange: e => { form.loc = +e.target.value; form.sp = 0; render(pane); } },
            h('option', { value: -1, selected: form.loc < 0 }, 'Choose a location'),
            open.length ? h('optgroup', { label: 'No encounter yet' }, open.map(i => h('option', { value: i, selected: i === form.loc }, placeName(i)))) : null,
            formLocs.length > open.length ? h('optgroup', { label: 'Other places with encounters' }, formLocs.filter(i => !open.includes(i)).map(i => h('option', { value: i, selected: i === form.loc }, placeName(i)))) : null)),
          h('label', { class: 'f' }, h('span', {}, 'Pokémon'), h('select', { id: 'nz-miss-sp', disabled: form.loc < 0, onchange: e => { form.sp = +e.target.value; } },
            h('option', { value: 0 }, form.loc < 0 ? 'Choose a location first' : 'Not noted'),
            here.map(sp => h('option', { value: sp, selected: sp === form.sp }, D.species[sp].n)))),
          h('label', { class: 'f' }, h('span', {}, 'What happened'), h('select', { id: 'nz-miss-why', onchange: e => { form.why = e.target.value; } },
            Object.entries(WHY).map(([k, v]) => h('option', { value: k, selected: k === form.why }, v)))),
          h('button', { id: 'nz-miss-add', class: 'btn small', type: 'button', style: 'justify-self:start', disabled: form.loc < 0, onclick: record }, 'Record missed encounter'))),
      h('div', { class: 'section-title' }, 'Encounter log'),
      h('p', { class: 'note' }, 'Built from where each Pokémon in your save was met. A location with more than one Pokémon is flagged so you can check it against your rules (gifts, shinies and dupes may be allowed).'),
      h('div', { class: 'table-wrap' }, h('table', { class: 'enc nz-log' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Location'), h('th', {}, 'Pokémon'))),
        h('tbody', {}, logLocs.map(l => {
          const ms = groups.get(l) || [], miss = missed[l], many = ms.length > 1 && real(l), broke = miss && ms.length && real(l);
          return h('tr', { class: many || broke ? 'flag' : '' },
            h('td', {}, placeName(l),
              broke ? h('div', { class: 'warn' }, 'Encounter already used (missed), but a Pokémon was caught here')
                : many ? h('div', { class: 'warn' }, `${ms.length} Pokémon met here`) : null),
            h('td', {}, h('div', { class: 'nz-chips' },
              miss ? h('span', { class: 'nz-mon plain dead nz-missed', title: 'Missed encounter: this location is used' },
                h('span', { class: 'nz-name' }, missedText(l)),
                h('button', { type: 'button', class: 'iconbtn', title: 'Remove this missed encounter', 'aria-label': `Remove the missed encounter at ${placeName(l)}`, onclick: () => forget(l) }, '×')) : null,
              ms.map(m => chip(m, null, false)))));
        })))),
      h('div', { class: 'section-title' }, 'No encounter yet'),
      open.length ? h('div', { class: 'nz-open' }, open.map(i => h('button', { type: 'button', class: 'chip-btn', title: 'Record a missed encounter here', onclick: () => { form.loc = i; form.sp = 0; render(pane); const el = document.getElementById('nz-miss-loc'); if (el) el.scrollIntoView({ block: 'center' }); } }, X.metNames[i])))
        : h('p', { class: 'note' }, 'You have a catch from every location with wild Pokémon that RadicalHex can match.'),
      h('p', { class: 'note' }, `Locations with wild Pokémon in the ${G.key === 'rr' ? 'official Radical Red 4.1' : G.full} data where none of your Pokémon was met. Open the ${G.dexName} to see what lives there. Click a location to record a missed encounter there.`),
      h('div', { class: 'section-title' }, 'Evolution families you own'),
      h('div', { class: 'nz-open' }, [...fam.entries()].sort((a, b) => X.species[a[0]].nat - X.species[b[0]].nat).map(([anc, n]) =>
        h('button', { type: 'button', class: 'chip-btn', onclick: () => ui.openDex(anc) }, sprite(anc, false, 24), D.species[anc] ? D.species[anc].n : '#' + anc, n > 1 ? h('span', { class: 'note' }, ` ×${n}`) : null))));
  }
  return { render, graveBox: () => (ui.save() ? settings().grave : -1) };
};
