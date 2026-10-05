// RadicalHex window: storage view, Pokémon editor, trainer & bag, backups.
(() => {
  'use strict';
  // Two games: Radical Red (CFRU) and SoulGold (pokeemerald-expansion). Each has its own save core, data and dex, picked
  // from the save that is opened; nothing is shared between them, so no species, move or item crosses over.
  const GAMES = {
    rr: { key: 'rr', C: window.RHCore, D: window.RH_DATA, X: window.RH_DEX, name: 'Radical Red', full: 'Radical Red 4.1', dexName: 'RadicalDex',
      assets: 'assets', specialMet: i => i >= 253, metMax: 255, defaultMet: 88 },
  };
  if (window.SGCore && window.SG_DATA && window.SG_DEX) GAMES.sg = { key: 'sg', C: window.SGCore, D: window.SG_DATA, X: window.SG_DEX, name: 'SoulGold',
    full: 'SoulGold', dexName: 'SoulDex', assets: 'assets/sg', specialMet: i => i >= 0x7FFD, metMax: 0x7FFF, defaultMet: 232 };
  let G = GAMES.rr, C = G.C, D = G.D, M = C.mon, X = G.X;
  const S = window.RHSound;
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
  // Radical Red's Minimal Grinding mode: the game keeps every IV at 31 and gives no EVs.
  const minGrind = () => !!(sv && C.modes && C.modes(sv).minGrind);
  const ivEvLocked = () => minGrind() && !hax;
  const MG_NOTE = 'Minimal Grinding mode is on in this save: the game keeps every IV at 31 and gives no EVs, so IVs and EVs are locked. Turn on RadicalHaX mode to edit them anyway.';
  const mgIssues = r => {
    if (!minGrind() || M.isEgg(r)) return [];
    const out = [];
    if (M.ivs(r).some(v => v !== 31)) out.push({ level: 'warn', text: 'This save uses Minimal Grinding mode, where every IV is 31, but this Pokémon has lower IVs.', field: 'ivs' });
    if (M.evs(r).some(v => v)) out.push({ level: 'warn', text: 'This save uses Minimal Grinding mode, where Pokémon get no EVs, but this one has EVs.', field: 'evs' });
    return out;
  };
  const stoneIssue = r => (deadStone(M.item(r)) ? [{ level: 'warn', text: `${D.items[M.item(r)]} doesn't Mega Evolve anything in ${G.name}. Its Megas use a stone for each type (like the Watertite) or the Bondstone.`, field: 'item' }] : []);
  const legal = r => (hax || !r || M.empty(r) ? [] : C.legality(D, X, r).concat(mgIssues(r), stoneIssue(r)));
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
    return h('img', { class: 'spr', src: `${G.assets}/sprites/${shiny ? 'shiny/' : ''}${s.s}.png`, width: size, height: size, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' });
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

  // Item icons: the game's own 24x24 bag graphics, one PNG per item id.
  function itemIcon(id, size = 24) {
    if (!id || !C.validItem(D, id)) return null;
    return h('img', { class: 'item-icon', src: `${G.assets}/items/${id}.png`, width: size, height: size, alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' });
  }
  const spriteIcon = (id, size) => sprite(id, false, size);

  // ── Pickers: a button that opens a scrollable list. Typing to filter is optional. ──
  let OPTS = {};
  const speciesOpts = () => OPTS.species || (OPTS.species = D.species.map((s, i) => (addable(i) ? { id: i, label: s.n } : null)).filter(Boolean));
  // SoulGold keeps the official Mega Stones in its item list, but only its type stones and the Bondstone Mega Evolve
  // anything. With legality checks on, the leftovers are not offered.
  const deadStone = id => !!X.megaStones && C.pocketOf(D, id) === 'megas' && !X.megaStones.includes(id);
  const itemOpts = () => OPTS.items || (OPTS.items = D.items.map((n, i) => (i && C.validItem(D, i) && (hax || !deadStone(i)) ? { id: i, label: n } : null)).filter(Boolean));
  const moveOpts = () => OPTS.moves || (OPTS.moves = D.moves.map((n, i) => (i && n ? { id: i, label: n } : null)).filter(Boolean));
  const pocketOpts = key => OPTS['p-' + key] || (OPTS['p-' + key] = itemOpts().filter(o => C.pocketOf(D, o.id) === key));
  const nameIn = (list, id) => (list === 'species' ? spName(id) : (list === 'items' ? D.items[id] : D.moves[id]) || '#' + id);

  // value: current id (0 = none). none: label for the empty choice, or null when an empty choice is not allowed.
  // icon: optional (id, size) => element, shown next to each choice (species sprites, item icons).
  // bad: 'error' (red) or 'warn' (amber) outline; true means 'error'.
  // Move type and category (physical / special / status), from the game's own move data.
  const CATS = ['Physical', 'Special', 'Status'];
  let typeMap = null, typeMapFor = null;
  const moveType = id => {
    if (typeMapFor !== X) { typeMap = new Map((X.types || []).map(t => [t.id, t])); typeMapFor = X; }
    return (X.mt && typeMap.get(X.mt[id])) || null;
  };
  const moveInfo = id => { const t = moveType(id), c = X.ms ? CATS[X.ms[id]] : null; return [t ? t.n : '', c || ''].filter(Boolean).join(' · '); };
  // A species' one or two types, small, for the species list.
  function speciesTag(id) {
    const x = X.species[id];
    if (!x) return null;
    if (typeMapFor !== X) moveType(0);
    const ts = x.t.map(t => typeMap.get(t)).filter(Boolean);
    return ts.length ? h('span', { class: 'mtag' }, ts.map(t => h('span', { class: 'mtype', style: `--type:${t.c}` }, t.n))) : null;
  }
  function moveTag(id) {
    const t = moveType(id), c = X.ms ? CATS[X.ms[id]] : null;
    if (!id || (!t && !c)) return null;
    return h('span', { class: 'mtag', title: moveInfo(id) },
      t ? h('span', { class: 'mtype', style: `--type:${t.c}` }, t.n) : null,
      c ? h('span', { class: 'mcat' }, c === 'Status' ? 'Status' : c.slice(0, 4) + '.') : null);
  }
  function picker({ id, value, options, none = null, placeholder = 'Choose…', icon = null, kind, onPick, bad = false, disabled = false }) {
    if (!icon && kind === 'items') icon = itemIcon;
    const btn = h('button', { id, type: 'button', class: 'pick' + (bad === 'warn' ? ' warnb' : bad ? ' bad' : ''), 'aria-haspopup': 'listbox', disabled },
      icon && value ? icon(value, 24) : null,
      h('span', { class: 'pick-label' + (value ? '' : ' muted') }, value ? nameIn(kind, value) : none || placeholder),
      kind === 'moves' && value ? moveTag(value) : null,
      value ? h('span', { class: 'pick-id' }, '#' + value) : null,
      h('span', { class: 'pick-caret', 'aria-hidden': 'true' }, '▾'));
    btn.addEventListener('click', () => openList(btn, value, none ? [{ id: 0, label: none }, ...options] : options, icon, onPick, kind === 'moves' ? moveTag : kind === 'species' ? speciesTag : null, kind));
    return btn;
  }
  let pop = null;
  const closeList = () => { if (pop) { pop.remove(); pop = null; } };
  function openList(btn, value, all, icon, onPick, tag = null, kind = '') {
    closeList();
    const search = h('input', { type: 'text', class: 'pop-search', placeholder: 'Scroll the list, or type to filter', 'aria-label': 'Filter the list', autocomplete: 'off' });
    const list = h('div', { class: 'pop-list', role: 'listbox' });
    let shown = all, active = Math.max(0, all.findIndex(o => o.id === value));
    const choose = o => { closeList(); btn.focus(); S.play('pick'); if (o.id !== value) onPick(o.id); };
    const draw = () => list.replaceChildren(...shown.map((o, k) => {
      const row = h('div', { class: 'pop-row' + (o.id === value ? ' cur' : '') + (k === active ? ' act' : ''), role: 'option', 'aria-selected': String(o.id === value) },
        icon ? (o.id && icon(o.id, icon === itemIcon ? 24 : 32)) || h('span', { style: `width:${icon === itemIcon ? 24 : 32}px;flex:none` }) : null,
        h('span', { class: 'grow' }, o.label), tag && o.id ? tag(o.id) : null, o.id ? h('span', { class: 'pick-id' }, '#' + o.id) : null);
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
        && (!q || squash(o.label).includes(q) || (n && String(o.id) === n))
        && (!o.id || (kind === 'species' ? (mType < 0 || (X.species[o.id] && X.species[o.id].t.includes(mType)))
          : kind !== 'moves' || ((mType < 0 || X.mt[o.id] === mType) && (mCat < 0 || X.ms[o.id] === mCat)))));
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
    // Move lists: filter by type (only the types in this list, with how many) and by category.
    let mType = -1, mCat = -1, moveBar = null;
    if ((kind === 'moves' && X.mt && X.ms) || kind === 'species') {
      const counts = new Map(), typesOf = id => (kind === 'species' ? (X.species[id] ? X.species[id].t : []) : [X.mt[id]]);
      for (const o of all) if (o.id) for (const t of typesOf(o.id)) counts.set(t, (counts.get(t) || 0) + 1);
      const typeSel = h('select', { class: 'pop-type', 'aria-label': kind === 'species' ? 'Pokémon type' : 'Move type', onmousedown: e => e.stopPropagation(), onchange: e => { mType = +e.target.value; refilter(); search.focus(); } },
        h('option', { value: -1 }, 'All types'), (X.types || []).filter(t => counts.has(t.id)).map(t => h('option', { value: t.id }, `${t.n} (${counts.get(t.id)})`)));
      const cats = kind !== 'moves' ? null : h('div', { class: 'pop-cats' }, ['All', ...CATS].map((c, k) =>
        h('button', { type: 'button', class: 'pop-letter', 'aria-pressed': String(k === 0), onmousedown: e => {
          e.preventDefault(); mCat = k - 1; for (const b of cats.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); refilter();
        } }, c)));
      moveBar = h('div', { class: 'pop-movebar' }, typeSel, cats);
    }
    pop = h('div', { class: 'pop' }, search, moveBar, letters, list, pager);
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
  // The editable buffers of the open save: Radical Red keeps four, SoulGold three (its save blocks and the PC).
  const parts = () => (sv.game === 'sg' ? ['sb1', 'sb2', 'sb3', 'ps'] : ['data', 'stream', 'raw', 'ext']);
  const snapshot = () => Object.fromEntries(parts().map(k => [k, sv[k].slice()]));
  const restore = s => { for (const k of parts()) sv[k].set(s[k]); };
  const sameBytes = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const unchanged = s => parts().every(k => sameBytes(s[k], sv[k]));
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
  // Ctrl+click (like PKHeX) on level, friendship, an IV, an EV, an item quantity, money, coins, BP or the Candy Jar sets it to the most it can be.
  const MAX_TIP = 'Ctrl+click to max it';
  document.addEventListener('click', e => {
    const t = e.target;
    if (!(e.ctrlKey || e.metaKey) || !(t instanceof HTMLInputElement) || t.disabled || !/^((ed|add)-(level|fr|iv\d|ev\d)|ed-pp\d|bagq-.+|bag-add-qty|tr-(money|coins|bp|candy))$/.test(t.id)) return;
    e.preventDefault();
    if (t.value === t.max) return;
    t.value = t.max;
    t.dispatchEvent(new Event('change', { bubbles: true }));
  });
  // Ctrl+click on an empty slot copies the selected Pokémon there (quick duplicate). Returns true when it handled the click.
  function quickCopy(e, party, b, s) {
    const src = sv && selRef();
    if (!(e.ctrlKey || e.metaKey) || !filled(src)) return false;
    const name = M.nickname(src) || spName(M.species(src));
    if (party) {
      let i = -1;
      if (C.partyCount(sv) >= 6) status('Your party is full (6 Pokémon).', 'err');
      else if (change(`Copied ${name} to the party`, () => { i = C.copyToParty(sv, D, X, src); }, { full: true, sfx: 'ball' })) select(true, 0, i);
    } else if (change(`Copied ${name} to ${C.boxName(sv, b)} slot ${s + 1}`, () => C.copyToBox(D, src, C.boxRef(sv, b, s)), { full: true, sfx: 'ball' })) select(false, b, s);
    return true;
  }
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
    $('#btnConvert').disabled = !sv;
    $('#btnConvert').hidden = !sv;
    if (!sv) return;
    f.replaceChildren(
      h('b', {}, fileName), h('span', {}, `save #${sv.saveIndex}`), h('span', { class: 'ok' }, '✓ checksums valid'),
      dirty ? h('span', { class: 'dirty', title: `${dirty} unsaved change${dirty === 1 ? '' : 's'}` }, `● ${dirty}`, h('span', { class: 'long' }, ` unsaved change${dirty === 1 ? '' : 's'}`)) : h('span', {}, 'no unsaved changes'));
  }

  // ── Storage pane ──
  function boxCount(b) { let n = 0; for (let s = 0; s < C.SLOTS; s++) if (filled(C.boxRef(sv, b, s))) n++; return n; }
  function slotButton(ref, party, b, s, size) {
    const isSel = sel.party === party && sel.slot === s && (party || sel.box === b);
    const el = h('button', { class: 'slot' + (filled(ref) ? '' : ' empty') + (isSel ? ' sel' : ''), type: 'button', onclick: e => { if (filled(ref) || !quickCopy(e, party, b, s)) select(party, b, s); } });
    if (filled(ref)) {
      const sp = M.species(ref), lv = C.levelOf(D, ref), iv = M.ivs(ref);
      el.title = `${M.nickname(ref)} — ${spName(sp)}${lv ? ', Lv ' + lv : ''}`;
      el.append(...[sprite(sp, M.shiny(ref), size, M.isEgg(ref)),
        party ? h('span', { class: 'pinfo' }, h('span', { class: 'pname' }, M.nickname(ref) || spName(sp)), h('span', { class: 'plv' }, lv ? 'Lv ' + lv : '', statusBadge(ref))) : null,
        h('span', { class: 'marks' }, M.shiny(ref) ? h('span', { class: 'star', title: 'Shiny' }, '★') : null,
          iv.every(v => v === 31) ? h('span', { class: 'perfect', title: 'Perfect IVs' }, '⬢') : null,
          illegal(ref) ? h('span', { class: 'illegal-mark', title: 'Illegal: open it to see why' }, '✕') : null),
        lv && !party ? h('span', { class: 'lv' }, 'Lv' + lv) : null,
        M.item(ref) ? h('span', { class: 'held', title: 'Holding ' + (D.items[M.item(ref)] || 'an item') }, itemIcon(M.item(ref))) : null].filter(Boolean));
      dragSource(el, { party, box: b, slot: s });
    } else {
      el.title = 'Empty — click to add a Pokémon';
      if (party) el.append(h('span', { class: 'pinfo muted' }, '＋ Add'));
    }
    dropTarget(el, { party, box: b, slot: s });
    return el;
  }

  // ── Drag and drop: any Pokémon (box or party) onto any slot. Holding it over ‹ or › flips through the boxes. ──
  const DRAG = 'text/rh-slot';
  let dragFrom = null, flipTimer = 0;
  const stopFlip = () => { clearTimeout(flipTimer); flipTimer = 0; };
  function dragSource(el, where) {
    el.draggable = true;
    el.addEventListener('dragstart', e => { dragFrom = where; e.dataTransfer.setData(DRAG, JSON.stringify(where)); e.dataTransfer.effectAllowed = 'move'; el.classList.add('dragging'); });
    el.addEventListener('dragend', () => { el.classList.remove('dragging'); dragFrom = null; stopFlip(); });
  }
  function dropTarget(el, where) {
    el.addEventListener('dragover', e => { if (!e.dataTransfer.types.includes(DRAG)) return; e.preventDefault(); e.dataTransfer.dropEffect = 'move'; el.classList.add('drop'); });
    el.addEventListener('dragleave', () => el.classList.remove('drop'));
    el.addEventListener('drop', e => {
      el.classList.remove('drop');
      if (!e.dataTransfer.types.includes(DRAG)) return;
      e.preventDefault(); stopFlip();
      let from = null;
      try { from = JSON.parse(e.dataTransfer.getData(DRAG)); } catch { from = dragFrom; }
      dragFrom = null;
      if (from) dropMon(from, where);
    });
  }
  function flipOnHover(btn, step) {
    btn.addEventListener('dragover', e => {
      if (!e.dataTransfer.types.includes(DRAG)) return;
      e.preventDefault(); e.dataTransfer.dropEffect = 'move'; btn.classList.add('drop');
      if (!flipTimer) flipTimer = setTimeout(() => { flipTimer = 0; box = (box + step + C.BOXES) % C.BOXES; renderBoxes(); }, 650);
    });
    btn.addEventListener('dragleave', () => { btn.classList.remove('drop'); stopFlip(); });
    btn.addEventListener('drop', e => { e.preventDefault(); btn.classList.remove('drop'); stopFlip(); });
  }
  const refAt = w => (w.party ? (w.slot < C.partyCount(sv) ? C.partyRef(sv, w.slot) : null) : C.boxRef(sv, w.box, w.slot));
  function dropMon(from, to) {
    const a = refAt(from), b = refAt(to);
    if (!filled(a)) return;
    const name = M.nickname(a) || spName(M.species(a)), other = filled(b) ? M.nickname(b) || spName(M.species(b)) : '';
    // Where it ends up: dropped on an empty party slot it goes last, as the party has no gaps.
    const n = C.partyCount(sv), land = to.party && !filled(b) ? { party: true, box: 0, slot: from.party ? n - 1 : n } : to;
    const what = other ? `Swapped ${name} and ${other}` : `Moved ${name} to ${to.party ? 'your party' : C.boxName(sv, to.box)}`;
    if (change(what, () => C.moveMon(sv, D, X, from, to), { full: true })) select(land.party, land.party ? sel.box : land.box, land.slot);
  }
  function renderBoxes() {
    trim();
    const pane = $('#pane-boxes');
    const pick = h('select', { id: 'boxSelect', 'aria-label': 'Box', onchange: e => { box = +e.target.value; renderBoxes(); } },
      Array.from({ length: C.BOXES }, (_, b) => h('option', { value: b, selected: b === box }, `${C.boxName(sv, b)}  (${boxCount(b)}/30)`)));
    const grid = h('div', { class: 'pc' });
    for (let s = 0; s < C.SLOTS; s++) grid.append(slotButton(C.boxRef(sv, box, s), false, box, s, 72));
    const n = C.partyCount(sv);
    const partyCol = h('div', { class: 'party-col' }, h('div', { class: 'section-title' }, `Party (${n}/6)`),
      h('div', { class: 'party' }, Array.from({ length: 6 }, (_, s) => slotButton(s < n ? C.partyRef(sv, s) : null, true, 0, s, 48))));
    const prev = h('button', { id: 'boxPrev', class: 'btn', type: 'button', title: 'Previous box (hold a Pokémon here to flip)', onclick: () => { box = (box + C.BOXES - 1) % C.BOXES; renderBoxes(); } }, '‹');
    const next = h('button', { id: 'boxNext', class: 'btn', type: 'button', title: 'Next box (hold a Pokémon here to flip)', onclick: () => { box = (box + 1) % C.BOXES; renderBoxes(); } }, '›');
    flipOnHover(prev, -1); flipOnHover(next, 1);
    put(pane,
      h('div', { class: 'boxbar' },
        prev,
        pick,
        next,
        h('span', { class: 'spacer' }),
        illegalButton(),
        h('button', { class: 'btn', type: 'button', onclick: maxAllIvs, title: `Set all six IVs to 31 for every Pokémon in the party and all ${C.BOXES} boxes` }, 'Max IVs on everything')),
      boxSettings(),
      h('div', { class: 'storage' }, grid, partyCol),
      G.key === 'rr' && box >= 22 ? h('p', { class: 'note' }, 'Boxes 23–25 unlock in Radical Red as your PC fills up. Pokémon placed here are saved, and appear in the game once the box is unlocked.') : null,
      h('p', { class: 'note' }, 'Drag a Pokémon onto any box or party slot to move or swap it. Hold it over ‹ or › to flip to another box. Click an empty slot to add a new Pokémon.'));
  }

  // The open box's name and wallpaper, as the PC's "Name" and "Wallpaper" options set them.
  function boxSettings() {
    if (!C.setBoxName) return null;
    const old = C.boxName(sv, box), wp = C.wallpaper(sv, box), friends = C.friendsWallpaper ? C.friendsWallpaper(sv) : true;
    const name = h('input', { id: 'box-name', type: 'text', maxlength: C.BOX_NAME_LEN, value: old, 'aria-label': 'Box name', oninput: e => e.target.classList.remove('bad'), onchange: e => {
      const v = e.target.value.trim();
      if (!v) { e.target.value = old; status('A box needs a name.', 'err'); return; }
      if (!C.encodeText(v, C.BOX_NAME_LEN)) { e.target.classList.add('bad'); status(`Box names are up to ${C.BOX_NAME_LEN} letters the game can show.`, 'err'); return; }
      change(`Renamed ${old} to ${v}`, () => C.setBoxName(sv, box, v));
    } });
    const known = C.WALLPAPER_SETS.some(([, ids]) => ids.includes(wp));
    const wall = h('select', { id: 'box-wallpaper', 'aria-label': 'Wallpaper', onchange: e => {
      const id = +e.target.value;
      change(`Set the wallpaper of ${old} to ${C.WALLPAPERS[id]}`, () => C.setWallpaper(sv, box, id));
    } },
      known ? null : h('option', { value: wp, selected: true }, `Unknown (#${wp})`),
      C.WALLPAPER_SETS.map(([set, ids]) => h('optgroup', { label: set }, ids.map(id =>
        h('option', { value: id, selected: id === wp, disabled: id === C.FRIENDS_WALLPAPER && !friends && !hax }, C.WALLPAPERS[id] + (id === C.FRIENDS_WALLPAPER && !friends ? ' (locked)' : ''))))));
    return h('div', { class: 'boxset' },
      h('label', { class: 'boxset-f' }, h('span', {}, 'Name'), name),
      h('label', { class: 'boxset-f' }, h('span', {}, 'Wallpaper'), wall),
      C.setFriendsWallpaper ? h('label', { class: 'check', title: "Walda's Friends wallpaper shows in the PC's wallpaper menu once it is unlocked" },
        h('input', { id: 'box-friends', type: 'checkbox', checked: friends, onchange: e => {
          const on = e.target.checked;
          change(on ? 'Unlocked the Friends wallpaper' : 'Locked the Friends wallpaper', () => C.setFriendsWallpaper(sv, on));
        } }), 'Friends wallpaper unlocked') : null);
  }

  function healParty() {
    let healed = 0;
    change('Healed the party', () => {
      for (let i = 0; i < C.partyCount(sv); i++) if (C.heal(D, C.partyRef(sv, i))) healed++;
      return healed > 0;
    }, { full: true, sfx: 'heal' });
    status(healed ? `Healed ${healed} Pokémon: full HP, no status conditions and full PP.` : 'Your party is already fully healed: full HP, no status conditions and full PP.', healed ? 'ok' : '');
  }

  // ── Party pane ──
  function renderParty() {
    const n = C.partyCount(sv), cards = [];
    for (let s = 0; s < 6; s++) {
      const r = s < n ? C.partyRef(sv, s) : null;
      if (!filled(r)) {
        const card = h('button', { type: 'button', class: 'pcard empty' + (sel.party && sel.slot === s ? ' sel' : ''), title: 'Add a Pokémon to your party (Ctrl+click: copy the selected Pokémon here)', onclick: e => { if (!quickCopy(e, true, 0, s)) select(true, 0, s); } },
          h('span', { class: 'muted' }, '＋ Add a Pokémon'));
        dropTarget(card, { party: true, box: 0, slot: s });
        cards.push(card);
        continue;
      }
      const sp = M.species(r), st = M.partyStats(r), hp = M.hp(r);
      const pct = st[0] ? Math.max(0, Math.min(100, Math.round(hp / st[0] * 100))) : 0;
      const card = h('button', { type: 'button', class: 'pcard' + (sel.party && sel.slot === s ? ' sel' : ''), onclick: () => select(true, 0, s) },
        sprite(sp, M.shiny(r), 96, M.isEgg(r)),
        h('span', { class: 'pcard-body' },
          h('span', { class: 'pcard-head' }, h('strong', {}, M.nickname(r) || spName(sp)), M.shiny(r) ? h('span', { class: 'star' }, '★') : null,
            statusBadge(r),
            h('span', { class: 'note mono' }, 'Lv ' + C.levelOf(D, r))),
          h('span', { class: 'note' }, `${spName(sp)} · ${C.NATURES[M.nature(r)]}`),
          h('span', { class: 'note held-line' }, itemIcon(M.item(r)), M.item(r) ? 'Holding ' + (D.items[M.item(r)] || '#' + M.item(r)) : 'No held item'),
          h('span', { class: 'hpbar', title: `HP ${hp}/${st[0]}` }, h('span', { class: pct > 50 ? 'ok' : pct > 20 ? 'mid' : 'low', style: `width:${pct}%` })),
          h('span', { class: 'pcard-moves' }, M.moves(r).map(m => h('span', { title: m ? moveInfo(m) : '' }, m && moveType(m) ? h('i', { class: 'mdot', style: `--type:${moveType(m).c}` }) : null, m ? D.moves[m] || '#' + m : '—')))));
      dragSource(card, { party: true, box: 0, slot: s });
      dropTarget(card, { party: true, box: 0, slot: s });
      cards.push(card);
    }
    put($('#pane-party'),
      h('div', { class: 'row' }, h('div', { class: 'section-title' }, `Party (${n}/6)`), h('span', { class: 'grow' }),
        h('button', { class: 'btn', type: 'button', disabled: !n, title: 'Restore HP, cure status conditions and refill PP for every party Pokémon', onclick: healParty }, 'Heal party')),
      h('div', { class: 'party-cards' }, cards),
      h('p', { class: 'note' }, 'Click a Pokémon to edit it, or an empty slot to add one. Drag a Pokémon onto another to swap their places. "Move to box" in the editor, or dragging in the Boxes tab, puts it in a box.'));
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
          C.abilityName(X, r) ? h('span', { class: 'chip', title: ['Ability 1', 'Ability 2', 'Hidden ability'][M.abilityIndex(r)] + (X.abd && X.abd[C.abilityName(X, r)] ? ': ' + X.abd[C.abilityName(X, r)] : '') }, C.abilityName(X, r))
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
    if (!list.length) return h('div', { class: 'legal ok', role: 'status' }, h('strong', {}, '✓ Legal'), h('span', { class: 'note' }, `Matches ${G.name}'s rules.`));
    const cls = errors.length ? 'bad' : warns.length ? 'warn' : 'info';
    const title = errors.length ? `✕ Illegal: ${errors.length} problem${errors.length > 1 ? 's' : ''}` : warns.length ? `! ${warns.length} thing${warns.length > 1 ? 's' : ''} to check` : 'Not checked';
    return h('div', { class: 'legal ' + cls, role: 'status' }, h('strong', {}, title),
      h('ul', {}, [...errors, ...warns, ...info].map(p => h('li', { class: p.level }, p.text))));
  }

  function mainTab(r) {
    const sp = M.species(r), ratio = C.genderRatio(D, sp), fixedGender = ratio === 0 || ratio >= 254, g = C.genderOf(D, r);
    const lv = C.levelOf(D, r);
    return [h('div', { class: 'form' },
      field('Species', picker({ id: 'ed-species', value: sp, options: speciesOpts(), icon: spriteIcon, kind: 'species', onPick: id => changeSpecies(r, id, `Changed species to ${spName(id)}`) }), ' wide'),
      evoRow(r),
      field('Nickname', h('input', { id: 'ed-nick', type: 'text', maxlength: C.NICK_LEN || 10, value: M.nickname(r), onchange: e => {
        const v = e.target.value.trim() || C.defaultNickname(D, sp);
        if (!C.encodeText(v, C.NICK_LEN || 10)) { e.target.classList.add('bad'); status('That nickname uses a character the game cannot show.', 'err'); return; }
        edit(r, 'Renamed to ' + v, () => M.setNickname(r, v), { full: true });
      } }), ' wide'),
      field(lv ? 'Level' : 'Level (no data for this species)', h('input', { id: 'ed-level', type: 'number', title: MAX_TIP, min: 1, max: 100, value: lv || '', disabled: !lv, onchange: e => {
        const L = Math.max(1, Math.min(100, Math.round(+e.target.value) || 1));
        edit(r, 'Set level ' + L, () => C.setLevel(D, r, L), { full: true });
      } })),
      expField(r),
      field('Nature', h('select', { id: 'ed-nature', onchange: e => edit(r, 'Set nature ' + C.NATURES[+e.target.value], () => C.setNatureShiny(r, +e.target.value, M.shiny(r), D), { full: true }) }, natureOptions(M.nature(r)))),
      field('Gender', h('select', { id: 'ed-gender', disabled: fixedGender, onchange: e => edit(r, 'Set gender', () => C.setGender(D, r, +e.target.value), { full: true }) },
        fixedGender ? h('option', {}, genderText(g)) : [0, 1].map(v => h('option', { value: v, selected: v === g }, genderText(v))))),
      field('Held item', picker({ id: 'ed-item', value: M.item(r), options: itemOpts(), none: 'None', kind: 'items',
        onPick: id => edit(r, id ? 'Gave ' + D.items[id] : 'Removed held item', () => M.setItem(r, id), { full: true }) })),
      field('Poké Ball', h('select', { id: 'ed-ball', onchange: e => edit(r, 'Set ball', () => M.setBall(r, +e.target.value), { full: true }) }, ballOptions(M.ball(r)))),
      field('Friendship', h('input', { id: 'ed-fr', type: 'number', title: MAX_TIP, min: 0, max: 255, value: M.friendship(r), onchange: e => {
        const v = Math.max(0, Math.min(255, Math.round(+e.target.value) || 0));
        edit(r, 'Set friendship ' + v, () => M.setFriendship(r, v), { full: true });
      } })),
      field('Ability', h('select', { id: 'ed-ability', onchange: e => {
        const i = +e.target.value;
        edit(r, `Set ability to ${(X.species[sp] && X.species[sp].ab[i]) || ['ability 1', 'ability 2', 'hidden ability'][i]}`, () => C.setAbility(D, r, i), { full: true });
      } }, abilityOptions(sp, M.abilityIndex(r), C.abilityName(X, r)))),
      h('label', { class: 'check' }, h('input', { id: 'ed-shiny', type: 'checkbox', checked: M.shiny(r), onchange: e => edit(r, e.target.checked ? 'Made shiny' : 'Made not shiny', () => C.setNatureShiny(r, M.nature(r), e.target.checked, D), { full: true, sfx: e.target.checked ? 'shiny' : 'ok' }) }), '★ Shiny')),
      sel.party ? h('p', { class: 'note' }, `Battle stats are recalculated from ${G.name}'s base stats whenever you edit a party Pokémon.`) : null];
  }

  // Move choices. Normal mode lists only moves the species can learn in the game (the same list the legality
  // check uses) that are not already in another slot; RadicalHaX mode lists every move. The current move stays listed.
  // lv: its level; moves it only learns by levelling up later are marked with that level.
  function moveChoices(sp, mv, i, lv) {
    if (hax || !X.species[sp]) return moveOpts();
    const set = C.learnable(X, sp), lo = C.levelOnly(X, sp);
    return moveOpts().filter(o => o.id === mv[i] || (set.has(o.id) && !mv.includes(o.id)))
      .map(o => { const e = lo.get(o.id); return e && lv && e[1] > lv ? { id: o.id, label: `${o.label} · Lv ${e[1]}` } : o; });
  }
  const moveNote = sp => (hax ? 'RadicalHaX mode: every move is listed.'
    : X.species[sp] ? `Only moves ${spName(sp)} can learn in ${G.name} are listed (level-up, TM, tutor, egg and pre-evolution moves). A move marked "Lv" is learned by levelling up at that level, so picking it earlier shows a warning. Turn on RadicalHaX mode for any move.`
      : `There is no ${G.name} move data for ${spName(sp)}, so every move is listed.`);
  // Exact EXP (like PKHeX): the level follows it. Under Level and EXP, an EXP bar like the game's summary screen,
  // with what's left to the next level and a one-click "edge" (1 EXP before the next level).
  function expField(r) {
    const t = C.growth(D, M.species(r)), exp = M.exp(r);
    if (!t) return field('EXP (no data for this species)', h('input', { id: 'ed-exp', type: 'number', value: exp, disabled: true }));
    const L = C.levelOf(D, r), next = L < 100 ? t[L + 1] : null;
    const pct = next ? Math.floor((exp - t[L]) / (next - t[L]) * 100) : 100;
    const box = numBox('ed-exp', exp, 0, t[100], 'Experience points', (v, capped) => {
      edit(r, `Set EXP to ${v.toLocaleString()}`, () => C.setExp(D, r, v), { full: true });
      if (capped) status(`EXP is ${v.toLocaleString()}, the most a Pokémon can have (level 100).`);
    });
    // Edge: EXP one point before the next level (Pokégen "edging"), attached to the EXP box.
    const edge = next ? h('button', { id: 'ed-edge', class: 'btn', type: 'button', disabled: exp === next - 1,
      title: exp === next - 1 ? `Already edged: 1 EXP before level ${L + 1}` : `Edge: set EXP to ${(next - 1).toLocaleString()}, 1 point before level ${L + 1}`,
      onclick: () => edit(r, `Edged: 1 EXP before level ${L + 1}`, () => C.setExp(D, r, next - 1), { full: true }) }, 'Edge') : null;
    return [field('EXP', h('div', { class: 'input-group' }, box, edge)),
      h('div', { class: 'exp-row', title: next ? `Level ${L}: ${t[L].toLocaleString()}–${(next - 1).toLocaleString()} EXP` : 'Level 100' },
        h('span', { class: 'exp-text' },
          h('span', {}, next ? (exp === next - 1 ? `Edged · 1 EXP to Lv ${L + 1}` : `${(next - exp).toLocaleString()} EXP to Lv ${L + 1}`) : 'Max level'),
          h('span', { class: 'mono' }, next ? `${(exp - t[L]).toLocaleString()} / ${(next - t[L]).toLocaleString()}` : t[100].toLocaleString())),
        h('span', { class: 'expbar' }, h('span', { style: `width:${pct}%` })))];
  }

  // Each move with its PP and PP Ups (like PKHeX). A box Pokémon's PP is refilled when it is taken out, so only
  // party Pokémon have PP to edit; PP Ups are kept in both.
  function movesTab(r) {
    const mv = M.moves(r), pp = M.movePp(r), ups = M.ppUps(r), sp = M.species(r);
    const cap = G.key === 'sg' ? 127 : 255, maxOf = (m, u) => Math.min(cap, C.maxPp(D, m, u));
    const setUps = (i, n) => edit(r, `Set ${D.moves[mv[i]]} to ${n} PP Up${n === 1 ? '' : 's'}`, () => {
      const was = maxOf(mv[i], ups[i]), now = maxOf(mv[i], n);
      M.setPpUps(r, i, n);
      if (pp) M.setMovePp(r, i, pp[i] >= was ? now : Math.min(pp[i], now)); // full PP stays full, like a PP Up in the game
    }, { full: true });
    const rows = mv.map((m, i) => h('div', { class: 'move-row' },
      picker({ id: 'ed-move' + i, value: m, options: moveChoices(sp, mv, i, C.levelOf(D, r)), none: 'None', kind: 'moves',
        bad: legal(r).some(p => p.field === 'move' + i && p.level === 'error') ? 'error' : legal(r).some(p => p.field === 'move' + i) ? 'warn' : false, onPick: id => {
          const next = mv.slice(); next[i] = id;
          if (!next.some(x => x)) { status('A Pokémon needs at least one move.', 'err'); return; }
          edit(r, id ? 'Taught ' + D.moves[id] : 'Removed a move', () => M.setMoves(r, next, D), { full: true });
        } }),
      h('input', { id: 'ed-pp' + i, type: 'number', 'aria-label': `Move ${i + 1} PP`, min: 0, max: m ? (hax ? cap : maxOf(m, ups[i])) : 0,
        value: m ? (pp ? pp[i] : maxOf(m, ups[i])) : '', disabled: !m || !pp, title: !m ? '' : pp ? `${MAX_TIP} (${maxOf(m, ups[i])})` : 'Box Pokémon get full PP when they are taken out', onchange: e => {
          const v = Math.max(0, Math.min(+e.target.max, Math.round(+e.target.value) || 0)); e.target.value = v;
          edit(r, `Set ${D.moves[m]} PP to ${v}`, () => M.setMovePp(r, i, v), { full: true });
        } }),
      h('select', { id: 'ed-ups' + i, 'aria-label': `Move ${i + 1} PP Ups`, disabled: !m, title: m ? `PP Ups used (max PP ${maxOf(m, ups[i])} of ${maxOf(m, 3)})` : '', onchange: e => setUps(i, +e.target.value) },
        [0, 1, 2, 3].map(n => h('option', { value: n, selected: m && n === ups[i] }, String(n))))));
    const full = mv.every((m, i) => !m || (ups[i] === 3 && (!pp || pp[i] >= maxOf(m, 3))));
    return [h('div', { class: 'moves-edit' }, h('span', { class: 'h' }, 'Move'), h('span', { class: 'h' }, 'PP'), h('span', { class: 'h' }, 'Ups'), rows),
      h('div', { class: 'row' },
        h('button', { id: 'ed-ppmax', class: 'btn small', type: 'button', disabled: full, title: 'Use 3 PP Ups on every move (like a PP Max) and fill its PP', onclick: () => edit(r, 'Maxed PP Ups', () => {
          mv.forEach((m, i) => { if (m) { M.setPpUps(r, i, 3); if (pp) M.setMovePp(r, i, maxOf(m, 3)); } });
        }, { full: true }) }, 'Max PP Ups'),
        pp ? h('button', { id: 'ed-pprestore', class: 'btn small', type: 'button', disabled: mv.every((m, i) => !m || pp[i] >= maxOf(m, ups[i])), title: 'Refill every move\'s PP', onclick: () => edit(r, 'Restored PP', () => {
          mv.forEach((m, i) => { if (m) M.setMovePp(r, i, maxOf(m, ups[i])); });
        }, { full: true }) }, 'Restore PP') : null),
      h('p', { class: 'note' }, moveNote(sp) + ' Changing a move refills its PP and removes PP Ups for that slot.' + (pp ? '' : ' Box Pokémon get full PP when they are taken out, so only PP Ups are kept here.'))];
  }

  // A new species keeps the level (on the new growth curve), and a nickname that was the species name follows it.
  function changeSpecies(r, id, what) {
    const sp = M.species(r), L = C.levelOf(D, r), wasDefault = M.nickname(r) === C.defaultNickname(D, sp);
    edit(r, what, () => {
      M.setSpecies(r, id);
      if (L && C.growth(D, id)) C.setLevel(D, r, L);
      if (wasDefault) M.setNickname(r, C.defaultNickname(D, id));
    }, { full: true });
  }
  // Evolution: the next stages (one per species, methods joined) and the previous one. Megas and other form changes
  // are battle-only and left out.
  function evolutions(sp) {
    const out = new Map();
    for (const [to, how, form] of (X.species[sp] ? X.species[sp].evo : [])) {
      if (form || !X.species[to] || !addable(to) || to === sp) continue;
      out.set(to, out.has(to) ? out.get(to) + ' or ' + how : how);
    }
    return [...out].map(([to, how]) => ({ to, how }));
  }
  const preEvolution = sp => Object.keys(X.species).map(Number).find(id => id !== sp && addable(id) && X.species[id].evo.some(e => !e[2] && e[0] === sp));
  function evoRow(r) {
    const sp = M.species(r);
    if (M.isEgg(r) || !X.species[sp]) return null;
    const next = evolutions(sp), prev = preEvolution(sp);
    if (!next.length && !prev) return null;
    const evolve = to => changeSpecies(r, to, `Evolved ${M.nickname(r) || spName(sp)} into ${spName(to)}`);
    return h('div', { class: 'row evo-actions' },
      next.length === 1 ? h('button', { id: 'ed-evolve', class: 'btn small', type: 'button', title: next[0].how, onclick: () => evolve(next[0].to) }, `Evolve into ${spName(next[0].to)}`)
        : next.length ? h('button', { id: 'ed-evolve', class: 'btn small', type: 'button', onclick: async () => { const to = await pickEvolution(sp, next); if (to) evolve(to); } }, `Evolve… (${next.length} choices)`) : null,
      prev ? h('button', { id: 'ed-devolve', class: 'btn small', type: 'button', onclick: () => changeSpecies(r, prev, `Devolved ${M.nickname(r) || spName(sp)} into ${spName(prev)}`) }, `Devolve to ${spName(prev)}`) : null);
  }
  // Branching evolutions (Eevee, Rockruff, Tyrogue...): pick one, each with its sprite and how it evolves.
  function pickEvolution(sp, options) {
    return new Promise(resolve => {
      const done = v => { d.close(); d.remove(); resolve(v); };
      const d = h('dialog', { class: 'card evo-dialog' },
        h('h3', {}, `Evolve ${spName(sp)}`),
        h('p', { class: 'note' }, 'Choose what it evolves into. Its level, nature, IVs, EVs, moves and nickname are kept.'),
        h('div', { class: 'evo-choices' }, options.map(o => h('button', { type: 'button', class: 'evo-choice', onclick: () => done(o.to) },
          sprite(o.to, false, 64), h('strong', {}, spName(o.to)), h('span', { class: 'note' }, o.how)))),
        h('div', { class: 'row', style: 'justify-content:flex-end' }, h('button', { class: 'btn', type: 'button', onclick: () => done(0) }, 'Cancel')));
      d.addEventListener('cancel', () => { d.remove(); resolve(0); });
      document.body.append(d);
      d.showModal();
    });
  }

  // Highest EV stat i can have next to the others: 252 per stat and 510 in total, like the game.
  // RadicalHaX mode allows up to 255 (the most the save can store) with no total.
  const evCap = (evs, i) => (hax ? 255 : Math.max(0, Math.min(C.EV_CAP, C.EV_TOTAL - evs.reduce((a, b, k) => (k === i ? a : a + b), 0))));
  const evCapNote = (i, v) => `${C.STATS[i]} EV is ${v}, the most it can have: ${C.EV_CAP} per stat and ${C.EV_TOTAL} in total. RadicalHaX mode allows more.`;
  // onEv(i, value, capped): capped is true when the typed number was lowered to the limit.
  function statsGrid(ivs, evs, nature, onIv, onEv, values, idp, locked = false) {
    // Nature indexes Atk/Def/Spe/SpA/SpD; grid rows are HP/Atk/Def/SpA/SpD/Spe.
    const up = Math.floor(nature / 5), down = nature % 5, rowOf = k => [1, 2, 5, 3, 4][k];
    const mark = i => (up === down ? '' : i === rowOf(up) ? ' up' : i === rowOf(down) ? ' down' : '');
    const g = h('div', { class: 'stats' }, h('span'), h('span', { class: 'h' }, 'IV'), h('span', { class: 'h' }, 'EV'), h('span', { class: 'h' }, values ? 'Stat' : ''));
    const cur = evs.slice(), evInputs = [];
    C.STATS.forEach((s, i) => {
      // max stops the arrows at the limit; a bigger typed number is lowered to it.
      const ev = h('input', { id: `${idp}-ev${i}`, type: 'number', title: MAX_TIP, disabled: locked, min: 0, max: evCap(cur, i), value: evs[i], 'aria-label': s + ' EV', onchange: e => {
        const want = Math.max(0, Math.round(+e.target.value) || 0), v = Math.min(want, evCap(cur, i));
        e.target.value = v; cur[i] = v;
        evInputs.forEach((x, k) => { x.max = evCap(cur, k); });
        onEv(i, v, want > v);
      } });
      evInputs.push(ev);
      g.append(
        h('span', { class: 'name' + mark(i), title: mark(i) === ' up' ? 'Raised by nature' : mark(i) === ' down' ? 'Lowered by nature' : '' }, s),
        h('input', { id: `${idp}-iv${i}`, type: 'number', title: MAX_TIP, disabled: locked, min: 0, max: 31, value: ivs[i], 'aria-label': s + ' IV', onchange: e => {
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
        M.partyStats(r), 'ed', ivEvLocked()),
      ivEvLocked() ? h('div', { class: 'row' }, h('span', { class: 'note grow' }, MG_NOTE),
        mgIssues(r).length ? h('button', { class: 'btn small', type: 'button', onclick: () => edit(r, 'Set IVs to 31 and cleared EVs', () => { M.setIvs(r, [31, 31, 31, 31, 31, 31]); M.setEvs(r, [0, 0, 0, 0, 0, 0]); }, { full: true }) }, 'Set IVs to 31, clear EVs') : null)
      : h('div', { class: 'row' },
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

  // ── Met locations: FireRed's places, with the ones where the Pokémon's evolution family is found in Radical Red first ──
  const normPlace = s => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  let metIds, dupNames, sortedMet, areaMet, families, foundCache;
  const placeName = i => (X.metNames[i] ? X.metNames[i] + (dupNames.has(X.metNames[i]) ? ` #${i}` : '') : `#${i} (not a real place)`);
  // Rebuilt when the game changes.
  function bindMet() {
    metIds = Object.keys(X.metNames).map(Number);
    dupNames = new Set(metIds.map(i => X.metNames[i]).filter((n, k, a) => a.indexOf(n) !== k));
    sortedMet = metIds.slice().sort((a, b) => placeName(a).localeCompare(placeName(b)));
    // Encounter area -> met location (the same name matching the Nuzlocke tools use; "Route 4 Poke Center" -> Route 4).
    areaMet = X.areas.map(a => {
      const an = normPlace(a); let best = -1, len = 0;
      for (const i of metIds) { if (G.specialMet(i)) continue; const mn = normPlace(X.metNames[i]); if ((an === mn || an.startsWith(mn + ' ')) && mn.length > len) { best = i; len = mn.length; } }
      return best;
    });
    families = new Map();
    for (const [id, s] of Object.entries(X.species)) { if (!families.has(s.anc)) families.set(s.anc, []); families.get(s.anc).push(+id); }
    foundCache = new Map();
  }
  bindMet();
  function foundAt(sp) {
    if (!foundCache.has(sp)) {
      const set = new Set(), fam = X.species[sp] ? families.get(X.species[sp].anc) || [sp] : [sp];
      for (const f of fam) for (const row of X.enc[f] || []) if (areaMet[row[0]] >= 0) set.add(areaMet[row[0]]);
      foundCache.set(sp, set);
    }
    return foundCache.get(sp);
  }
  function metOptions(sp, cur) {
    const found = foundAt(sp), opt = i => h('option', { value: i, selected: i === cur }, placeName(i));
    return [X.metNames[cur] ? null : opt(cur),
      found.size ? h('optgroup', { label: `Where ${spName(sp)}'s family is found` }, sortedMet.filter(i => found.has(i)).map(opt)) : null,
      h('optgroup', { label: found.size ? 'Other places' : 'Places' }, sortedMet.filter(i => !found.has(i)).map(opt))];
  }
  // A number box that stops at its limits; a bigger typed number is lowered to the limit (capped = true).
  const numBox = (id, value, min, max, label, onSet) => h('input', { id, type: 'number', min, max, value, 'aria-label': label, onchange: e => {
    const want = Math.round(+e.target.value) || 0, v = Math.max(min, Math.min(max, want));
    e.target.value = v; onSet(v, want !== v);
  } });

  function originTab(r) {
    const t = C.trainer(sv), otid = M.otid(r), tid = otid & 0xFFFF, sid = otid >>> 16, sp = M.species(r);
    const mine = tid === t.tid && sid === t.sid && M.otName(r) === t.name && M.otGender(r) === (t.gender & 1);
    const lv = C.levelOf(D, r) || 100, metMax = hax ? 127 : lv, name = M.nickname(r) || spName(sp);
    const bad = (e, msg) => { e.target.classList.add('bad'); status(msg, 'err'); };
    return [h('div', { class: 'form' },
      field('Original trainer (OT)', h('input', { id: 'ed-ot', type: 'text', maxlength: 7, value: M.otName(r), onchange: e => {
        const v = e.target.value.trim();
        if (!v && !hax) return bad(e, 'The original trainer needs a name. RadicalHaX mode allows an empty one.');
        if (!C.encodeText(v, 7)) return bad(e, 'That name is longer than 7 letters or uses a character the game cannot show.');
        edit(r, v ? `Set the OT to ${v}` : 'Cleared the OT name', () => M.setOtName(r, v), { full: true });
      } })),
      field('OT gender', h('select', { id: 'ed-otg', onchange: e => edit(r, 'Set the OT gender', () => M.setOtGender(r, +e.target.value), { full: true }) },
        [0, 1].map(g => h('option', { value: g, selected: M.otGender(r) === g }, g ? 'Girl' : 'Boy')))),
      field('Trainer ID', numBox('ed-tid', tid, 0, 65535, 'Trainer ID', v => edit(r, `Set the trainer ID to ${v}`, () => C.setOtIds(D, r, v, M.otid(r) >>> 16), { full: true }))),
      field('Secret ID', numBox('ed-sid', sid, 0, 65535, 'Secret ID', v => edit(r, `Set the secret ID to ${v}`, () => C.setOtIds(D, r, M.otid(r) & 0xFFFF, v), { full: true }))),
      field('Met location', h('select', { id: 'ed-met', onchange: e => edit(r, `Set the met location to ${placeName(+e.target.value)}`, () => M.setMetLocation(r, +e.target.value), { full: true }) },
        metOptions(sp, M.metLocation(r))), ' wide'),
      hax ? field('Met location number (any, RadicalHaX)', numBox('ed-metn', M.metLocation(r), 0, G.metMax, 'Met location number',
        v => edit(r, `Set the met location to #${v}`, () => M.setMetLocation(r, v), { full: true }))) : null,
      field(hax ? 'Met at level' : `Met at level (0–${metMax})`, numBox('ed-metlv', M.metLevel(r), 0, metMax, 'Met at level', (v, capped) => {
        edit(r, `Set the met level to ${v}`, () => M.setMetLevel(r, v), { full: true });
        if (capped) status(hax ? `Met level is ${v}, the most the save can store.` : `Met level is ${v}: it can't be met above its level (${lv}). RadicalHaX mode allows more.`);
      }))),
      h('div', { class: 'row' },
        h('span', { class: 'note grow' }, mine ? `This Pokémon is yours (${t.name}).` : `Its original trainer isn't you (${t.name}, ID ${String(t.tid).padStart(5, '0')}).`),
        h('button', { class: 'btn small', type: 'button', disabled: mine, title: 'Set the OT name, gender and IDs to yours', onclick: () => edit(r, `Made ${name} yours`, () => C.makeMine(sv, D, r), { full: true }) }, 'Make it mine')),
      h('p', { class: 'note' }, 'Met level 0 means it hatched from an Egg. Changing the trainer IDs keeps it shiny or not shiny.'),
      h('dl', { class: 'kv' },
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

  // A party Pokémon's status as the game's short tag (PSN, TOX, BRN...), with the full name on hover.
  const STATUS_TAG = { Fainted: 'FNT', Asleep: 'SLP', 'Badly poisoned': 'TOX', Poisoned: 'PSN', Burned: 'BRN', Frozen: 'FRZ', Paralyzed: 'PAR', Frostbitten: 'FRB' };
  function statusBadge(r) {
    const st = r && r.party && !M.isEgg(r) ? C.partyStatus(r) : '';
    return st ? h('span', { class: 'status-badge' + (st === 'Fainted' ? ' fnt' : ''), title: st }, STATUS_TAG[st] || st) : null;
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
      // Nuzlocke: put a fainted party Pokémon in the graveyard box (deposited like the game, the rest move up).
      const grave = nuz.graveBox();
      if (grave >= 0) {
        const gs = firstEmptyIn(grave);
        row.append(h('button', { class: 'btn', type: 'button', disabled: gs < 0, title: gs >= 0 ? `Nuzlocke: move this Pokémon to your graveyard box (${C.boxName(sv, grave)})` : 'The graveyard box is full',
          onclick: () => { const i = sel.slot; if (change(`Moved ${M.nickname(r)} to the graveyard`, () => C.deposit(sv, D, i, C.boxRef(sv, grave, gs)), { full: true })) { box = grave; setTab('boxes'); select(false, grave, gs); } } }, 'Move to graveyard'));
      }
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
      ...(dexView.has(M.species(r)) ? [h('button', { class: 'link', type: 'button', onclick: () => openDex(M.species(r)) }, G.dexName)] : []),
      h('button', { class: 'link', type: 'button', onclick: () => copy(C.toShowdown(D, r, X)) }, 'Copy Showdown set'));
    return row;
  }

  // ── Add a Pokémon (empty box slot) ──
  const newDraft = () => ({ species: 0, nickname: '', level: 50, nature: 0, gender: null, shiny: false, item: 0, ball: Math.max(0, C.BALLS.indexOf('Poké Ball')), friendship: null, // null: the species' base friendship
    ability: 0, metLocation: G.defaultMet, moves: [0, 0, 0, 0], ivs: [31, 31, 31, 31, 31, 31], evs: [0, 0, 0, 0, 0, 0], text: '' });
  function addForm() {
    if (!draft) draft = newDraft();
    if (ivEvLocked()) { draft.ivs = [31, 31, 31, 31, 31, 31]; draft.evs = [0, 0, 0, 0, 0, 0]; }
    const d = draft, ratio = d.species ? C.genderRatio(D, d.species) : 127, fixed = ratio === 0 || ratio >= 254;
    const rerender = () => queueEditor();
    const pickBad = (e, msg) => { e.target.classList.add('bad'); status(msg, 'err'); };
    const addPic = d.species ? sprite(d.species, d.shiny, heroSize()) : h('span', { class: 'spr none', style: `width:${heroSize()}px;height:${heroSize()}px;font-size:40px` });
    const sd = h('textarea', { id: 'add-sd', rows: 7, placeholder: 'Garchomp @ Choice Scarf\nLevel: 50\nJolly Nature\nEVs: 252 Atk / 4 SpD / 252 Spe\n- Earthquake\n- Outrage\n- Stone Edge\n- Fire Fang' }, d.text);
    return [
      h('div', { class: 'hero' }, addPic,
        h('div', {}, h('div', { class: 'hero-name' }, h('h2', {}, 'Add a Pokémon'), d.species ? cryButton(d.species, addPic) : null), h('div', { class: 'sub' }, sel.party ? `Party slot ${C.partyCount(sv) + 1}` : `${C.boxName(sv, sel.box)}, slot ${sel.slot + 1}`),
          h('p', { class: 'note', style: 'margin-top:6px' }, 'It will belong to you, in the ball you choose, met at the place you choose.'))),
      h('details', { open: !!d.text }, h('summary', { style: 'cursor:pointer;font-weight:600' }, 'Paste a Showdown set'),
        h('div', { style: 'display:grid;gap:8px;margin-top:8px' }, sd,
          h('button', { class: 'btn small', type: 'button', style: 'justify-self:start', onclick: () => {
            d.text = sd.value;
            try {
              const { opts, warnings } = C.fromShowdown(D, sd.value, X);
              if (!addable(opts.species)) throw new Error(`${spName(opts.species)} cannot be added (battle-only form or missing level data).`);
              if (!hax && X.species[opts.species]) {
                const set = C.learnable(X, opts.species), cut = [...new Set(opts.moves.filter(m => m && !set.has(m)))];
                if (cut.length) warnings.push(`${spName(opts.species)} can't learn ${cut.map(m => D.moves[m]).join(', ')} in ${G.name}, so ${cut.length > 1 ? 'they were' : 'it was'} left out (RadicalHaX mode keeps ${cut.length > 1 ? 'them' : 'it'}).`);
                opts.moves = packMoves(opts.moves, set);
                if (!opts.moves.some(x => x)) opts.moves = startMoves(opts.species, opts.level);
                const ev = C.clampEvs(opts.evs);
                if (ev.join() !== opts.evs.join()) { warnings.push(`EVs were lowered to the game's limits (${C.EV_CAP} per stat, ${C.EV_TOTAL} in total).`); opts.evs = ev; }
              }
              if (ivEvLocked()) {
                if (opts.ivs.some(v => v !== 31) || opts.evs.some(v => v)) warnings.push('Minimal Grinding mode is on, so its IVs were set to 31 and its EVs to 0 (RadicalHaX mode keeps them).');
                opts.ivs = [31, 31, 31, 31, 31, 31]; opts.evs = [0, 0, 0, 0, 0, 0];
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
        field('Nickname', h('input', { id: 'add-nick', type: 'text', maxlength: C.NICK_LEN || 10, value: d.nickname, placeholder: d.species ? C.defaultNickname(D, d.species) : 'Species name', onchange: e => {
          if (e.target.value && !C.encodeText(e.target.value, C.NICK_LEN || 10)) return pickBad(e, 'That nickname uses a character the game cannot show.');
          d.nickname = e.target.value.trim();
        } })),
        field('Level', h('input', { id: 'add-level', type: 'number', title: MAX_TIP, min: 1, max: 100, value: d.level, onchange: e => { d.level = Math.max(1, Math.min(100, Math.round(+e.target.value) || 1)); e.target.value = d.level; } })),
        field('Nature', h('select', { id: 'add-nature', onchange: e => { d.nature = +e.target.value; rerender(); } }, natureOptions(d.nature))),
        field('Gender', h('select', { id: 'add-gender', disabled: fixed, onchange: e => { d.gender = e.target.value === '' ? null : +e.target.value; } },
          fixed ? h('option', {}, ratio === 0 ? genderText(0) : ratio === 254 ? genderText(1) : genderText(2))
            : [h('option', { value: '' }, 'Random'), ...[0, 1].map(v => h('option', { value: v, selected: d.gender === v }, genderText(v)))])),
        field('Held item', picker({ id: 'add-item', value: d.item, options: itemOpts(), none: 'None', kind: 'items', onPick: id => { d.item = id; rerender(); } })),
        field('Poké Ball', h('select', { id: 'add-ball', onchange: e => { d.ball = +e.target.value; } }, ballOptions(d.ball))),
        field('Friendship', h('input', { id: 'add-fr', type: 'number', title: MAX_TIP, min: 0, max: 255, value: d.friendship ?? (C.baseFriendship ? C.baseFriendship(D, d.species) : 70), onchange: e => { d.friendship = Math.max(0, Math.min(255, Math.round(+e.target.value) || 0)); } })),
        h('label', { class: 'check' }, h('input', { id: 'add-shiny', type: 'checkbox', checked: d.shiny, onchange: e => { d.shiny = e.target.checked; rerender(); } }), '★ Shiny'),
        field('Met location', h('select', { id: 'add-met', disabled: !d.species, onchange: e => { d.metLocation = +e.target.value; } },
          d.species ? metOptions(d.species, d.metLocation) : h('option', {}, 'Choose a species first'))),
        field('Ability', h('select', { id: 'add-ability', disabled: !d.species, onchange: e => { d.ability = +e.target.value; } },
          d.species ? abilityOptions(d.species, d.ability) : h('option', {}, 'Choose a species first'))),
        ...d.moves.map((m, i) => field(`Move ${i + 1}${i ? '' : ' (required)'}`, picker({ id: 'add-move' + i, value: m, options: d.species ? moveChoices(d.species, d.moves, i, d.level) : [], none: d.species ? 'None' : null, kind: 'moves',
          disabled: !d.species, placeholder: 'Choose a species first', onPick: id => { d.moves[i] = id; rerender(); } }))),
        d.species ? h('p', { class: 'note', style: 'grid-column:1 / -1' }, moveNote(d.species)) : null),
      statsGrid(d.ivs, d.evs, d.nature, (i, v) => { d.ivs[i] = v; }, (i, v, capped) => { d.evs[i] = v; if (capped) status(evCapNote(i, v)); }, null, 'add', ivEvLocked()),
      ivEvLocked() ? h('p', { class: 'note' }, MG_NOTE) : null,
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
      h('td', { class: 'qty' }, h('input', { id: `bagq-${p.key}-${k}`, type: 'number', title: MAX_TIP, min: 1, max: qtyMax, value: it.qty, disabled: qtyMax === 1, onchange: e => {
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
    const all = D.items.map((n, i) => i).filter(i => i && C.validItem(D, i) && C.pocketOf(D, i) === p.key && (hax || !deadStone(i)));
    const fillNoun = p.key === 'tms' ? 'TM and HM' : { balls: 'ball', berries: 'berry', medicine: 'medicine', megas: 'Mega Stone', battle: 'battle item' }[p.key] || 'item';
    const fillAll = () => {
      const list = items.slice();
      for (const id of all) if (!list.some(x => x.id === id) && list.length < p.cap) list.push({ id, qty: qtyMax === 1 ? 1 : 99 });
      setPocket(`Added every ${fillNoun}`, list);
    };
    // SoulGold's Candy Jar: a key item that stores EXP from battles and turns it into Exp. Candies when used.
    function candyJarCard() {
      const exp = C.candyJar(sv), jar = D.items.indexOf('Candy Jar');
      const has = jar > 0 && C.readPocket(sv, C.POCKETS.find(x => x.key === 'key')).some(x => x.id === jar);
      let left = exp;
      const candies = [['L', 10000], ['M', 3000], ['S', 800], ['XS', 100]].map(([n, v]) => { const c = Math.min(999, Math.floor(left / v)); left -= c * v; return c ? `${c} × Exp. Candy ${n}` : null; }).filter(Boolean);
      return h('div', { class: 'card' }, h('h3', {}, 'Candy Jar'),
        field(`Stored EXP (max ${C.CANDY_JAR_MAX.toLocaleString()})`, h('input', { id: 'tr-candy', type: 'number', min: 0, max: C.CANDY_JAR_MAX, value: exp, onchange: e => {
          const v = Math.max(0, Math.min(C.CANDY_JAR_MAX, Math.round(+e.target.value) || 0)); e.target.value = v;
          change(`Set the Candy Jar to ${v.toLocaleString()} EXP`, () => C.setCandyJar(sv, v));
        } })),
        h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: () => change('Filled the Candy Jar', () => C.setCandyJar(sv, C.CANDY_JAR_MAX)) }, 'Max'),
          h('button', { class: 'btn small', type: 'button', onclick: () => change('Emptied the Candy Jar', () => C.setCandyJar(sv, 0)) }, 'Empty')),
        h('p', { class: 'note' }, candies.length ? `Using it in the bag now makes about ${candies.join(', ')} (if your bag has room).` : 'It keeps 90% of battle EXP and turns it into Exp. Candies when used.'),
        has ? null : h('p', { class: 'note' }, 'You don\'t have the Candy Jar yet (it comes after the first Gym). The EXP is kept until then.'));
    }
    put($('#pane-trainer'),
      h('div', { class: 'cards' },
        h('div', { class: 'card-stack' },
          h('div', { class: 'card' }, h('h3', {}, 'Trainer'),
            h('dl', { class: 'kv' }, h('dt', {}, 'Name'), h('dd', {}, t.name), h('dt', {}, 'Gender'), h('dd', {}, t.gender ? 'Girl' : 'Boy'),
              h('dt', {}, 'Trainer ID'), h('dd', {}, String(t.tid).padStart(5, '0')), h('dt', {}, 'Secret ID'), h('dd', {}, String(t.sid).padStart(5, '0')),
              ...(C.modes ? [h('dt', {}, 'Minimal Grinding'), h('dd', {}, minGrind() ? 'On (IVs are always 31, no EVs)' : 'Off')] : []))),
          C.candyJar ? candyJarCard() : null),
        h('div', { class: 'card' }, h('h3', {}, 'Money'),
          field(`Money (max ₽${C.MONEY_MAX.toLocaleString()})`, h('input', { id: 'tr-money', type: 'number', min: 0, max: C.MONEY_MAX, value: Math.min(t.money, C.MONEY_MAX), onchange: e => {
            const v = Math.max(0, Math.min(C.MONEY_MAX, Math.round(+e.target.value) || 0)); change(`Set money to ₽${v.toLocaleString()}`, () => C.setMoney(sv, v));
          } })),
          field(`Game Corner coins (max ${C.COINS_MAX.toLocaleString()})`, h('input', { id: 'tr-coins', type: 'number', min: 0, max: C.COINS_MAX, value: Math.min(t.coins, C.COINS_MAX), onchange: e => {
            const v = Math.max(0, Math.min(C.COINS_MAX, Math.round(+e.target.value) || 0)); change(`Set coins to ${v}`, () => C.setCoins(sv, v));
          } })),
          C.bp ? field(`Battle Points (max ${C.BP_MAX.toLocaleString()})`, h('input', { id: 'tr-bp', type: 'number', min: 0, max: C.BP_MAX, value: Math.min(C.bp(sv), C.BP_MAX), onchange: e => {
            const v = Math.max(0, Math.min(C.BP_MAX, Math.round(+e.target.value) || 0)); e.target.value = v; change(`Set Battle Points to ${v.toLocaleString()}`, () => C.setBp(sv, v));
          } })) : null,
          h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: () => change('Set money to the maximum', () => C.setMoney(sv, C.MONEY_MAX)) }, 'Max money'),
            h('button', { class: 'btn small', type: 'button', onclick: () => change('Set coins to the maximum', () => C.setCoins(sv, C.COINS_MAX)) }, 'Max coins'),
            C.bp ? h('button', { class: 'btn small', type: 'button', onclick: () => change('Set Battle Points to the maximum', () => C.setBp(sv, C.BP_MAX)) }, 'Max BP') : null),
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
          h('p', { class: 'note' }, 'When you save, every Pokémon in the file is registered as caught, like in the game. Something you add and then remove before saving is not.')),
      ),
      h('div', { class: 'section-title' }, 'Bag'),
      h('div', { class: 'pockets' }, C.POCKETS.map(x => h('button', { class: 'pocket', type: 'button', 'aria-pressed': String(x.key === pocket), onclick: () => { pocket = x.key; renderTrainer(); } },
        `${x.name} ${C.readPocket(sv, x).length}/${x.cap}`))),
      h('table', { class: 'bag' }, h('thead', {}, h('tr', {}, h('th', {}, 'Item'), h('th', {}, 'Quantity'), h('th', {}))),
        h('tbody', {}, rows.length ? rows : h('tr', {}, h('td', { colspan: 3, class: 'note' }, 'This pocket is empty.')),
          h('tr', { class: 'add-row' }, h('td', {}, picker({ id: 'bag-add', value: 0, kind: 'items', options: pocketOpts(p.key), placeholder: `＋ Add an item to ${p.name}`, onPick: addItem })),
            h('td', { class: 'qty' }, addQty), h('td', {})))),
      p.key !== 'items' && p.key !== 'key' ? h('div', { class: 'row' }, h('button', { class: 'btn small', type: 'button', onclick: fillAll }, `Add every ${fillNoun}${p.key === 'tms' || qtyMax === 1 ? '' : ' (99 each)'}`)) : null,
      h('p', { class: 'note' }, p.key === 'key' ? 'Key items can change story events. Only add ones you know are safe for your progress.' : `Up to ${p.cap} different items, ${qtyMax === 1 ? 'one of each' : 'at most 999 of each'}.`),
      p.key === 'megas' && X.megaStones && !hax ? h('p', { class: 'note' }, `Only the stones that Mega Evolve something in ${G.name} are listed: one for each type, plus the Bondstone. The official stones (Charizardite X, Golisopite and so on) are still in the game's item list but do nothing; RadicalHaX mode lists them.`) : null);
  }

  // ── Backups pane ──
  let backupWhere = ''; // the backups folder, from the desktop app
  if (host && host.backupDir) host.backupDir().then(d => { backupWhere = d; }).catch(() => {});
  const picked = new Set(); // backups ticked for deleting (by path)
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
    for (const p of [...picked]) if (!list.some(b => b.path === p)) picked.delete(p);
    // Backups are named "<save> (<date time>).sav"; "keep the newest 5" works per save.
    const saveOf = b => b.name.replace(/ \(\d{4}-\d\d-\d\d \d\d-\d\d-\d\d\)\.\w+$/i, '');
    const keepNewest = k => { picked.clear(); const seen = new Map(); for (const b of list) { const n = (seen.get(saveOf(b)) || 0) + 1; seen.set(saveOf(b), n); if (n > k) picked.add(b.path); } renderBackups(); };
    const del = async () => {
      const files = list.filter(b => picked.has(b.path));
      if (!files.length) return;
      const left = list.length - files.length;
      const choice = await modal(`Delete ${files.length} backup${files.length === 1 ? '' : 's'}?`,
        `${files.slice(0, 8).map(b => b.name).join('\n')}${files.length > 8 ? `\n…and ${files.length - 8} more` : ''}\n\nThis can't be undone.${left ? '' : ' No backups will be left.'}`,
        [{ text: 'Cancel' }, { text: 'Delete', primary: true }]);
      if (choice !== 1) return;
      try { const n = await host.deleteBackups(files.map(b => b.path)); picked.clear(); status(`Deleted ${n} backup${n === 1 ? '' : 's'}.`, 'ok'); }
      catch (e) { status(e.message, 'err'); }
      renderBackups();
    };
    const all = list.length > 0 && list.every(b => picked.has(b.path));
    put(pane,
      h('div', { class: 'row' }, h('h3', {}, 'Backups'), h('span', { class: 'grow' }),
        h('button', { class: 'btn', type: 'button', onclick: async () => { try { await host.backupNow(sv.original); status('Backed up the file as it is on disk.', 'ok'); renderBackups(); } catch (e) { status(e.message, 'err'); } } }, 'Back up now'),
        h('button', { class: 'btn', type: 'button', onclick: () => host.showBackups() }, 'Open backups folder')),
      h('p', { class: 'note' }, `Stored in ${backupWhere || 'the Backups folder next to RadicalHex.exe'}. A new backup is made when you open a save and right before every Save, unless the file has not changed since the last backup.`
        + (list.some(b => b.old) ? ' Backups marked "older" are from earlier versions, which kept them in Documents\\RadicalHex\\Backups.' : '')),
      list.length ? h('div', { class: 'row' },
        h('button', { class: 'btn small', type: 'button', title: 'Select every backup except the 5 newest of each save', onclick: () => keepNewest(5) }, 'Select all but the newest 5'),
        picked.size ? h('button', { class: 'btn small', type: 'button', onclick: () => { picked.clear(); renderBackups(); } }, 'Clear selection') : null,
        h('span', { class: 'grow' }),
        h('button', { id: 'bk-delete', class: 'btn small danger', type: 'button', disabled: !picked.size, onclick: del }, picked.size ? `Delete selected (${picked.size})` : 'Delete selected')) : null,
      list.length ? h('table', { class: 'backups' }, h('thead', {}, h('tr', {},
        h('th', { class: 'x' }, h('input', { id: 'bk-all', type: 'checkbox', checked: all, 'aria-label': 'Select every backup', onchange: e => { picked.clear(); if (e.target.checked) for (const b of list) picked.add(b.path); renderBackups(); } })),
        h('th', {}, 'File'), h('th', {}, 'Made'), h('th', {}, 'Size'), h('th', {}))),
        h('tbody', {}, list.map(b => h('tr', { class: picked.has(b.path) ? 'picked' : null },
          h('td', { class: 'x' }, h('input', { type: 'checkbox', checked: picked.has(b.path), 'aria-label': 'Select ' + b.name, onchange: e => { if (e.target.checked) picked.add(b.path); else picked.delete(b.path); renderBackups(); } })),
          h('td', {}, b.name, b.old ? h('span', { class: 'chip', style: 'margin-left:8px' }, 'older') : null), h('td', { class: 'mono' }, new Date(b.time).toLocaleString()), h('td', { class: 'mono' }, Math.round(b.size / 1024) + ' KB'),
          h('td', {}, h('button', { class: 'btn small', type: 'button', onclick: () => restoreBackup(b) }, 'Restore')))))) : h('p', { class: 'note' }, 'No backups yet.'));
  }
  // A backup restored over a file of the other layout (mGBA's .sav keeps 16 bytes of clock data after the 128 KB save,
  // RetroArch's .srm doesn't) is fitted to the open file, so the file keeps the size its emulator expects.
  function fitLayout(bytes, now) {
    const FLASH = 0x20000, RTC = 16;
    if (bytes.length === now.length) return bytes;
    if (bytes.length === FLASH + RTC && now.length === FLASH) return bytes.slice(0, FLASH);
    if (bytes.length === FLASH && now.length === FLASH + RTC) { const out = new Uint8Array(FLASH + RTC); out.set(bytes); out.set(now.subarray(FLASH), FLASH); return out; }
    throw new Error(`That backup is ${bytes.length.toLocaleString()} bytes and the open file is ${now.length.toLocaleString()} bytes, so it was not restored over it.`);
  }
  async function restoreBackup(b) {
    const choice = await modal('Restore this backup?', `${b.name}\n\nThis writes the backup over ${fileName}${dirty ? ' and discards your unsaved changes' : ''}. The current file is backed up first, so you can undo this from here too.`, [{ text: 'Cancel' }, { text: 'Restore', primary: true }]);
    if (choice !== 1) return;
    try {
      let bytes = await host.readBackup(b.path);
      bytes = fitLayout(bytes, sv.original);
      const next = C.load(bytes); // only real saves of the same game are restored
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
  // Which game a save is from: SoulGold's checks (its storage overflow and box 19 sectors, with their own checksums)
  // can't pass on a Radical Red file, so SoulGold is tried first and anything else opens exactly as before.
  function detect(bytes) {
    if (GAMES.sg) { try { return { game: GAMES.sg, next: GAMES.sg.C.load(bytes) }; } catch { /* not SoulGold */ } }
    return { game: GAMES.rr, next: GAMES.rr.C.load(bytes) };
  }
  async function openBytes(bytes, name) {
    let next, game;
    try { ({ next, game } = detect(bytes)); } catch (e) {
      if (sv) showError('Could not open ' + name, e); else { $('#welcomeMsg').textContent = e.message; }
      return;
    }
    // The newest save in the file is unfinished or damaged, so the game falls back to the previous one. Say so first.
    if (next.newerDamaged !== null) {
      const choice = await modal('The newest save in this file is incomplete',
        `Save #${next.newerDamaged} in ${name} was not finished or is damaged. This happens when the emulator writes the file while the game is still saving, or when a copy is cut short.\n\n`
        + `The game then says the save file is corrupted and loads the previous complete save (#${next.saveIndex}). RadicalHex opens that one too, so you see what the game will load. The unfinished save is left as it is, and your next in-game save replaces it.\n\n`
        + 'Next time, close the game in the emulator (in RetroArch: Close Content) before copying the save, so the file is fully written.',
        [{ text: "Don't open it" }, { text: `Open save #${next.saveIndex}`, primary: true }]);
      if (choice !== 1) return;
    }
    // A save with Pokémon, moves or items the game doesn't have is probably from another version (a future
    // Radical Red 5.0, or a newer SoulGold). Ask before editing it.
    const unknown = game.C.unknownData(next, game.D);
    if (unknown.length) {
      const newer = game.key === 'rr' ? 'It may be from a newer Radical Red, or another hack. RadicalHex only knows 4.1, so editing this save could damage it.'
        : 'It may be from a newer SoulGold. RadicalHex knows the SoulGold it was built from, so editing this save could damage it.';
      modal(`This save may not be from ${game.full}`,
        `RadicalHex found things ${game.full} doesn't have:\n${unknown.slice(0, 6).join('\n')}${unknown.length > 6 ? `\n…and ${unknown.length - 6} more` : ''}\n\n`
        + newer + ' Check the Releases page for a newer RadicalHex. If you open it anyway, keep your own copy of the file.',
        [{ text: 'Don\'t open it', primary: true }, { text: 'Open anyway' }])
        .then(choice => { if (choice === 1) showSave(next, name, unknown.length, game); });
      return;
    }
    showSave(next, name, 0, game);
  }
  function showSave(next, name, unknownCount, game = GAMES.rr) {
    setGame(game);
    sv = next; fileName = name; undo = []; dirty = 0; draft = null;
    sel = { party: C.partyCount(sv) > 0, box: 0, slot: 0 }; box = 0;
    $('#welcome').hidden = true; $('#app').hidden = false; $('#app').classList.remove('dex-only');
    if (tab === 'dex' && dexOnly) tab = 'boxes';
    dexOnly = false;
    if (host) host.setDirty(false).catch(() => {});
    renderAll();
    if (unknownCount) { status(`Opened ${name}, which has ${unknownCount} thing${unknownCount === 1 ? '' : 's'} ${G.full} doesn't have. Edit with care.`, 'err'); return; }
    status(`Opened ${name}${G.key === 'sg' ? ' (SoulGold)' : minGrind() ? ' (Minimal Grinding mode: IVs and EVs are locked unless RadicalHaX is on)' : ''}.${host ? ` A backup was saved in ${backupWhere || 'the Backups folder next to RadicalHex.exe'}.` : ''}`, 'ok');
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
    // The Pokédex is updated only in the bytes being written (like PKHeX): every Pokémon in the file counts as caught.
    // The editor's own copy is put back, so a cancelled or stopped save changes nothing.
    const before = snapshot();
    let bytes, fixed = 0, caught = [], cleared = 0;
    try { fixed = C.dex.repair(sv); cleared = C.clearErased(sv); caught = C.registerOwned(sv, D); bytes = C.build(sv, D); }
    catch (e) { restore(before); showError('Save stopped', e); return; }
    restore(before);
    const dexNote = (caught.length ? ` ${caught.length} Pokémon marked as caught in the Pokédex.` : '')
      + (fixed ? ` Fixed ${fixed} Pokédex ${fixed === 1 ? 'entry' : 'entries'} left by an older RadicalHex.` : '')
      + (cleared ? ` Tidied ${cleared} never-used box slot${cleared === 1 ? '' : 's'} into normal empty slots.` : '');
    try {
      let where;
      if (host) { where = as ? await host.saveAs(bytes) : await host.save(bytes); if (!where) return; }
      else { where = fileName.replace(/(\.\w+)?$/, ' (edited)$1'); download(bytes, where); }
      const keep = sel;
      sv = C.load(bytes); undo = []; dirty = 0; sel = keep;
      if (host && as) fileName = where.split(/[\\/]/).pop();
      renderAll();
      status((host ? `Saved ${where}. The previous version is in Backups.` : `Downloaded ${where}. Your original file was not changed.`) + dexNote, 'ok');
      S.play('save');
      return true;
    } catch (e) { showError('Could not save', e); }
  }

  // Converts the save as it is on disk into another emulator's layout. Only the file's size changes (mGBA adds
  // 16 bytes of clock data that RetroArch doesn't use); the game data is copied byte for byte and checked.
  async function convert() {
    if (!sv) return;
    const lay = C.saveLayout(sv.original);
    if (!lay.ok) { showError('This save can\'t be converted', new Error(`This file is ${lay.text}.`)); return; }
    const choice = await modal('Convert this save',
      `${fileName} is ${lay.text}.\n\n`
      + 'For RetroArch (.srm): for RetroArch on Android or PC with the mGBA or VBA-M core. The .srm must have the same name as your ROM (RadicalRed.gba → RadicalRed.srm) and go in RetroArch\'s saves folder.\n\n'
      + 'For other emulators (.sav): for mGBA, VBA-M, My Boy!, Pizza Boy and others. Also turns a RetroArch .srm back into a .sav.\n\n'
      + 'The file you have open is never changed. Close the emulator before copying the new file over its save.',
      [{ text: 'Cancel' }, { text: 'Other emulators (.sav)' }, { text: 'RetroArch (.srm)', primary: true }]);
    if (choice < 1) return;
    const format = choice === 2 ? 'srm' : 'sav';
    if (dirty) {
      const go = await modal('Save your changes first?', `You have ${dirty} unsaved change${dirty === 1 ? '' : 's'}. The converted copy is made from the file on disk, so save first to include them.`,
        [{ text: 'Cancel' }, { text: 'Convert without them' }, { text: 'Save, then convert', primary: true }]);
      if (go < 1) return;
      if (go === 2 && !(await save(false))) return;
    }
    let out;
    try { out = C.convertSave(sv.original, format); } catch (e) { showError('Could not convert the save', e); return; }
    try {
      let where;
      if (host) { where = await host.convertSave(out, format); if (!where) return; }
      else { where = fileName.replace(/(\.\w+)?$/, '.' + format); download(out, where); }
      status(`${host ? 'Saved' : 'Downloaded'} ${where} (${format === 'srm' ? 'RetroArch' : 'other emulators'}). ${fileName} was not changed.`, 'ok');
      S.play('save');
    } catch (e) { showError('Could not convert the save', e); }
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
  // Shared with radicaldex.js and nuzlocke.js: one dex view and one Nuzlocke view per game, each with its own data.
  const views = {};
  function viewsFor(g) {
    if (!views[g.key]) {
      const ui = { h, put, sprite, cryButton, D: g.D, X: g.X, C: g.C, game: g, save: () => sv, select: (party, b, s) => select(party, b, s), refresh: () => { renderHeader(); renderEditor(); }, openDex, trim, status: (m, k) => status(m, k) };
      views[g.key] = { dex: window.RHDexView(ui), nuz: window.RHNuzlocke(ui) };
    }
    return views[g.key];
  }
  let dexView, nuz;
  // Switches every game-specific table at once: core, data, dex, assets, met places, lists, names and colours.
  function setGame(g) {
    G = g; C = g.C; D = g.D; M = C.mon; X = g.X;
    OPTS = {};
    if (!C.POCKETS.some(p => p.key === pocket)) pocket = 'items';
    bindMet();
    ({ dex: dexView, nuz } = viewsFor(g));
    const dexTab = document.querySelector('.tab[data-tab="dex"]');
    if (dexTab) dexTab.textContent = g.dexName;
    document.body.classList.toggle('game-sg', g.key === 'sg');
    document.title = g.key === 'sg' ? 'RadicalHex · SoulGold' : 'RadicalHex';
    renderHax();
  }
  const browseDex = g => {
    if (sv && g !== G) return; // the open save decides the game
    setGame(g);
    dexOnly = true;
    $('#welcome').hidden = true; $('#app').hidden = false; $('#app').classList.add('dex-only');
    setTab('dex');
  };
  setGame(GAMES.rr);
  $('#btnDex').onclick = () => browseDex(GAMES.rr);
  if ($('#btnSoulDex')) { if (GAMES.sg) $('#btnSoulDex').onclick = () => browseDex(GAMES.sg); else $('#btnSoulDex').hidden = true; }

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
      : `Pokémon are checked against ${G.name}'s rules. Click for RadicalHaX mode (anything goes).`;
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
  $('#btnConvert').onclick = convert;
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
  // ── Version and updates (desktop app only; see updater.js) ──
  let update = null; // the last check: { current, latest, newer, canInstall, reason, page }
  async function checkForUpdate(manual) {
    try { update = await host.checkUpdate(); } catch (e) { if (manual) throw e; return; } // a failed start-up check stays quiet
    const b = $('#btnVersion');
    b.classList.toggle('new', update.newer);
    b.textContent = update.newer ? `v${update.current} → v${update.latest}` : `v${update.current}`;
    b.title = update.newer ? `RadicalHex v${update.latest} is out. Click to update.` : 'You have the latest RadicalHex. Click for update options.';
    if (update.newer && !manual) status(`RadicalHex v${update.latest} is out. Click the version at the top left to update.`);
  }
  async function updateDialog() {
    let autoOn = await host.autoUpdateCheck().catch(() => true), working = false;
    const d = h('dialog', { class: 'card update-dlg' }), close = () => { d.close(); d.remove(); };
    d.addEventListener('cancel', e => { if (working) e.preventDefault(); else d.remove(); });
    const recheck = async () => { draw('Checking GitHub…'); try { await checkForUpdate(true); draw(); } catch (e) { draw(e.message, 'err'); } };
    function draw(msg, kind) {
      const u = update;
      put(d,
        h('h3', {}, 'RadicalHex updates'),
        h('p', { style: 'margin:0' }, !u ? `You have v${$('#btnVersion').textContent.replace(/^v/, '').split(' ')[0]}.` : u.newer ? `RadicalHex v${u.latest} is out. You have v${u.current}.` : `You have the latest version (v${u.current}).`),
        u && u.newer ? h('p', { class: 'note', style: 'margin:0' }, u.canInstall
          ? "Update now downloads it from GitHub, checks it against GitHub's checksum, then closes RadicalHex and starts the new version in its place. Your saves and backups aren't touched, and if anything goes wrong your current RadicalHex.exe stays as it is."
          : u.reason) : null,
        msg ? h('p', { class: kind === 'err' ? 'warn' : 'note', style: 'margin:0;white-space:pre-line' }, msg) : null,
        working ? h('span', { class: 'update-bar' }, h('span', { id: 'upd-bar' })) : null,
        h('label', { class: 'check' }, h('input', { id: 'upd-auto', type: 'checkbox', checked: autoOn, disabled: working, onchange: e => { autoOn = e.target.checked; host.autoUpdateCheck(autoOn).catch(() => {}); } }),
          'Check for updates when RadicalHex starts'),
        h('div', { class: 'row', style: 'justify-content:flex-end' },
          u && u.newer ? h('button', { class: 'btn', type: 'button', disabled: working, onclick: () => window.open(u.page) }, "What's new") : null,
          h('button', { class: 'btn', type: 'button', disabled: working, onclick: recheck }, 'Check now'),
          u && u.newer && u.canInstall ? h('button', { id: 'upd-install', class: 'btn primary', type: 'button', disabled: working, onclick: install }, 'Update now') : null,
          h('button', { class: 'btn', type: 'button', disabled: working, onclick: close }, 'Close')));
    }
    async function install() {
      if (!(await confirmDiscard())) return;
      working = true;
      draw(`Downloading v${update.latest}…`);
      host.onUpdateProgress(pct => { const bar = d.querySelector('#upd-bar'); if (bar) bar.style.width = pct + '%'; });
      try { await host.installUpdate(); draw('Download checked. Starting the new version…'); }
      catch (e) { working = false; draw(e.message, 'err'); S.play('error'); }
    }
    document.body.append(d);
    draw();
    d.showModal();
    if (!update) recheck();
  }
  async function initVersion() {
    if (!host || !host.version) return;
    const b = $('#btnVersion'), v = await host.version().catch(() => '');
    if (!v) return;
    b.textContent = 'v' + v; b.title = 'RadicalHex version. Click for update options.'; b.hidden = false;
    b.onclick = updateDialog;
    const notice = await host.updateNotice().catch(() => null);
    if (notice) modal('Update', notice, [{ text: 'OK', primary: true }]);
    if (await host.autoUpdateCheck().catch(() => false)) checkForUpdate(false);
  }
  initVersion();

  if (!host) $('#btnSave').textContent = 'Download';
  renderHeader();
  window.RadicalHex = { openBytes }; // used by tests
  const boot = $('#boot'); // the loading screen: fade it out now the app is ready
  if (boot) { boot.classList.add('done'); setTimeout(() => boot.remove(), 200); }
})();
