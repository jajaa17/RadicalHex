// RadicalHex window: storage view, Pokémon editor, trainer & bag, backups.
(() => {
  'use strict';
  const C = window.RHCore, D = window.RH_DATA, M = C.mon, S = window.RHSound;
  const host = window.rh || null; // desktop bridge (preload.js); null when opened in a plain browser
  const $ = (s, el = document) => el.querySelector(s);

  // Tiny element builder: h('div', { class: 'x', onclick: fn }, child, 'text')
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(props || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else if (k === 'value') el.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected') el[k] = true;
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const c of kids.flat(Infinity)) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
    return el;
  }

  // Replaces an element's contents; null and false children are skipped (replaceChildren would show them as text).
  const put = (el, ...kids) => el.replaceChildren(...kids.flat(Infinity).filter(k => k != null && k !== false));

  // ── State ──
  let sv = null, fileName = '', dirty = 0, undo = [];
  let tab = 'boxes', box = 0, sel = { party: false, box: 0, slot: 0 }, edTab = 'main', pocket = 'items';
  let draft = null; // the "Add a Pokémon" form
  // RadicalHaX mode: no legality checks, and illegal options (battle-only forms) unlocked. Save safety checks always stay on.
  let hax = false;
  try { hax = localStorage.getItem('radicalhex-hax') === '1'; } catch { /* default off */ }
  const legal = r => (hax || !r || M.empty(r) ? [] : C.legality(D, window.RH_DEX, r));
  const illegal = r => legal(r).some(p => p.level === 'error');

  // ── Names ──
  const spName = id => (D.species[id] && D.species[id].n) || (id ? `#${id}` : '—');
  const squash = s => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
  const addable = id => C.validSpecies(D, id) && !!D.species[id].g && (!D.species[id].b || hax);

  // ── Sprites: one small PNG each, loaded only when on screen (sizes that are multiples of 24 stay crisp) ──
  function sprite(sp, shiny, size, egg) {
    const s = D.species[sp];
    if (egg || !s || s.s === undefined) {
      const el = h('span', { class: 'spr none', 'aria-hidden': 'true' });
      el.style.width = el.style.height = size + 'px';
      return el;
    }
    return h('img', { class: 'spr', src: `assets/sprites/${shiny ? 'shiny/' : ''}${s.s}.png`, width: size, height: size, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' });
  }

  // Cries: a "Cry" button, and the big sprite plays it too when clicked (it hops along).
  // A speaker icon: a filled body and stroked lines (sound waves, or a cross when muted).
  function svgIcon(lines) {
    const ns = 'http://www.w3.org/2000/svg', s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', '0 0 16 16'); s.setAttribute('class', 'icon'); s.setAttribute('aria-hidden', 'true');
    for (const [d, cls] of [['M2 6h3l4-3v10l-4-3H2z', 'fill'], [lines, '']]) { const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); if (cls) p.setAttribute('class', cls); s.append(p); }
    return s;
  }
  const SPEAKER = 'M11 5.5a3.5 3.5 0 0 1 0 5M12.8 3.5a6 6 0 0 1 0 9', SPEAKER_OFF = 'M11 6l4 4M15 6l-4 4';
  function cryButton(sp, pic) {
    const nat = D.species[sp] && D.species[sp].nat;
    if (!nat) return null;
    if (pic) { pic.classList.add('cryable'); pic.title = `Play ${spName(sp)}'s cry`; pic.addEventListener('click', () => S.cry(nat, pic)); }
    return h('button', { type: 'button', class: 'btn small cry', title: `Play ${spName(sp)}'s cry`, onclick: () => S.cry(nat, pic) }, svgIcon(SPEAKER), 'Cry');
  }

  // Item icons: Radical Red's own 24x24 bag graphics, one PNG per item id.
  function itemIcon(id, size = 24) {
    if (!id || !C.validItem(D, id)) return null;
    return h('img', { class: 'item-icon', src: `assets/items/${id}.png`, width: size, height: size, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' });
  }
  const spriteIcon = (id, size) => sprite(id, false, size);

  // ── Pickers: a button that opens a scrollable list. Typing to filter is optional. ──
  let OPTS = {};
  const speciesOpts = () => OPTS.species || (OPTS.species = D.species.map((s, i) => (addable(i) ? { id: i, label: s.n } : null)).filter(Boolean));
  const itemOpts = () => OPTS.items || (OPTS.items = D.items.map((n, i) => (i && C.validItem(D, i) ? { id: i, label: n } : null)).filter(Boolean));
  const moveOpts = () => OPTS.moves || (OPTS.moves = D.moves.map((n, i) => (i && n ? { id: i, label: n } : null)).filter(Boolean));
  const pocketOpts = key => OPTS['p-' + key] || (OPTS['p-' + key] = itemOpts().filter(o => C.pocketOf(D, o.id) === key));
  const nameIn = (list, id) => (list === 'species' ? spName(id) : (list === 'items' ? D.items[id] : D.moves[id]) || '#' + id);

  // value: current id (0 = none). none: label for the empty choice, or null when an empty choice is not allowed.
  // icon: optional (id, size) => element, shown next to each choice (species sprites, item icons).
  function picker({ id, value, options, none = null, placeholder = 'Choose…', icon = null, kind, onPick, bad = false, disabled = false }) {
    if (!icon && kind === 'items') icon = itemIcon;
    const btn = h('button', { id, type: 'button', class: 'pick' + (bad ? ' bad' : ''), 'aria-haspopup': 'listbox', disabled },
      icon && value ? icon(value, 24) : null,
      h('span', { class: 'pick-label' + (value ? '' : ' muted') }, value ? nameIn(kind, value) : none || placeholder),
      value ? h('span', { class: 'pick-id' }, '#' + value) : null,
      h('span', { class: 'pick-caret', 'aria-hidden': 'true' }, '▾'));
    btn.addEventListener('click', () => openList(btn, value, none ? [{ id: 0, label: none }, ...options] : options, icon, onPick));
    return btn;
  }
  let pop = null;
  const closeList = () => { if (pop) { pop.remove(); pop = null; } };
  function openList(btn, value, all, icon, onPick) {
    closeList();
    const search = h('input', { type: 'text', class: 'pop-search', placeholder: 'Scroll the list, or type to filter', 'aria-label': 'Filter the list', autocomplete: 'off' });
    const list = h('div', { class: 'pop-list', role: 'listbox' });
    let shown = all, active = Math.max(0, all.findIndex(o => o.id === value));
    const choose = o => { closeList(); btn.focus(); S.play('pick'); if (o.id !== value) onPick(o.id); };
    const draw = () => list.replaceChildren(...shown.map((o, k) => {
      const row = h('div', { class: 'pop-row' + (o.id === value ? ' cur' : '') + (k === active ? ' act' : ''), role: 'option', 'aria-selected': String(o.id === value) },
        icon ? (o.id && icon(o.id, icon === itemIcon ? 24 : 32)) || h('span', { style: `width:${icon === itemIcon ? 24 : 32}px;flex:none` }) : null,
        h('span', { class: 'grow' }, o.label), o.id ? h('span', { class: 'pick-id' }, '#' + o.id) : null);
      row.addEventListener('mousedown', e => { e.preventDefault(); choose(o); });
      return row;
    }));
    const move = d => {
      if (!shown.length) return;
      active = Math.max(0, Math.min(shown.length - 1, active + d));
      [...list.children].forEach((r, k) => r.classList.toggle('act', k === active));
      list.children[active].scrollIntoView({ block: 'nearest' });
    };
    let letter = '';
    const refilter = () => {
      const q = squash(search.value), n = search.value.replace(/\D/g, '');
      shown = all.filter(o => (!letter || (letter === '#' ? !/^[a-z]/i.test(o.label) : o.label[0].toUpperCase() === letter))
        && (!q || squash(o.label).includes(q) || (n && String(o.id) === n)));
      active = 0; draw(); list.scrollTop = 0;
      for (const b of letters.children) b.setAttribute('aria-pressed', String(b.dataset.l === letter));
    };
    search.addEventListener('input', refilter);
    // Click-only navigation (no scroll wheel needed): first-letter filter and page buttons.
    const letters = h('div', { class: 'pop-letters' }, ['', ...'ABCDEFGHIJKLMNOPQRSTUVWXYZ', '#'].map(l =>
      h('button', { type: 'button', class: 'pop-letter', 'data-l': l, 'aria-pressed': String(l === ''), title: l ? `Names starting with ${l === '#' ? 'a number or symbol' : l}` : 'Show everything',
        onmousedown: e => { e.preventDefault(); letter = l; refilter(); } }, l || 'All')));
    const page = d => list.scrollBy({ top: d * (list.clientHeight - 40) });
    const pager = h('div', { class: 'pop-pager' },
      h('button', { type: 'button', class: 'btn small', onmousedown: e => { e.preventDefault(); page(-1); } }, '▲ Page up'),
      h('button', { type: 'button', class: 'btn small', onmousedown: e => { e.preventDefault(); list.scrollTop = 0; } }, 'Top'),
      h('button', { type: 'button', class: 'btn small', onmousedown: e => { e.preventDefault(); page(1); } }, '▼ Page down'));
    search.addEventListener('keydown', e => {
      const step = { ArrowDown: 1, ArrowUp: -1, PageDown: 10, PageUp: -10 }[e.key];
      if (step) { e.preventDefault(); move(step); }
      else if (e.key === 'Enter') { e.preventDefault(); if (shown[active]) choose(shown[active]); }
      else if (e.key === 'Escape') { e.preventDefault(); closeList(); btn.focus(); }
    });
    pop = h('div', { class: 'pop' }, search, letters, list, pager);
    document.body.append(pop);
    const r = btn.getBoundingClientRect(), w = Math.max(r.width, 340), below = innerHeight - r.bottom - 12, above = r.top - 12;
    pop.style.width = w + 'px';
    pop.style.left = Math.max(8, Math.min(r.left, innerWidth - w - 8)) + 'px';
    if (below >= 260 || below >= above) { pop.style.top = r.bottom + 4 + 'px'; pop.style.maxHeight = Math.min(480, below) + 'px'; }
    else { pop.style.bottom = innerHeight - r.top + 4 + 'px'; pop.style.maxHeight = Math.min(480, above) + 'px'; }
    draw();
    if (list.children[active]) list.children[active].scrollIntoView({ block: 'center' });
    search.focus();
  }
  document.addEventListener('mousedown', e => { if (pop && !pop.contains(e.target)) closeList(); });
  document.addEventListener('scroll', e => { if (pop && !pop.contains(e.target)) closeList(); }, true);
  window.addEventListener('resize', closeList);

  // Big sprites shrink on small windows (multiples of 24 px stay crisp).
  const heroSize = () => (innerWidth < 1180 || innerHeight < 700 ? 96 : 144);
  window.addEventListener('resize', () => { if (sv && $('#hero')) renderHero(); });

  // ── Status, dialogs ──
  function status(text, kind) { const e = $('#status'); e.textContent = text; e.className = kind || ''; if (kind === 'err') S.play('error'); }
  function modal(title, body, buttons) {
    return new Promise(resolve => {
      const d = h('dialog', { class: 'card', style: 'max-width:520px;border:1px solid var(--line);color:var(--fg);background:var(--panel)' },
        h('h3', {}, title), h('p', { class: 'note', style: 'white-space:pre-line;font-size:13px' }, body),
        h('div', { class: 'row', style: 'justify-content:flex-end' }, buttons.map((b, i) =>
          h('button', { class: 'btn' + (b.primary ? ' primary' : ''), type: 'button', onclick: () => { d.close(); d.remove(); resolve(i); } }, b.text))));
      d.addEventListener('cancel', () => { d.remove(); resolve(-1); });
      document.body.append(d);
      d.showModal();
    });
  }
  const showError = (title, err) => modal(title, err.message || String(err), [{ text: 'OK', primary: true }]);

  // ── Changes and undo ──
  const snapshot = () => ({ data: sv.data.slice(), stream: sv.stream.slice(), raw: sv.raw.slice(), ext: sv.ext.slice() });
  const restore = s => { sv.data.set(s.data); sv.stream.set(s.stream); sv.raw.set(s.raw); sv.ext.set(s.ext); };
  const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const unchanged = s => sameBytes(s.data, sv.data) && sameBytes(s.stream, sv.stream) && sameBytes(s.raw, sv.raw) && sameBytes(s.ext, sv.ext);
  // Runs one edit. If it throws, the save is put back exactly as it was.
  function change(what, fn, opts = {}) {
    const before = snapshot();
    try {
      const r = fn();
      if (r === false) { restore(before); return false; }
      // Nothing actually changed (e.g. the same value typed again): no undo step and no unsaved change, just redraw.
      if (unchanged(before)) { if (opts.full) queueEditor(); return false; }
      undo.push({ what, before });
      if (undo.length > 50) undo.shift();
      dirty++;
      afterChange(opts);
      status(what + '.', 'ok');
      S.play(opts.sfx || 'ok');
      return true;
    } catch (e) {
      restore(before);
      status(e.message, 'err');
      return false;
    }
  }
  function doUndo() {
    const u = undo.pop();
    if (!u) return;
    S.play('undo');
    restore(u.before);
    dirty = Math.max(0, dirty - 1);
    afterChange({ full: true });
    status(`Undid: ${u.what}.`);
  }
  let renderQueued = false;
  function afterChange(opts) {
    if (host) host.setDirty(dirty > 0).catch(() => {});
    renderHeader();
    if (tab === 'boxes') renderBoxes();
    if (tab === 'party') renderParty();
    if (tab === 'nuzlocke') nuz.render($('#pane-nuzlocke'));
    if (tab === 'trainer') keepFocus(renderTrainer);
    if (opts.full) queueEditor(); else renderHero();
  }
  // Re-renders after the browser has moved focus, then restores focus to the control with the same id.
  function keepFocus(fn) {
    setTimeout(() => {
      const id = document.activeElement && document.activeElement.id;
      fn();
      if (id && document.getElementById(id)) document.getElementById(id).focus();
    }, 0);
  }
  // Re-render after the browser has moved focus, then put focus back on the same control.
  function queueEditor() {
    if (renderQueued) return;
    renderQueued = true;
    keepFocus(() => { renderQueued = false; renderEditor(); });
  }

  // ── Selection ──
  const selRef = () => (sel.party ? (sel.slot < C.partyCount(sv) ? C.partyRef(sv, sel.slot) : null) : C.boxRef(sv, sel.box, sel.slot));
  const filled = r => r && !M.empty(r);
  function select(party, b, slot) {
    sel = { party, box: b, slot };
    if (!party) box = b;
    renderPane();
    renderEditor();
  }

  // ── Header ──
  function renderHeader() {
    const f = $('#file');
    f.hidden = !sv;
    $('#btnSave').disabled = !sv || (!dirty && !!host);
    $('#btnSaveAs').disabled = !sv;
    $('#btnUndo').disabled = !undo.length;
    for (const id of ['#btnSave', '#btnUndo']) $(id).hidden = !sv;
    $('#btnSaveAs').hidden = !sv || !host;
    if (!sv) return;
    f.replaceChildren(
      h('b', {}, fileName), h('span', {}, `save #${sv.saveIndex}`), h('span', { class: 'ok' }, '✓ checksums valid'),
      dirty ? h('span', { class: 'dirty' }, `● ${dirty} unsaved change${dirty === 1 ? '' : 's'}`) : h('span', {}, 'no unsaved changes'));
  }

  // ── Storage pane ──
  function boxCount(b) { let n = 0; for (let s = 0; s < C.SLOTS; s++) if (filled(C.boxRef(sv, b, s))) n++; return n; }
  function slotButton(ref, party, b, s, size) {
    const isSel = sel.party === party && sel.slot === s && (party || sel.box === b);
    const el = h('button', { class: 'slot' + (filled(ref) ? '' : ' empty') + (isSel ? ' sel' : ''), type: 'button', onclick: () => select(party, b, s) });
    if (filled(ref)) {
      const sp = M.species(ref), lv = C.levelOf(D, ref), iv = M.ivs(ref);
      el.title = `${M.nickname(ref)} — ${spName(sp)}${lv ? ', Lv ' + lv : ''}`;
      el.append(...[sprite(sp, M.shiny(ref), size, M.isEgg(ref)),
        party ? h('span', { class: 'pinfo' }, h('span', { class: 'pname' }, M.nickname(ref) || spName(sp)), h('span', { class: 'plv' }, lv ? 'Lv ' + lv : '')) : null,
        h('span', { class: 'marks' }, M.shiny(ref) ? h('span', { class: 'star', title: 'Shiny' }, '★') : null,
          iv.every(v => v === 31) ? h('span', { class: 'perfect', title: 'Perfect IVs' }, '⬢') : null,
          illegal(ref) ? h('span', { class: 'illegal-mark', title: 'Illegal: open it to see why' }, '✕') : null),
        lv && !party ? h('span', { class: 'lv' }, 'Lv' + lv) : null,
        M.item(ref) ? h('span', { class: 'held', title: 'Holding ' + (D.items[M.item(ref)] || 'an item') }, itemIcon(M.item(ref))) : null].filter(Boolean));
      if (!party) {
        el.draggable = true;
        el.addEventListener('dragstart', e => { e.dataTransfer.setData('text/rh-slot', `${b},${s}`); e.dataTransfer.effectAllowed = 'move'; });
      }
    } else {
      el.title = party ? 'Empty party slot' : 'Empty — click to add a Pokémon';
      if (party) el.append(h('span', { class: 'pinfo muted' }, 'Empty'));
    }
    if (!party) {
      el.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/rh-slot')) { e.preventDefault(); el.classList.add('drop'); } });
      el.addEventListener('dragleave', () => el.classList.remove('drop'));
      el.addEventListener('drop', e => {
        el.classList.remove('drop');
        const v = e.dataTransfer.getData('text/rh-slot');
        if (!v) return;
        e.preventDefault();
        const [fb, fs] = v.split(',').map(Number);
        if (fb === b && fs === s) return;
        if (change(`Moved ${spName(M.species(C.boxRef(sv, fb, fs)))} to ${C.boxName(sv, b)}`, () => C.swap(C.boxRef(sv, fb, fs), C.boxRef(sv, b, s)))) select(false, b, s);
      });
    }
    return el;
  }
  function renderBoxes() {
    trim();
    const pane = $('#pane-boxes');
    const pick = h('select', { id: 'boxSelect', 'aria-label': 'Box', onchange: e => { box = +e.target.value; renderBoxes(); } },
      Array.from({ length: C.BOXES }, (_, b) => h('option', { value: b, selected: b === box }, `${C.boxName(sv, b)}  (${boxCount(b)}/30)`)));
    const grid = h('div', { class: 'pc' });
    for (let s = 0; s < C.SLOTS; s++) grid.append(slotButton(C.boxRef(sv, box, s), false, box, s, 72));
    put(pane,
      h('div', { class: 'boxbar' },
        h('button', { class: 'btn', type: 'button', title: 'Previous box', onclick: () => { box = (box + C.BOXES - 1) % C.BOXES; renderBoxes(); } }, '‹'),
        pick,
        h('button', { class: 'btn', type: 'button', title: 'Next box', onclick: () => { box = (box + 1) % C.BOXES; renderBoxes(); } }, '›'),
        h('span', { class: 'spacer' }),
        illegalButton(),
        h('button', { class: 'btn', type: 'button', onclick: maxAllIvs, title: 'Set all six IVs to 31 for every Pokémon in the party and all 25 boxes' }, 'Max IVs on everything')),
      grid,
      box >= 22 ? h('p', { class: 'note' }, 'Boxes 23–25 unlock in Radical Red as your PC fills up. Pokémon placed here are saved, and appear in the game once the box is unlocked.') : null,
      h('p', { class: 'note' }, 'Drag a Pokémon onto another slot to move or swap it. "Move to box" and "Move to party" in the editor send it further. Click an empty slot to add a new Pokémon.'));
  }

  function healParty() {
    let healed = 0;
    change('Healed the party', () => {
      for (let i = 0; i < C.partyCount(sv); i++) if (C.heal(D, C.partyRef(sv, i))) healed++;
      return healed > 0;
    }, { full: true, sfx: 'heal' });
    status(healed ? `Healed ${healed} Pokémon: full HP, no status conditions and full PP.` : 'Your party is already fully healed.', healed ? 'ok' : '');
  }

  // ── Party pane ──
  function renderParty() {
    const n = C.partyCount(sv), cards = [];
    for (let s = 0; s < 6; s++) {
      const r = s < n ? C.partyRef(sv, s) : null;
      if (!filled(r)) {
        cards.push(h('button', { type: 'button', class: 'pcard empty' + (sel.party && sel.slot === s ? ' sel' : ''), title: 'Add a Pokémon to your party', onclick: () => select(true, 0, s) },
          h('span', { class: 'muted' }, '＋ Add a Pokémon')));
        continue;
      }
      const sp = M.species(r), st = M.partyStats(r), hp = r.buf[r.off + 0x56] | (r.buf[r.off + 0x57] << 8);
      const pct = st[0] ? Math.max(0, Math.min(100, Math.round(hp / st[0] * 100))) : 0;
      cards.push(h('button', { type: 'button', class: 'pcard' + (sel.party && sel.slot === s ? ' sel' : ''), onclick: () => select(true, 0, s) },
        sprite(sp, M.shiny(r), 96, M.isEgg(r)),
        h('span', { class: 'pcard-body' },
          h('span', { class: 'pcard-head' }, h('strong', {}, M.nickname(r) || spName(sp)), M.shiny(r) ? h('span', { class: 'star' }, '★') : null,
            C.partyStatus(r) ? h('span', { class: 'status-badge' + (C.partyStatus(r) === 'Fainted' ? ' fnt' : '') }, C.partyStatus(r)) : null,
            h('span', { class: 'note mono' }, 'Lv ' + C.levelOf(D, r))),
          h('span', { class: 'note' }, `${spName(sp)} · ${C.NATURES[M.nature(r)]}`),
          h('span', { class: 'note held-line' }, itemIcon(M.item(r)), M.item(r) ? 'Holding ' + (D.items[M.item(r)] || '#' + M.item(r)) : 'No held item'),
          h('span', { class: 'hpbar', title: `HP ${hp}/${st[0]}` }, h('span', { class: pct > 50 ? 'ok' : pct > 20 ? 'mid' : 'low', style: `width:${pct}%` })),
          h('span', { class: 'pcard-moves' }, M.moves(r).map(m => h('span', {}, m ? D.moves[m] || '#' + m : '—'))))));
    }
    put($('#pane-party'),
      h('div', { class: 'row' }, h('div', { class: 'section-title' }, `Party (${n}/6)`), h('span', { class: 'grow' }),
        h('button', { class: 'btn', type: 'button', disabled: !n, title: 'Restore HP, cure status conditions and refill PP for every party Pokémon', onclick: healParty }, 'Heal party')),
      h('div', { class: 'party-cards' }, cards),
      h('p', { class: 'note' }, 'Click a Pokémon to edit it, or an empty slot to add one. "Move to box" in the editor puts a party Pokémon in a box.'));
  }
  // Lists every illegal Pokémon in the save; clicking jumps to the next one.
  function illegalButton() {
    if (hax) return null;
    const found = [];
    for (let i = 0; i < C.partyCount(sv); i++) if (illegal(C.partyRef(sv, i))) found.push([true, 0, i]);
    for (let b = 0; b < C.BOXES; b++) for (let s = 0; s < C.SLOTS; s++) if (illegal(C.boxRef(sv, b, s))) found.push([false, b, s]);
    if (!found.length) return h('span', { class: 'legal-count ok' }, '✓ All legal');
    return h('button', { class: 'btn legal-count bad', type: 'button', title: 'Go to the next illegal Pokémon', onclick: () => {
      const cur = found.findIndex(([p, b, s]) => p === sel.party && s === sel.slot && (p || b === sel.box));
      const [p, b, s] = found[(cur + 1) % found.length];
      if (p) { setTab('party'); select(true, 0, s); } else select(false, b, s);
    } }, `✕ ${found.length} illegal`);
  }
  function maxAllIvs() {
    let n = 0;
    change('Set perfect IVs on everything', () => {
      const fix = r => { if (filled(r) && M.ivs(r).some(v => v !== 31)) { M.setIvs(r, [31, 31, 31, 31, 31, 31]); n++; } };
      for (let i = 0; i < C.partyCount(sv); i++) fix(C.partyRef(sv, i));
      for (let b = 0; b < C.BOXES; b++) for (let s = 0; s < C.SLOTS; s++) fix(C.boxRef(sv, b, s));
      return n > 0;
    }, { full: true });
    status(n ? `Set perfect IVs on ${n} Pokémon.` : 'Every Pokémon already has perfect IVs.', n ? 'ok' : '');
  }

  // ── Editor ──
  const field = (text, control, extra) => h('label', { class: 'f' + (extra || '') }, h('span', {}, text), control);
  const natureOptions = cur => C.NATURES.map((n, i) => h('option', { value: i, selected: i === cur }, `${n} (${C.natureEffect(i)})`));
  const ballOptions = cur => C.BALLS.map((n, i) => h('option', { value: i, selected: i === cur }, n));
  const genderText = g => ['♂ Male', '♀ Female', 'Genderless'][g];

  function renderHero() {
    const r = selRef(), el = $('#hero');
    if (!el || !filled(r)) return;
    const sp = M.species(r), g = C.genderOf(D, r), lv = C.levelOf(D, r);
    const pic = sprite(sp, M.shiny(r), heroSize(), M.isEgg(r));
    el.replaceChildren(
      pic,
      h('div', { style: 'min-width:0' },
        h('div', { class: 'hero-name' }, h('h2', {}, M.nickname(r) || spName(sp)), M.isEgg(r) ? null : cryButton(sp, pic)),
        h('div', { class: 'sub' }, `${spName(sp)}${D.species[sp] && D.species[sp].nat ? ' · No. ' + D.species[sp].nat : ''} · ${sel.party ? 'Party slot ' + (sel.slot + 1) : C.boxName(sv, sel.box) + ', slot ' + (sel.slot + 1)}`),
        h('div', { class: 'chips' },
          h('span', { class: 'chip' }, lv ? 'Lv ' + lv : 'Lv ?'),
          h('span', { class: 'chip' }, ['♂', '♀', '⚲'][g]),
          h('span', { class: 'chip' }, C.NATURES[M.nature(r)]),
          M.shiny(r) ? h('span', { class: 'chip accent' }, '★ Shiny') : null,
          C.abilityName(X, r) ? h('span', { class: 'chip', title: ['Ability 1', 'Ability 2', 'Hidden ability'][M.abilityIndex(r)] }, C.abilityName(X, r))
            : M.hiddenAbility(r) ? h('span', { class: 'chip' }, 'Hidden ability') : null,
          M.isEgg(r) ? h('span', { class: 'chip' }, 'Egg') : null,
          h('span', { class: 'chip' }, C.BALLS[M.ball(r)] || 'Ball ?'))));
  }

  function renderEditor() {
    const ed = $('#editor');
    if (!sv) { ed.replaceChildren(); return; }
    const r = selRef();
    if (!filled(r)) {
      // An empty party slot adds to the end of the party (the game keeps the party packed).
      put(ed, addForm());
      return;
    }
    const tabs = [['main', 'Main'], ['moves', 'Moves'], ['stats', 'Stats'], ['origin', 'Origin'], ['showdown', 'Showdown']];
    put(ed,
      h('div', { class: 'hero', id: 'hero' }),
      legalityPanel(r),
      h('div', { class: 'subtabs', role: 'tablist' }, tabs.map(([k, t]) =>
        h('button', { class: 'subtab', role: 'tab', type: 'button', 'aria-selected': String(edTab === k), onclick: () => { edTab = k; renderEditor(); } }, t))),
      ...({ main: mainTab, moves: movesTab, stats: statsTab, origin: originTab, showdown: showdownTab }[edTab])(r).filter(Boolean),
      actionsRow(r));
    renderHero();
  }

  // Every editor change goes through here: party Pokémon get their battle stats recalculated afterwards.
  const X = window.RH_DEX;
  // Ability choices like PKHeX: the species' ability 1, ability 2 and hidden ability, by name.
  // A slot the species lacks is only listed when the Pokémon is already set to it; uses = the ability the game falls back to.
  const SLOT = ['1', '2', 'H'];
  function abilityOptions(sp, cur, uses) {
    const ab = X.species[sp] ? X.species[sp].ab : null;
    return [0, 1, 2].filter(i => !ab || ab[i] || i === cur).map(i => h('option', { value: i, selected: i === cur },
      ab && ab[i] ? `${ab[i]} (${SLOT[i]})` : `${['Ability 1', 'Ability 2', 'Hidden ability'][i]}${ab ? ` (none: it has ${uses || ab[0]})` : ''}`));
  }
  function edit(r, what, fn, opts) {
    return change(what, () => { const out = fn(); if (out !== false && r.party) C.recalcStats(D, X, r); return out; }, opts);
  }

  function legalityPanel(r) {
    if (hax) return null;
    const list = legal(r), errors = list.filter(p => p.level === 'error'), warns = list.filter(p => p.level === 'warn'), info = list.filter(p => p.level === 'info');
    if (!list.length) return h('div', { class: 'legal ok', role: 'status' }, h('strong', {}, '✓ Legal'), h('span', { class: 'note' }, 'Matches Radical Red\'s rules.'));
    const cls = errors.length ? 'bad' : warns.length ? 'warn' : 'info';
    const title = errors.length ? `✕ Illegal: ${errors.length} problem${errors.length > 1 ? 's' : ''}` : warns.length ? `! ${warns.length} thing${warns.length > 1 ? 's' : ''} to check` : 'Not checked';
    return h('div', { class: 'legal ' + cls, role: 'status' }, h('strong', {}, title),
      h('ul', {}, [...errors, ...warns, ...info].map(p => h('li', { class: p.level }, p.text))));
  }

  function mainTab(r) {
    const sp = M.species(r), ratio = C.genderRatio(D, sp), fixedGender = ratio === 0 || ratio >= 254, g = C.genderOf(D, r);
    const lv = C.levelOf(D, r);
    return [h('div', { class: 'form' },
      field('Species', picker({ id: 'ed-species', value: sp, options: speciesOpts(), icon: spriteIcon, kind: 'species', onPick: id => {
        const L = C.levelOf(D, r), wasDefault = M.nickname(r) === C.defaultNickname(D, sp);
        edit(r, `Changed species to ${spName(id)}`, () => {
          M.setSpecies(r, id);
          if (L && C.growth(D, id)) C.setLevel(D, r, L); // keep the level on the new growth curve
          if (wasDefault) M.setNickname(r, C.defaultNickname(D, id));
        }, { full: true });
      } }), ' wide'),
      field('Nickname', h('input', { id: 'ed-nick', type: 'text', maxlength: 10, value: M.nickname(r), onchange: e => {
        const v = e.target.value.trim() || C.defaultNickname(D, sp);
        if (!C.encodeText(v, 10)) { e.target.classList.add('bad'); status('That nickname uses a character the game cannot show.', 'err'); return; }
        edit(r, 'Renamed to ' + v, () => M.setNickname(r, v), { full: true });
      } })),
      field(lv ? 'Level' : 'Level (no data for this species)', h('input', { id: 'ed-level', type: 'number', min: 1, max: 100, value: lv || '', disabled: !lv, onchange: e => {
        const L = Math.max(1, Math.min(100, Math.round(+e.target.value) || 1));
        edit(r, 'Set level ' + L, () => C.setLevel(D, r, L), { full: true });
      } })),
      field('Nature', h('select', { id: 'ed-nature', onchange: e => edit(r, 'Set nature ' + C.NATURES[+e.target.value], () => C.setNatureShiny(r, +e.target.value, M.shiny(r), D), { full: true }) }, natureOptions(M.nature(r)))),
      field('Gender', h('select', { id: 'ed-gender', disabled: fixedGender, onchange: e => edit(r, 'Set gender', () => C.setGender(D, r, +e.target.value), { full: true }) },
        fixedGender ? h('option', {}, genderText(g)) : [0, 1].map(v => h('option', { value: v, selected: v === g }, genderText(v))))),
      field('Held item', picker({ id: 'ed-item', value: M.item(r), options: itemOpts(), none: 'None', kind: 'items',
        onPick: id => edit(r, id ? 'Gave ' + D.items[id] : 'Removed held item', () => M.setItem(r, id), { full: true }) })),
      field('Poké Ball', h('select', { id: 'ed-ball', onchange: e => edit(r, 'Set ball', () => M.setBall(r, +e.target.value), { full: true }) }, ballOptions(M.ball(r)))),
      field('Friendship', h('input', { id: 'ed-fr', type: 'number', min: 0, max: 255, value: M.friendship(r), onchange: e => {
        const v = Math.max(0, Math.min(255, Math.round(+e.target.value) || 0));
        edit(r, 'Set friendship ' + v, () => M.setFriendship(r, v), { full: true });
      } })),
      field('Ability', h('select', { id: 'ed-ability', onchange: e => {
        const i = +e.target.value;
        edit(r, `Set ability to ${(X.species[sp] && X.species[sp].ab[i]) || ['ability 1', 'ability 2', 'hidden ability'][i]}`, () => C.setAbility(D, r, i), { full: true });
      } }, abilityOptions(sp, M.abilityIndex(r), C.abilityName(X, r)))),
      h('label', { class: 'check' }, h('input', { id: 'ed-shiny', type: 'checkbox', checked: M.shiny(r), onchange: e => edit(r, e.target.checked ? 'Made shiny' : 'Made not shiny', () => C.setNatureShiny(r, M.nature(r), e.target.checked, D), { full: true, sfx: e.target.checked ? 'shiny' : 'ok' }) }), '★ Shiny')),
      sel.party ? h('p', { class: 'note' }, 'Battle stats are recalculated from Radical Red\'s base stats whenever you edit a party Pokémon.') : null];
  }

  // Move choices. Normal mode lists only moves the species can learn in Radical Red (the same list the legality
  // check uses) that are not already in another slot; RadicalHaX mode lists every move. The current move stays listed.
  function moveChoices(sp, mv, i) {
    if (hax || !X.species[sp]) return moveOpts();
    const set = C.learnable(X, sp);
    return moveOpts().filter(o => o.id === mv[i] || (set.has(o.id) && !mv.includes(o.id)));
  }
  const moveNote = sp => (hax ? 'RadicalHaX mode: every move is listed.'
    : X.species[sp] ? `Only moves ${spName(sp)} can learn in Radical Red are listed (level-up, TM, tutor, egg and pre-evolution moves). Turn on RadicalHaX mode for any move.`
      : `There is no Radical Red move data for ${spName(sp)}, so every move is listed.`);
  function movesTab(r) {
    const mv = M.moves(r), pp = M.movePp(r), sp = M.species(r);
    return [h('div', { class: 'form' }, mv.map((m, i) =>
      field(`Move ${i + 1}${pp && m ? ` · PP ${pp[i]}/${D.pp[m] || '?'}` : ''}`, picker({ id: 'ed-move' + i, value: m, options: moveChoices(sp, mv, i), none: 'None', kind: 'moves', bad: legal(r).some(p => p.field === 'move' + i), onPick: id => {
        const next = mv.slice(); next[i] = id;
        if (!next.some(x => x)) { status('A Pokémon needs at least one move.', 'err'); return; }
        edit(r, id ? 'Taught ' + D.moves[id] : 'Removed a move', () => M.setMoves(r, next, D), { full: true });
      } }), ' wide'))),
    h('p', { class: 'note' }, moveNote(sp) + ' Changing a move refills its PP and removes PP Ups for that slot.')];
  }

  // Highest EV stat i can have next to the others: 252 per stat and 510 in total, like the game.
  // RadicalHaX mode allows up to 255 (the most the save can store) with no total.
  const evCap = (evs, i) => (hax ? 255 : Math.max(0, Math.min(C.EV_CAP, C.EV_TOTAL - evs.reduce((a, b, k) => (k === i ? a : a + b), 0))));
  const evCapNote = (i, v) => `${C.STATS[i]} EV is ${v}, the most it can have: ${C.EV_CAP} per stat and ${C.EV_TOTAL} in total. RadicalHaX mode allows more.`;
  // onEv(i, value, capped): capped is true when the typed number was lowered to the limit.
  function statsGrid(ivs, evs, nature, onIv, onEv, values, idp) {
    // Nature indexes Atk/Def/Spe/SpA/SpD; grid rows are HP/Atk/Def/SpA/SpD/Spe.
    const up = Math.floor(nature / 5), down = nature % 5, rowOf = k => [1, 2, 5, 3, 4][k];
    const mark = i => (up === down ? '' : i === rowOf(up) ? ' up' : i === rowOf(down) ? ' down' : '');
    const g = h('div', { class: 'stats' }, h('span'), h('span', { class: 'h' }, 'IV'), h('span', { class: 'h' }, 'EV'), h('span', { class: 'h' }, values ? 'Stat' : ''));
    const cur = evs.slice(), evInputs = [];
    C.STATS.forEach((s, i) => {
      // max stops the arrows at the limit; a bigger typed number is lowered to it.
      const ev = h('input', { id: `${idp}-ev${i}`, type: 'number', min: 0, max: evCap(cur, i), value: evs[i], 'aria-label': s + ' EV', onchange: e => {
        const want = Math.max(0, Math.round(+e.target.value) || 0), v = Math.min(want, evCap(cur, i));
        e.target.value = v; cur[i] = v;
        evInputs.forEach((x, k) => { x.max = evCap(cur, k); });
        onEv(i, v, want > v);
      } });
      evInputs.push(ev);
      g.append(
        h('span', { class: 'name' + mark(i), title: mark(i) === ' up' ? 'Raised by nature' : mark(i) === ' down' ? 'Lowered by nature' : '' }, s),
        h('input', { id: `${idp}-iv${i}`, type: 'number', min: 0, max: 31, value: ivs[i], 'aria-label': s + ' IV', onchange: e => {
          const v = Math.max(0, Math.min(31, Math.round(+e.target.value) || 0)); e.target.value = v; onIv(i, v);
        } }),
        ev,
        h('span', { class: 'val' }, values ? values[i] : ''));
    });
    return g;
  }
  function statsTab(r) {
    const ivs = M.ivs(r), evs = M.evs(r), total = evs.reduce((a, b) => a + b, 0);
    return [
      statsGrid(ivs, evs, M.nature(r),
        (i, v) => { const x = M.ivs(r); x[i] = v; edit(r, `Set ${C.STATS[i]} IV to ${v}`, () => M.setIvs(r, x), { full: true }); },
        (i, v, capped) => { const x = M.evs(r); x[i] = v; edit(r, `Set ${C.STATS[i]} EV to ${v}`, () => M.setEvs(r, x), { full: true }); if (capped) status(evCapNote(i, v)); },
        M.partyStats(r), 'ed'),
      h('div', { class: 'row' },
        h('button', { class: 'btn small', type: 'button', onclick: () => edit(r, 'Set perfect IVs', () => M.setIvs(r, [31, 31, 31, 31, 31, 31]), { full: true }) }, 'Max IVs'),
        h('button', { class: 'btn small', type: 'button', onclick: () => edit(r, 'Cleared EVs', () => M.setEvs(r, [0, 0, 0, 0, 0, 0]), { full: true }) }, 'Clear EVs'),
        h('span', { class: 'grow' }),
        h('span', { class: total > C.EV_TOTAL ? 'warn' : 'note' }, `EV total ${total}/${C.EV_TOTAL}${total > C.EV_TOTAL ? ' — above the normal limit' : ''}`)),
      M.partyStats(r) ? h('div', { class: 'row' }, h('span', { class: 'note grow' }, 'The Stat column shows the party stats stored in the save.'),
        h('button', { class: 'btn small', type: 'button', onclick: () => {
          const before = M.partyStats(r).join();
          if (!change('Recalculated stats', () => C.recalcStats(D, X, r) && M.partyStats(r).join() !== before, { full: true })) status('Its stats are already up to date.');
        } }, 'Recalculate stats')) : null];
  }

  function originTab(r) {
    const t = C.trainer(sv), otid = M.otid(r), mine = (otid & 0xFFFF) === t.tid && (otid >>> 16) === t.sid;
    return [h('dl', { class: 'kv' },
      h('dt', {}, 'Original trainer'), h('dd', {}, `${M.otName(r)}${mine ? ' (you)' : ''}`),
      h('dt', {}, 'Trainer ID'), h('dd', {}, `${otid & 0xFFFF}  ·  SID ${otid >>> 16}`),
      h('dt', {}, 'Met at level'), h('dd', {}, String(M.metLevel(r))),
      h('dt', {}, 'Met location'), h('dd', {}, (window.RH_DEX.metNames[M.metLocation(r)] || 'Unknown') + ` (#${M.metLocation(r)})`),
      h('dt', {}, 'Experience'), h('dd', {}, M.exp(r).toLocaleString()),
      h('dt', {}, 'Personality'), h('dd', {}, M.pid(r).toString(16).toUpperCase().padStart(8, '0')),
      h('dt', {}, 'Ability'), h('dd', {}, `${C.abilityName(X, r) || '?'} (slot ${SLOT[M.abilityIndex(r)]})`))];
  }

  function showdownTab(r) {
    const text = C.toShowdown(D, r, X), ta = h('textarea', { id: 'ed-showdown', readonly: true, rows: 10 }, text);
    return [ta, h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: () => copy(text) }, 'Copy set'),
      h('span', { class: 'note' }, 'Paste it into Pokémon Showdown or into another RadicalHex box slot.'))];
  }
  async function copy(text) {
    try { await navigator.clipboard.writeText(text); status('Copied to the clipboard.', 'ok'); }
    catch { const t = $('#ed-showdown'); if (t) { t.select(); } status('Press Ctrl+C to copy the selected text.'); }
  }

  function firstEmpty(startBox) {
    for (let k = 0; k < C.BOXES; k++) { const b = (startBox + k) % C.BOXES; for (let s = 0; s < C.SLOTS; s++) if (!filled(C.boxRef(sv, b, s))) return [b, s]; }
    return null;
  }
  const firstEmptyIn = b => { for (let s = 0; s < C.SLOTS; s++) if (!filled(C.boxRef(sv, b, s))) return s; return -1; };
  // "Move to box…": any other box with room (a party Pokémon can go to any box). It goes into that box's first empty slot.
  function moveToBox(r) {
    const name = M.nickname(r) || spName(M.species(r));
    return h('select', { id: 'ed-movebox', 'aria-label': 'Move to another box', title: 'Move this Pokémon to the first empty slot of another box', onchange: e => {
      if (e.target.value === '') return;
      const b = +e.target.value, s = firstEmptyIn(b);
      if (s < 0) { status(`${C.boxName(sv, b)} is full.`, 'err'); renderEditor(); return; }
      const what = `Moved ${name} to ${C.boxName(sv, b)}`;
      if (sel.party) {
        const i = sel.slot;
        if (change(what, () => C.deposit(sv, D, i, C.boxRef(sv, b, s)), { full: true })) { box = b; setTab('boxes'); select(false, b, s); }
        else renderEditor(); // put the list back on "Move to box…"
      } else if (change(what, () => C.swap(r, C.boxRef(sv, b, s)), { full: true })) select(false, b, s);
      else renderEditor();
    } }, h('option', { value: '' }, 'Move to box…'),
    Array.from({ length: C.BOXES }, (_, b) => b).filter(b => sel.party || b !== sel.box).map(b => {
      const n = boxCount(b);
      return h('option', { value: b, disabled: n >= C.SLOTS }, `${C.boxName(sv, b)} (${n}/${C.SLOTS})${n >= C.SLOTS ? ' full' : ''}`);
    }));
  }
  function actionsRow(r) {
    const row = h('div', { class: 'row', style: 'border-top:1px solid var(--line);padding-top:12px' });
    const target = firstEmpty(sel.party ? box : sel.box);
    if (sel.party) {
      row.append(h('button', { class: 'btn', type: 'button', disabled: !target, onclick: () => {
        const [b, s] = target;
        if (change(`Copied to ${C.boxName(sv, b)}`, () => C.copyToBox(D, r, C.boxRef(sv, b, s)))) select(false, b, s);
      } }, 'Copy to a box'));
      row.append(moveToBox(r));
      const st = C.partyStatus(r);
      row.append(h('button', { class: 'btn', type: 'button', title: 'Restore HP, cure status conditions and refill PP', onclick: () => {
        if (!change(`Healed ${M.nickname(r)}`, () => C.heal(D, r), { full: true, sfx: 'heal' })) status(`${M.nickname(r)} is already fully healed.`);
      } }, st ? `Heal (${st.toLowerCase()})` : 'Heal'));
    } else {
      row.append(h('button', { class: 'btn', type: 'button', disabled: !target, onclick: () => {
        const [b, s] = target;
        if (change(`Cloned to ${C.boxName(sv, b)} slot ${s + 1}`, () => C.copyToBox(D, r, C.boxRef(sv, b, s)))) select(false, b, s);
      } }, 'Clone'));
      const full = C.partyCount(sv) >= 6;
      row.append(h('button', { class: 'btn', type: 'button', disabled: full, title: full ? 'Your party is full (6 Pokémon)' : 'Move this Pokémon to the end of your party', onclick: () => {
        let i = -1;
        if (change(`Moved ${M.nickname(r) || spName(M.species(r))} to the party`, () => { i = C.withdraw(sv, D, X, r); }, { full: true })) { setTab('party'); select(true, 0, i); }
      } }, 'Move to party'), moveToBox(r));
      const rel = h('button', { class: 'btn danger', type: 'button', onclick: () => {
        if (!rel.classList.contains('armed')) { rel.classList.add('armed'); rel.textContent = 'Click again to release'; return; }
        const name = M.nickname(r);
        if (change(`Released ${name}`, () => C.release(r), { sfx: 'release' })) select(false, sel.box, sel.slot);
      } }, 'Release');
      row.append(rel);
      const grave = nuz.graveBox(), spot = grave >= 0 && grave !== sel.box ? firstEmpty(grave) : null;
      if (grave >= 0 && grave !== sel.box) row.append(h('button', { class: 'btn', type: 'button', disabled: !spot || spot[0] !== grave, title: spot && spot[0] === grave ? 'Nuzlocke: move this fainted Pokémon to your graveyard box' : 'The graveyard box is full',
        onclick: () => { const [b, s] = spot; if (change(`Moved ${M.nickname(r)} to the graveyard`, () => C.swap(r, C.boxRef(sv, b, s)))) select(false, b, s); } }, 'Move to graveyard'));
    }
    row.append(h('span', { class: 'grow' }),
      ...(dexView.has(M.species(r)) ? [h('button', { class: 'link', type: 'button', onclick: () => openDex(M.species(r)) }, 'RadicalDex')] : []),
      h('button', { class: 'link', type: 'button', onclick: () => copy(C.toShowdown(D, r, X)) }, 'Copy Showdown set'));
    return row;
  }

  // ── Add a Pokémon (empty box slot) ──
  const newDraft = () => ({ species: 0, nickname: '', level: 50, nature: 0, gender: null, shiny: false, item: 0, ball: 3, friendship: 70,
    ability: 0, moves: [0, 0, 0, 0], ivs: [31, 31, 31, 31, 31, 31], evs: [0, 0, 0, 0, 0, 0], text: '' });
  function addForm() {
    if (!draft) draft = newDraft();
    const d = draft, ratio = d.species ? C.genderRatio(D, d.species) : 127, fixed = ratio === 0 || ratio >= 254;
    const rerender = () => queueEditor();
    const pickBad = (e, msg) => { e.target.classList.add('bad'); status(msg, 'err'); };
    const addPic = d.species ? sprite(d.species, d.shiny, heroSize()) : h('span', { class: 'spr none', style: `width:${heroSize()}px;height:${heroSize()}px;font-size:40px` });
    const sd = h('textarea', { id: 'add-sd', rows: 7, placeholder: 'Garchomp @ Choice Scarf\nLevel: 50\nJolly Nature\nEVs: 252 Atk / 4 SpD / 252 Spe\n- Earthquake\n- Outrage\n- Stone Edge\n- Fire Fang' }, d.text);
    return [
      h('div', { class: 'hero' }, addPic,
        h('div', {}, h('div', { class: 'hero-name' }, h('h2', {}, 'Add a Pokémon'), d.species ? cryButton(d.species, addPic) : null), h('div', { class: 'sub' }, sel.party ? `Party slot ${C.partyCount(sv) + 1}` : `${C.boxName(sv, sel.box)}, slot ${sel.slot + 1}`),
          h('p', { class: 'note', style: 'margin-top:6px' }, 'It will belong to you, met at Pallet Town, in the ball you choose.'))),
      h('details', { open: !!d.text }, h('summary', { style: 'cursor:pointer;font-weight:600' }, 'Paste a Showdown set'),
        h('div', { style: 'display:grid;gap:8px;margin-top:8px' }, sd,
          h('button', { class: 'btn small', type: 'button', style: 'justify-self:start', onclick: () => {
            d.text = sd.value;
            try {
              const { opts, warnings } = C.fromShowdown(D, sd.value, X);
              if (!addable(opts.species)) throw new Error(`${spName(opts.species)} cannot be added (battle-only form or missing level data).`);
              if (!hax && X.species[opts.species]) {
                const set = C.learnable(X, opts.species), cut = [...new Set(opts.moves.filter(m => m && !set.has(m)))];
                if (cut.length) warnings.push(`${spName(opts.species)} can't learn ${cut.map(m => D.moves[m]).join(', ')} in Radical Red, so ${cut.length > 1 ? 'they were' : 'it was'} left out (RadicalHaX mode keeps ${cut.length > 1 ? 'them' : 'it'}).`);
                opts.moves = packMoves(opts.moves, set);
                if (!opts.moves.some(x => x)) opts.moves = startMoves(opts.species, opts.level);
                const ev = C.clampEvs(opts.evs);
                if (ev.join() !== opts.evs.join()) { warnings.push(`EVs were lowered to the game's limits (${C.EV_CAP} per stat, ${C.EV_TOTAL} in total).`); opts.evs = ev; }
              }
              Object.assign(d, opts, { text: sd.value });
              status(warnings.length ? 'Set loaded. ' + warnings.join(' ') : 'Set loaded. Check it and press Add.', warnings.length ? '' : 'ok');
            } catch (e) { status(e.message, 'err'); }
            rerender();
          } }, 'Fill the form from this set'))),
      h('div', { class: 'form' },
        field('Species', picker({ id: 'add-species', value: d.species, options: speciesOpts(), icon: spriteIcon, kind: 'species', placeholder: 'Choose a Pokémon',
          onPick: id => {
            d.species = id; d.gender = null;
            if (X.species[id] && !X.species[id].ab[d.ability]) d.ability = 0; // the new species has no such ability
            if (!hax && X.species[id]) d.moves = packMoves(d.moves, C.learnable(X, id)); // keep only moves the new species can learn
            if (!d.moves.some(x => x)) d.moves = startMoves(id, d.level);
            rerender();
          } }), ' wide'),
        field('Nickname', h('input', { id: 'add-nick', type: 'text', maxlength: 10, value: d.nickname, placeholder: d.species ? C.defaultNickname(D, d.species) : 'Species name', onchange: e => {
          if (e.target.value && !C.encodeText(e.target.value, 10)) return pickBad(e, 'That nickname uses a character the game cannot show.');
          d.nickname = e.target.value.trim();
        } })),
        field('Level', h('input', { id: 'add-level', type: 'number', min: 1, max: 100, value: d.level, onchange: e => { d.level = Math.max(1, Math.min(100, Math.round(+e.target.value) || 1)); e.target.value = d.level; } })),
        field('Nature', h('select', { id: 'add-nature', onchange: e => { d.nature = +e.target.value; rerender(); } }, natureOptions(d.nature))),
        field('Gender', h('select', { id: 'add-gender', disabled: fixed, onchange: e => { d.gender = e.target.value === '' ? null : +e.target.value; } },
          fixed ? h('option', {}, ratio === 0 ? genderText(0) : ratio === 254 ? genderText(1) : genderText(2))
            : [h('option', { value: '' }, 'Random'), ...[0, 1].map(v => h('option', { value: v, selected: d.gender === v }, genderText(v)))])),
        field('Held item', picker({ id: 'add-item', value: d.item, options: itemOpts(), none: 'None', kind: 'items', onPick: id => { d.item = id; rerender(); } })),
        field('Poké Ball', h('select', { id: 'add-ball', onchange: e => { d.ball = +e.target.value; } }, ballOptions(d.ball))),
        field('Friendship', h('input', { id: 'add-fr', type: 'number', min: 0, max: 255, value: d.friendship, onchange: e => { d.friendship = Math.max(0, Math.min(255, Math.round(+e.target.value) || 0)); } })),
        h('label', { class: 'check' }, h('input', { id: 'add-shiny', type: 'checkbox', checked: d.shiny, onchange: e => { d.shiny = e.target.checked; rerender(); } }), '★ Shiny'),
        field('Ability', h('select', { id: 'add-ability', disabled: !d.species, onchange: e => { d.ability = +e.target.value; } },
          d.species ? abilityOptions(d.species, d.ability) : h('option', {}, 'Choose a species first'))),
        ...d.moves.map((m, i) => field(`Move ${i + 1}${i ? '' : ' (required)'}`, picker({ id: 'add-move' + i, value: m, options: d.species ? moveChoices(d.species, d.moves, i) : [], none: d.species ? 'None' : null, kind: 'moves',
          disabled: !d.species, placeholder: 'Choose a species first', onPick: id => { d.moves[i] = id; rerender(); } }))),
        d.species ? h('p', { class: 'note', style: 'grid-column:1 / -1' }, moveNote(d.species)) : null),
      statsGrid(d.ivs, d.evs, d.nature, (i, v) => { d.ivs[i] = v; }, (i, v, capped) => { d.evs[i] = v; if (capped) status(evCapNote(i, v)); }, null, 'add'),
      h('div', { class: 'row', style: 'border-top:1px solid var(--line);padding-top:12px' },
        h('button', { class: 'btn primary', type: 'button', onclick: create }, sel.party ? 'Add to party' : 'Add to box'),
        h('button', { class: 'btn', type: 'button', onclick: () => { draft = newDraft(); rerender(); } }, 'Clear form'))];
  }
  // Keeps the moves in the set, without duplicates, moved up to fill the first slots.
  function packMoves(moves, set) {
    const kept = moves.filter((m, i) => m && set.has(m) && moves.indexOf(m) === i);
    return [0, 1, 2, 3].map(i => kept[i] || 0);
  }
  // The last four level-up moves it knows by its level, like a wild Pokémon. Megas and other form changes use their base form's.
  function startMoves(id, level) {
    let x = X.species[id];
    if (x && !x.lv.length) { const base = Object.keys(X.species).find(k => X.species[k].evo.some(e => e[0] === id && e[2])); if (base) x = X.species[base]; }
    const seen = [];
    for (const [m, lv] of x ? x.lv : []) if (m && lv <= level && C.validMove(D, m) && !seen.includes(m)) seen.push(m);
    const last = seen.slice(-4);
    return [0, 1, 2, 3].map(i => last[i] || 0);
  }
  function create() {
    const d = draft;
    if (!d.species) { status('Choose a species first.', 'err'); return; }
    if (!d.moves.some(x => x)) { status('Give it at least one move.', 'err'); return; }
    const name = spName(d.species);
    if (sel.party) {
      let i = -1;
      if (change(`Added ${name} to the party`, () => { i = C.createInParty(sv, D, X, d); }, { full: true, sfx: 'ball' })) { draft = null; edTab = 'main'; select(true, 0, i); }
      return;
    }
    if (change(`Added ${name} to ${C.boxName(sv, sel.box)}`, () => C.createInBox(sv, D, C.boxRef(sv, sel.box, sel.slot), d), { full: true, sfx: 'ball' })) {
      draft = null;
      edTab = 'main';
    }
  }

  // ── Trainer & bag pane ──
  function renderTrainer() {
    const t = C.trainer(sv), dx = C.dex.count(sv), p = C.POCKETS.find(x => x.key === pocket), items = C.readPocket(sv, p);
    const qtyMax = p.max;
    const setPocket = (what, list) => change(what, () => C.writePocket(sv, p, list), { full: false });
    const rows = items.map((it, k) => h('tr', {},
      h('td', {}, picker({ id: `bag-${p.key}-${k}`, value: it.id, kind: 'items', options: pocketOpts(p.key).filter(o => o.id === it.id || !items.some(x => x.id === o.id)), onPick: id => {
        const list = items.slice(); list[k] = { id, qty: Math.min(it.qty, qtyMax) }; setPocket(`Changed to ${D.items[id]}`, list);
      } })),
      h('td', { class: 'qty' }, h('input', { id: `bagq-${p.key}-${k}`, type: 'number', min: 1, max: qtyMax, value: it.qty, disabled: qtyMax === 1, onchange: e => {
        const q = Math.max(1, Math.min(qtyMax, Math.round(+e.target.value) || 1)); const list = items.slice(); list[k] = { id: it.id, qty: q };
        setPocket(`Set ${D.items[it.id]} to ${q}`, list);
      } })),
      h('td', { class: 'x' }, h('button', { class: 'iconbtn', type: 'button', title: 'Remove', 'aria-label': 'Remove ' + D.items[it.id], onclick: () => setPocket('Removed ' + D.items[it.id], items.filter((_, j) => j !== k)) }, '×'))));
    const addQty = h('input', { id: 'bag-add-qty', type: 'number', min: 1, max: qtyMax, value: qtyMax === 1 ? 1 : Math.min(99, qtyMax), disabled: qtyMax === 1, 'aria-label': 'Quantity to add' });
    const addItem = id => {
      const q = Math.max(1, Math.min(qtyMax, Math.round(+addQty.value) || 1));
      const list = items.slice(), at = list.findIndex(x => x.id === id);
      if (at >= 0) list[at] = { id, qty: Math.min(qtyMax, list[at].qty + q) }; else list.push({ id, qty: q });
      if (list.length > p.cap) { status(`${p.name} is full (${p.cap} different items).`, 'err'); return; }
      setPocket(`Added ${q} × ${D.items[id]}`, list);
    };
    const all = D.items.map((n, i) => i).filter(i => i && C.validItem(D, i) && C.pocketOf(D, i) === p.key);
    const fillAll = () => {
      const list = items.slice();
      for (const id of all) if (!list.some(x => x.id === id) && list.length < p.cap) list.push({ id, qty: qtyMax === 1 ? 1 : 99 });
      setPocket(`Added every ${p.name === 'TMs & HMs' ? 'TM and HM' : p.name.toLowerCase().replace(/s$/, '')}`, list);
    };
    put($('#pane-trainer'),
      h('div', { class: 'cards' },
        h('div', { class: 'card' }, h('h3', {}, 'Trainer'),
          h('dl', { class: 'kv' }, h('dt', {}, 'Name'), h('dd', {}, t.name), h('dt', {}, 'Gender'), h('dd', {}, t.gender ? 'Girl' : 'Boy'),
            h('dt', {}, 'Trainer ID'), h('dd', {}, String(t.tid).padStart(5, '0')), h('dt', {}, 'Secret ID'), h('dd', {}, String(t.sid).padStart(5, '0')))),
        h('div', { class: 'card' }, h('h3', {}, 'Money'),
          field(`Money (max ₽${C.MONEY_MAX.toLocaleString()})`, h('input', { id: 'tr-money', type: 'number', min: 0, max: C.MONEY_MAX, value: Math.min(t.money, C.MONEY_MAX), onchange: e => {
            const v = Math.max(0, Math.min(C.MONEY_MAX, Math.round(+e.target.value) || 0)); change(`Set money to ₽${v.toLocaleString()}`, () => C.setMoney(sv, v));
          } })),
          field(`Game Corner coins (max ${C.COINS_MAX.toLocaleString()})`, h('input', { id: 'tr-coins', type: 'number', min: 0, max: C.COINS_MAX, value: Math.min(t.coins, C.COINS_MAX), onchange: e => {
            const v = Math.max(0, Math.min(C.COINS_MAX, Math.round(+e.target.value) || 0)); change(`Set coins to ${v}`, () => C.setCoins(sv, v));
          } })),
          h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: () => change('Set money to the maximum', () => C.setMoney(sv, C.MONEY_MAX)) }, 'Max money'),
            h('button', { class: 'btn small', type: 'button', onclick: () => change('Set coins to the maximum', () => C.setCoins(sv, C.COINS_MAX)) }, 'Max coins')),
          t.money > C.MONEY_MAX ? h('p', { class: 'note' }, `This save currently has ₽${t.money.toLocaleString()}. It is left as is unless you change it.`) : null),
        h('div', { class: 'card' }, h('h3', {}, 'Pokédex'),
          h('dl', { class: 'kv' }, h('dt', {}, 'Seen'), h('dd', {}, String(dx.seen)), h('dt', {}, 'Caught'), h('dd', {}, String(dx.caught))),
          h('button', { class: 'btn small', type: 'button', style: 'justify-self:start', onclick: () => change('Registered every Pokémon you own in the Pokédex', () => {
            let n = 0;
            const reg = r => { if (filled(r) && D.species[M.species(r)] && D.species[M.species(r)].nat) { const nat = D.species[M.species(r)].nat; if (!C.dex.caught(sv, nat)) n++; C.dex.register(sv, nat); } };
            for (let i = 0; i < C.partyCount(sv); i++) reg(C.partyRef(sv, i));
            for (let b = 0; b < C.BOXES; b++) for (let s = 0; s < C.SLOTS; s++) reg(C.boxRef(sv, b, s));
            return n > 0;
          }) }, 'Register everything you own'),
          h('p', { class: 'note' }, 'Pokémon added with RadicalHex are registered as caught automatically.'))),
      h('div', { class: 'section-title' }, 'Bag'),
      h('div', { class: 'pockets' }, C.POCKETS.map(x => h('button', { class: 'pocket', type: 'button', 'aria-pressed': String(x.key === pocket), onclick: () => { pocket = x.key; renderTrainer(); } },
        `${x.name} ${C.readPocket(sv, x).length}/${x.cap}`))),
      h('table', { class: 'bag' }, h('thead', {}, h('tr', {}, h('th', {}, 'Item'), h('th', {}, 'Quantity'), h('th', {}))),
        h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: 3, class: 'note' }, 'This pocket is empty.')),
          h('tr', { class: 'add-row' }, h('td', {}, picker({ id: 'bag-add', value: 0, kind: 'items', options: pocketOpts(p.key), placeholder: `＋ Add an item to ${p.name}`, onPick: addItem })),
            h('td', { class: 'qty' }, addQty), h('td', {})))),
      p.key !== 'items' && p.key !== 'key' ? h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: fillAll }, p.key === 'tms' ? 'Add every TM and HM' : p.key === 'balls' ? 'Add every ball (99 each)' : 'Add every berry (99 each)')) : null,
      h('p', { class: 'note' }, p.key === 'key' ? 'Key items can change story events. Only add ones you know are safe for your progress.' : `Up to ${p.cap} different items, ${qtyMax === 1 ? 'one of each' : 'at most 999 of each'}.`));
  }

  // ── Backups pane ──
  let backupWhere = ''; // the backups folder, from the desktop app
  if (host && host.backupDir) host.backupDir().then(d => { backupWhere = d; }).catch(() => {});
  async function renderBackups() {
    const pane = $('#pane-backups');
    if (!host) {
      pane.replaceChildren(h('div', { class: 'card', style: 'max-width:640px' }, h('h3', {}, 'Backups'),
        h('p', { class: 'note' }, 'In the desktop app, RadicalHex keeps a backup every time you open or save. In a browser, download a copy of the original file instead.'),
        h('button', { class: 'btn', type: 'button', style: 'justify-self:start', onclick: () => download(sv.original, fileName.replace(/(\.\w+)?$/, ' (backup)$1')) }, 'Download the original file')));
      return;
    }
    let list = [];
    try { list = await host.listBackups(); } catch (e) { status(e.message, 'err'); }
    if (tab !== 'backups') return; // switched tabs while the list was loading
    put(pane,
      h('div', { class: 'row' }, h('h3', {}, 'Backups'), h('span', { class: 'grow' }),
        h('button', { class: 'btn', type: 'button', onclick: async () => { try { await host.backupNow(sv.original); status('Backed up the file as it is on disk.', 'ok'); renderBackups(); } catch (e) { status(e.message, 'err'); } } }, 'Back up now'),
        h('button', { class: 'btn', type: 'button', onclick: () => host.showBackups() }, 'Open backups folder')),
      h('p', { class: 'note' }, `Stored in ${backupWhere || 'the Backups folder next to RadicalHex.exe'}. A new backup is made when you open a save and right before every Save, unless the file has not changed since the last backup.`
        + (list.some(b => b.old) ? ' Backups marked "older" are from earlier versions, which kept them in Documents\\RadicalHex\\Backups.' : '')),
      list.length ? h('table', { class: 'backups' }, h('thead', {}, h('tr', {}, h('th', {}, 'File'), h('th', {}, 'Made'), h('th', {}, 'Size'), h('th', {}))),
        h('tbody', {}, list.map(b => h('tr', {}, h('td', {}, b.name, b.old ? h('span', { class: 'chip', style: 'margin-left:8px' }, 'older') : null), h('td', { class: 'mono' }, new Date(b.time).toLocaleString()), h('td', { class: 'mono' }, Math.round(b.size / 1024) + ' KB'),
          h('td', {}, h('button', { class: 'btn small', type: 'button', onclick: () => restoreBackup(b) }, 'Restore')))))) : h('p', { class: 'note' }, 'No backups yet.'));
  }
  async function restoreBackup(b) {
    const choice = await modal('Restore this backup?', `${b.name}\n\nThis writes the backup over ${fileName}${dirty ? ' and discards your unsaved changes' : ''}. The current file is backed up first, so you can undo this from here too.`, [{ text: 'Cancel' }, { text: 'Restore', primary: true }]);
    if (choice !== 1) return;
    try {
      const bytes = await host.readBackup(b.path);
      const next = C.load(bytes); // only real Radical Red saves are restored
      await host.save(bytes);     // main backs up the current file before writing
      sv = next; undo = []; dirty = 0; draft = null;
      renderAll();
      status(`Restored ${b.name} to ${fileName}.`, 'ok');
    } catch (e) { showError('Could not restore that backup', e); }
  }

  // ── Open / save ──
  async function confirmDiscard() {
    if (!dirty) return true;
    return (await modal('Discard unsaved changes?', `You have ${dirty} unsaved change${dirty === 1 ? '' : 's'} in ${fileName}.`, [{ text: 'Cancel' }, { text: 'Discard', primary: true }])) === 1;
  }
  function openBytes(bytes, name) {
    let next;
    try { next = C.load(bytes); } catch (e) {
      if (sv) showError('Could not open ' + name, e); else { $('#welcomeMsg').textContent = e.message; }
      return;
    }
    sv = next; fileName = name; undo = []; dirty = 0; draft = null;
    sel = { party: C.partyCount(sv) > 0, box: 0, slot: 0 }; box = 0;
    $('#welcome').hidden = true; $('#app').hidden = false; $('#app').classList.remove('dex-only');
    if (tab === 'dex' && dexOnly) tab = 'boxes';
    dexOnly = false;
    if (host) host.setDirty(false).catch(() => {});
    renderAll();
    status(`Opened ${name}.${host ? ` A backup was saved in ${backupWhere || 'the Backups folder next to RadicalHex.exe'}.` : ''}`, 'ok');
    S.play('ok');
  }
  async function open() {
    if (!(await confirmDiscard())) return;
    if (!host) { $('#fileInput').click(); return; }
    try { const r = await host.openSave(); if (r) openBytes(r.bytes, r.name); } catch (e) { showError('Could not open the file', e); }
  }
  async function openDropped(file) {
    if (!file || !(await confirmDiscard())) return;
    if (host) { try { const r = await host.openFile(file); openBytes(r.bytes, r.name); } catch (e) { showError('Could not open the file', e); } }
    else openBytes(new Uint8Array(await file.arrayBuffer()), file.name);
  }
  function download(bytes, name) {
    const a = h('a', { href: URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' })), download: name });
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  async function save(as) {
    if (!sv) return;
    let bytes;
    try { bytes = C.build(sv, D); } catch (e) { showError('Save stopped', e); return; }
    try {
      let where;
      if (host) { where = as ? await host.saveAs(bytes) : await host.save(bytes); if (!where) return; }
      else { where = fileName.replace(/(\.\w+)?$/, ' (edited)$1'); download(bytes, where); }
      const keep = sel;
      sv = C.load(bytes); undo = []; dirty = 0; sel = keep;
      if (host && as) fileName = where.split(/[\\/]/).pop();
      renderAll();
      status(host ? `Saved ${where}. The previous version is in Backups.` : `Downloaded ${where}. Your original file was not changed.`, 'ok');
      S.play('save');
    } catch (e) { showError('Could not save', e); }
  }

  // ── Wiring ──
  const PANES = ['boxes', 'party', 'trainer', 'dex', 'nuzlocke', 'backups'];
  let dexOnly = false;
  function renderPane() {
    if (tab === 'boxes') renderBoxes(); else if (tab === 'party') renderParty(); else if (tab === 'trainer') renderTrainer();
    else if (tab === 'dex') dexView.render($('#pane-dex')); else if (tab === 'nuzlocke') nuz.render($('#pane-nuzlocke')); else renderBackups();
    trim();
  }
  function setTab(k) {
    tab = k;
    for (const b of document.querySelectorAll('.tab')) b.setAttribute('aria-selected', String(b.dataset.tab === k));
    // Hidden tabs are emptied, so only the open tab's page (and its sprites) is kept in memory.
    for (const p of PANES) { const el = $('#pane-' + p); el.hidden = p !== k; if (p !== k) el.replaceChildren(); }
    renderPane();
  }
  // Ask the window to drop images that are no longer shown, a moment after things settle.
  let trimTimer = 0;
  function trim() { if (!host || !host.trimMemory) return; clearTimeout(trimTimer); trimTimer = setTimeout(() => host.trimMemory(), 1500); }
  function renderAll() { renderHeader(); setTab(tab); renderEditor(); }
  function openDex(id) { setTab('dex'); dexView.show(id); }
  // Shared with radicaldex.js and nuzlocke.js.
  const ui = { h, put, sprite, cryButton, D, save: () => sv, select: (party, b, s) => select(party, b, s), refresh: () => { renderHeader(); renderEditor(); }, openDex, trim };
  const dexView = window.RHDexView(ui), nuz = window.RHNuzlocke(ui);
  $('#btnDex').onclick = () => {
    dexOnly = true;
    $('#welcome').hidden = true; $('#app').hidden = false; $('#app').classList.add('dex-only');
    setTab('dex');
  };

  // Sounds: a tiny blip for clicks (each control kind has its own), on/off button in the top bar.
  document.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || b.disabled || b.matches('.cry, #btnSound')) return;
    S.play(b.matches('.tab, .subtab, .pocket') ? 'tab' : b.matches('.slot, .pcard, .dex-row, .mon-chip, .nz-mon') ? 'select' : b.matches('.pick') ? 'open' : 'tick');
  }, true);
  function renderSound() {
    const b = $('#btnSound');
    b.replaceChildren(svgIcon(S.isOn() ? SPEAKER : SPEAKER_OFF));
    b.title = S.isOn() ? 'Sounds are on. Click to turn them off (cries still play when you ask for one).' : 'Sounds are off. Click to turn them on.';
    b.setAttribute('aria-label', S.isOn() ? 'Turn sounds off' : 'Turn sounds on');
    b.setAttribute('aria-pressed', String(S.isOn()));
  }
  $('#btnSound').onclick = () => { S.setOn(!S.isOn()); renderSound(); S.play('ok'); };
  renderSound();

  function renderHax() {
    const b = $('#btnHax');
    b.textContent = hax ? 'RadicalHaX mode' : 'Legality checks on';
    b.classList.toggle('hax', hax);
    b.title = hax ? 'Illegal Pokémon allowed and not checked. Save safety checks still run. Click to turn legality checks back on.'
      : 'Pokémon are checked against Radical Red\'s rules. Click for RadicalHaX mode (anything goes).';
    document.body.classList.toggle('hax-on', hax);
  }
  $('#btnHax').onclick = () => {
    hax = !hax;
    S.play(hax ? 'hax' : 'ok');
    try { localStorage.setItem('radicalhex-hax', hax ? '1' : '0'); } catch { /* not remembered */ }
    OPTS = {}; // species list changes with the mode
    renderHax();
    if (sv) { renderPane(); renderEditor(); }
    status(hax ? 'RadicalHaX mode: anything goes. RadicalHex still stops saves that would damage the file.' : 'Legality checks are on.');
  };
  renderHax();
  $('#btnOpen').onclick = open;
  $('#btnOpen2').onclick = open;
  $('#btnSave').onclick = () => save(false);
  $('#btnSaveAs').onclick = () => save(true);
  $('#btnUndo').onclick = doUndo;
  for (const b of document.querySelectorAll('.tab')) b.onclick = () => setTab(b.dataset.tab);
  $('#fileInput').onchange = async e => { const f = e.target.files[0]; e.target.value = ''; if (f) openBytes(new Uint8Array(await f.arrayBuffer()), f.name); };
  const drop = $('#drop');
  document.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('Files')) { e.preventDefault(); drop.classList.add('over'); } });
  document.addEventListener('dragleave', e => { if (!e.relatedTarget) drop.classList.remove('over'); });
  document.addEventListener('drop', e => { if (!e.dataTransfer.files.length) return; e.preventDefault(); drop.classList.remove('over'); openDropped(e.dataTransfer.files[0]); });
  document.addEventListener('keydown', e => {
    if (!e.ctrlKey || e.altKey) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); save(e.shiftKey); }
    else if (k === 'o') { e.preventDefault(); open(); }
    else if (k === 'z' && !/^(INPUT|TEXTAREA)$/.test(document.activeElement.tagName)) { e.preventDefault(); doUndo(); }
  });
  if (!host) $('#btnSave').textContent = 'Download';
  renderHeader();
  window.RadicalHex = { openBytes }; // used by tests
})();
