// RadicalHex save core for Pokémon SoulGold (github.com/Eemeliri/soulgold), a GBA hack built on pokeemerald-expansion.
// Same functions as core.js (Radical Red), so the window can use either one. Every layout number below was read from
// the hack's source with the ARM compiler it is built with, then checked against real SoulGold saves.
// Works in the browser (window.SGCore) and in Node (require).
(function (root) {
  'use strict';

  // ── Layout ──
  // Each 4 KB flash sector: 3968 bytes of data, 116 bytes of SaveBlock3, then id, checksum, signature and counter.
  const SECTOR = 0x1000, DATA = 3968, SIG = 0x08012025;
  const SB2_SIZE = 0xB30, SB1_SIZE = 0x3C54, PS_SIZE = 43916; // SaveBlock2, SaveBlock1, PokemonStorage
  const SIZE = [SB2_SIZE, DATA, DATA, DATA, SB1_SIZE - 3 * DATA, DATA, DATA, DATA, DATA, DATA, DATA, DATA, DATA, DATA];
  // PokemonStorage is split: sectors 5-13 (35712 bytes), the slot's overflow sector (30/31), a 1944-byte tail kept in
  // SaveBlock1, and box 19 in the slot's auxiliary sector (28/29).
  const REG = 9 * DATA, TAIL = REG + DATA, B19 = TAIL + 1944; // 35712, 39680, 41624
  const SB1_TAIL = 0x349A;
  const MAGIC_BX16 = 0x36315842, MAGIC_BX19 = 0x39315842; // "BX16", "BX19"
  const EXT_MAGIC = 34740, BOX18_MAGIC = 37036, BOX18_SUM = 37040, BOX18_PAYLOAD = 37044; // offsets in PokemonStorage
  const OVERFLOW_SUMMED = BOX18_MAGIC - REG; // the overflow sector's own checksum covers its first 1324 bytes
  const AUX_HEADER = 12, AUX_PAYLOAD = 3880, AUX_RECORD = 3892;
  const BOX_MON = 76, PARTY_MON = 96, SLOTS = 30, BOXES = 19;
  // SaveBlock1 / SaveBlock2 offsets
  const PARTY_COUNT = 0x234, PARTY = 0x238, MONEY = 0x478, COINS = 0x47C, BAG = 0x548, FLAGS = 0x1898;
  const DEX_SEEN = 0x31F8, DEX_CAUGHT = 0x3279, DEX_BYTES = 129, NATIONAL_DEX = 1025;
  const KEY = 0xB4;
  const FLAG_RELEASE_SHINY_ODDS = 0x95E, SHINY_ODDS = 512, RELEASE_SHINY_ODDS = 256;
  const MONEY_MAX = 9999999, COINS_MAX = 9999, EV_CAP = 252, EV_TOTAL = 510;
  // SaveBlock3 rides in the 116 spare bytes after each section's data; it is 100 bytes, so it all sits in section 0.
  // The Candy Jar's stored EXP is SaveBlock3's candyJarExp (offset 0x60), XORed with the save's key like money.
  const SB3_SIZE = 100, CANDY_JAR = 0x60, CANDY_JAR_MAX = 99999999;
  // Battle Points (BP Mart, battle facilities): SaveBlock2 frontier.battlePoints, a plain u16.
  const BP = 0xA94, BP_MAX = 9999;
  // Bag pockets in SaveBlock1 order. key = the pocket an item belongs to (from the game's item table).
  const POCKETS = (() => {
    const list = [['items', 'Items', 150, 999], ['medicine', 'Medicine', 65, 999], ['key', 'Key Items', 50, 1], ['balls', 'Poké Balls', 27, 999],
      ['tms', 'TMs & HMs', 128, 1], ['megas', 'Mega Stones', 35, 1], ['battle', 'Battle Items', 100, 999], ['berries', 'Berries', 70, 999]];
    let off = 0;
    return list.map(([key, name, cap, max]) => { const p = { key, name, off, cap, max }; off += cap * 4; return p; });
  })();
  const NATURES = ['Hardy', 'Lonely', 'Brave', 'Adamant', 'Naughty', 'Bold', 'Docile', 'Relaxed', 'Impish', 'Lax',
    'Timid', 'Hasty', 'Serious', 'Jolly', 'Naive', 'Modest', 'Mild', 'Quiet', 'Bashful', 'Rash',
    'Calm', 'Gentle', 'Sassy', 'Careful', 'Quirky'];
  const NATURE_STATS = ['Atk', 'Def', 'Spe', 'SpA', 'SpD'];
  const natureEffect = n => (Math.floor(n / 5) === n % 5 ? 'neutral' : `+${NATURE_STATS[Math.floor(n / 5)]} −${NATURE_STATS[n % 5]}`);
  const STATS = ['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe'];
  const NEW_BARK_TOWN = 232, VERSION_EMERALD = 3, LANGUAGE_ENGLISH = 2;
  // Ball names come from the game's item table (SG_DATA.balls); this is the fallback for Node tests without data.
  let BALLS = ['Strange Ball', 'Poké Ball', 'Great Ball', 'Ultra Ball', 'Master Ball', 'Premier Ball', 'Heal Ball', 'Net Ball', 'Nest Ball',
    'Dive Ball', 'Dusk Ball', 'Timer Ball', 'Quick Ball', 'Repeat Ball', 'Luxury Ball', 'Level Ball', 'Lure Ball', 'Moon Ball', 'Friend Ball',
    'Love Ball', 'Fast Ball', 'Heavy Ball', 'Dream Ball', 'Safari Ball', 'Sport Ball', 'Park Ball', 'Beast Ball', 'Cherish Ball'];
  if (root.SG_DATA && Array.isArray(root.SG_DATA.balls)) BALLS = root.SG_DATA.balls;

  // ── Bytes ──
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const w16 = (b, o, v) => { b[o] = v & 255; b[o + 1] = (v >>> 8) & 255; };
  const w32 = (b, o, v) => { b[o] = v & 255; b[o + 1] = (v >>> 8) & 255; b[o + 2] = (v >>> 16) & 255; b[o + 3] = (v >>> 24) & 255; };
  // A bit field: width bits starting at bit `bit` of the byte at off (little-endian, at most 24 bits wide here).
  const getBits = (b, off, bit, width) => {
    const o = off + (bit >> 3), s = bit & 7;
    const v = b[o] | ((b[o + 1] || 0) << 8) | ((b[o + 2] || 0) << 16) | ((b[o + 3] || 0) << 24);
    return (v >>> s) & ((2 ** width) - 1);
  };
  const setBits = (b, off, bit, width, value) => {
    for (let i = 0; i < width; i++) {
      const p = bit + i, o = off + (p >> 3), m = 1 << (p & 7);
      if ((value >>> i) & 1) b[o] |= m; else b[o] &= ~m;
    }
  };
  function addWords(b, off, len, sum) {
    for (let i = 0; i < len; i += 4) sum = (sum + u32(b, off + i)) >>> 0;
    return sum;
  }
  const fold = s => ((s >>> 16) + s) & 0xFFFF;
  const checksum = (b, off, len) => fold(addWords(b, off, len & ~3, 0));

  // ── Text (the Gen 3 alphabet; names are 12 characters, trainer names 7) ──
  const ENC = { ' ': 0x00, 'é': 0x1B, '!': 0xAB, '?': 0xAC, '.': 0xAD, '-': 0xAE, '…': 0xB0, '“': 0xB1, '”': 0xB2,
    '‘': 0xB3, '’': 0xB4, "'": 0xB4, '♂': 0xB5, '♀': 0xB6, ',': 0xB8, '/': 0xBA, ':': 0xF0, '"': 0xB1 };
  for (let i = 0; i < 10; i++) ENC[String(i)] = 0xA1 + i;
  for (let i = 0; i < 26; i++) { ENC[String.fromCharCode(65 + i)] = 0xBB + i; ENC[String.fromCharCode(97 + i)] = 0xD5 + i; }
  const DEC = {};
  for (const [c, v] of Object.entries(ENC)) if (!(v in DEC) || c === "'" || c === '“') DEC[v] = c;
  function decodeText(b) {
    let s = '';
    for (const c of b) { if (c === 0xFF) break; s += DEC[c] ?? '?'; }
    return s;
  }
  function encodeText(str, len) {
    const out = new Uint8Array(len).fill(0xFF);
    const chars = [...str];
    if (chars.length > len) return null;
    for (let i = 0; i < chars.length; i++) {
      const v = ENC[chars[i]];
      if (v === undefined) return null;
      out[i] = v;
    }
    return out;
  }

  // ── Load ──
  const sigOk = (d, o) => u32(d, o + 0xFF8) === SIG;
  const newer = (x, y) => ((x === 0xFFFFFFFF && y === 0) || (x === 0 && y === 0xFFFFFFFF)) ? (x + 1) >>> 0 > (y + 1) >>> 0 : x > y;
  // One save slot, checked the way the game's GetSaveSlotStatus does: all 14 sections with valid checksums and the same
  // counter, then the storage overflow sector, the box 18 checksum across it and SaveBlock1, and the box 19 sector.
  function slotStatus(d, k) {
    const sec = Array(14).fill(-1);
    let counter = null, countersMatch = true, signed = false;
    for (let i = 0; i < 14; i++) {
      const o = (k * 14 + i) * SECTOR;
      if (!sigOk(d, o)) continue;
      signed = true;
      const id = u16(d, o + 0xFF4);
      if (id >= 14 || checksum(d, o, SIZE[id]) !== u16(d, o + 0xFF6)) continue;
      const n = u32(d, o + 0xFFC);
      if (counter === null) counter = n; else if (n !== counter) countersMatch = false;
      sec[id] = o;
    }
    const r = { k, sec, counter, signed, ok: false, why: '' };
    if (!signed) { r.why = 'empty'; return r; }
    if (sec.some(o => o < 0) || !countersMatch) { r.why = countersMatch ? 'incomplete' : 'mixed'; return r; }
    const end = sec[13] + (EXT_MAGIC - 8 * DATA);
    if (u32(d, end) !== MAGIC_BX16) { r.why = 'old-format'; return r; }
    const ov = (30 + k) * SECTOR, aux = (28 + k) * SECTOR;
    if (u16(d, ov + 0xFF4) !== 30 + k || !sigOk(d, ov) || u32(d, ov + 0xFFC) !== counter || u16(d, ov + 0xFF6) !== checksum(d, ov, OVERFLOW_SUMMED)) { r.why = 'overflow'; return r; }
    const ovMagic = u32(d, ov + (BOX18_MAGIC - REG)), sum = u16(d, ov + (BOX18_SUM - REG));
    if (ovMagic !== MAGIC_BX19) { r.why = 'old-format'; return r; }
    if (u16(d, ov + (BOX18_SUM - REG) + 2) !== ((~sum) & 0xFFFF)) { r.why = 'overflow'; return r; }
    let s = addWords(d, ov + (BOX18_PAYLOAD - REG), DATA - (BOX18_PAYLOAD - REG), MAGIC_BX19);
    s = addWords(d, sec[4] + (SB1_TAIL - 3 * DATA), 1944, s);
    if (fold(s) !== sum) { r.why = 'overflow'; return r; }
    if (u16(d, aux + 0xFF4) !== 28 + k || !sigOk(d, aux) || u32(d, aux + 0xFFC) !== counter || u16(d, aux + 0xFF6) !== checksum(d, aux, DATA)
      || u32(d, aux) !== MAGIC_BX19 || u16(d, aux + 4) !== 1 || u16(d, aux + 6) !== AUX_PAYLOAD
      || u16(d, aux + 10) !== ((~u16(d, aux + 8)) & 0xFFFF) || u16(d, aux + 8) !== checksum(d, aux + AUX_HEADER, AUX_PAYLOAD)) { r.why = 'box19'; return r; }
    if (d[sec[5]] >= BOXES) { r.why = 'current box'; return r; }
    r.ok = true;
    return r;
  }
  function load(input) {
    if (!input || input.length < 0x20000) throw new Error('This file is too small to be a GBA save (it must be at least 128 KB).');
    const data = new Uint8Array(input);
    const a = slotStatus(data, 0), b = slotStatus(data, 1);
    if (!a.signed && !b.signed) throw new Error('This is not a SoulGold save: it has no save data. Use the .sav/.srm battery save, not a save state.');
    if (!a.ok && !b.ok) {
      if (a.why === 'old-format' || b.why === 'old-format') throw new Error('This SoulGold save uses an older box layout. Load it in the latest SoulGold, save once, and open it again.');
      throw new Error('This is not a SoulGold save, or it is damaged: its save data does not check out.');
    }
    const use = !b.ok ? a : !a.ok ? b : newer(b.counter, a.counter) ? b : a, skip = use === a ? b : a;
    if (use.counter % 2 !== use.k) throw new Error('The save slots of this SoulGold save are out of order, so RadicalHex will not edit it.');
    // A newer save in the other slot that didn't check out: the game loads this (previous) one, and RadicalHex says so.
    let newerDamaged = null;
    for (let i = 0; i < 14; i++) {
      const o = (skip.k * 14 + i) * SECTOR;
      if (!sigOk(data, o) || u16(data, o + 0xFF4) >= 14) continue;
      const n = u32(data, o + 0xFFC);
      if (newer(n, use.counter) && (newerDamaged === null || newer(n, newerDamaged))) newerDamaged = n;
    }
    const sec = use.sec, ov = (30 + use.k) * SECTOR, aux = (28 + use.k) * SECTOR;
    const sb2 = data.slice(sec[0], sec[0] + SB2_SIZE);
    const sb3 = data.slice(sec[0] + DATA, sec[0] + DATA + SB3_SIZE);
    const sb1 = new Uint8Array(SB1_SIZE);
    for (let i = 1; i <= 4; i++) sb1.set(data.subarray(sec[i], sec[i] + SIZE[i]), (i - 1) * DATA);
    const ps = new Uint8Array(PS_SIZE);
    for (let i = 5; i <= 13; i++) ps.set(data.subarray(sec[i], sec[i] + DATA), (i - 5) * DATA);
    ps.set(data.subarray(ov, ov + DATA), REG);
    ps.set(sb1.subarray(SB1_TAIL, SB1_TAIL + 1944), TAIL);
    ps.set(data.subarray(aux + AUX_HEADER, aux + AUX_HEADER + (PS_SIZE - B19)), B19);
    const pc = sb1[PARTY_COUNT];
    if (pc > 6) throw new Error('The party count in this save is invalid, so RadicalHex will not edit it.');
    const flags = sb1.subarray(FLAGS);
    const odds = (flags[FLAG_RELEASE_SHINY_ODDS >> 3] >> (FLAG_RELEASE_SHINY_ODDS & 7)) & 1 ? RELEASE_SHINY_ODDS : SHINY_ODDS;
    return { game: 'sg', data, sec, slot: use.k, ov, aux, sb1, sb2, sb3, ps, odds, saveIndex: use.counter, newerDamaged, original: new Uint8Array(input) };
  }

  // ── Save ──
  // Writes the edited blocks back into the live slot (the older slot stays as the game's fallback) and recomputes every
  // checksum the game checks: each section, the box 18 checksum, the overflow sector, and the box 19 record and sector.
  function serialize(sv) {
    const out = new Uint8Array(sv.data);
    const ps = sv.ps.slice(), sb1 = sv.sb1.slice();
    sb1.set(ps.subarray(TAIL, B19), SB1_TAIL); // the storage tail lives in SaveBlock1
    w32(ps, EXT_MAGIC, MAGIC_BX16);
    w32(ps, BOX18_MAGIC, MAGIC_BX19);
    const s18 = fold(addWords(ps, BOX18_PAYLOAD, B19 - BOX18_PAYLOAD, MAGIC_BX19));
    w16(ps, BOX18_SUM, s18); w16(ps, BOX18_SUM + 2, (~s18) & 0xFFFF);
    const sec = sv.sec;
    out.set(sv.sb2, sec[0]);
    out.set(sv.sb3, sec[0] + DATA); // not covered by the section checksum (as in the game)
    for (let i = 1; i <= 4; i++) out.set(sb1.subarray((i - 1) * DATA, (i - 1) * DATA + SIZE[i]), sec[i]);
    for (let i = 5; i <= 13; i++) out.set(ps.subarray((i - 5) * DATA, (i - 4) * DATA), sec[i]);
    for (let i = 0; i < 14; i++) w16(out, sec[i] + 0xFF6, checksum(out, sec[i], SIZE[i]));
    out.set(ps.subarray(REG, TAIL), sv.ov);
    w16(out, sv.ov + 0xFF6, checksum(out, sv.ov, OVERFLOW_SUMMED));
    out.set(ps.subarray(B19), sv.aux + AUX_HEADER);
    const rs = checksum(out, sv.aux + AUX_HEADER, AUX_PAYLOAD);
    w16(out, sv.aux + 8, rs); w16(out, sv.aux + 10, (~rs) & 0xFFFF);
    w16(out, sv.aux + 0xFF6, checksum(out, sv.aux, DATA));
    return out;
  }

  // File ranges RadicalHex may change. Anything else changing means a bug, and the save is refused.
  function allowedRanges(sv) {
    const s = sv.sec, r = [];
    const sb1Range = (a, b) => { // a SaveBlock1 range, split across its sectors
      for (let i = 1; i <= 4; i++) {
        const lo = Math.max(a, (i - 1) * DATA), hi = Math.min(b, (i - 1) * DATA + SIZE[i]);
        if (lo < hi) r.push([s[i] + lo - (i - 1) * DATA, s[i] + hi - (i - 1) * DATA]);
      }
    };
    sb1Range(PARTY_COUNT, PARTY + 6 * PARTY_MON);
    sb1Range(MONEY, COINS + 2);
    sb1Range(BAG, BAG + POCKETS.reduce((n, p) => n + p.cap * 4, 0));
    sb1Range(DEX_SEEN, DEX_CAUGHT + DEX_BYTES);
    sb1Range(SB1_TAIL, SB1_TAIL + 1944);
    r.push([s[0] + DATA + CANDY_JAR, s[0] + DATA + CANDY_JAR + 4], [s[0] + BP, s[0] + BP + 2]);
    for (let i = 5; i <= 13; i++) r.push([s[i], s[i] + DATA]);
    for (let i = 0; i < 14; i++) r.push([s[i] + 0xFF6, s[i] + 0xFF8]);
    r.push([sv.ov, sv.ov + DATA], [sv.ov + 0xFF6, sv.ov + 0xFF8]);
    r.push([sv.aux + 8, sv.aux + AUX_HEADER + (PS_SIZE - B19)], [sv.aux + 0xFF6, sv.aux + 0xFF8]);
    return r;
  }

  function build(sv, D) {
    const out = serialize(sv);
    const errors = [];
    if (out.length !== sv.original.length) errors.push('The file size changed.');
    let check;
    try { check = load(out); } catch (e) { errors.push('The edited file does not load: ' + e.message); }
    if (check && (check.slot !== sv.slot || check.saveIndex !== sv.saveIndex)) errors.push('The edited file would load a different save slot.');
    const ranges = allowedRanges(sv);
    for (let i = 0; i < out.length; i++) {
      if (out[i] === sv.original[i]) continue;
      if (!ranges.some(([a, b]) => i >= a && i < b)) { errors.push(`Unexpected change at byte 0x${i.toString(16)}.`); break; }
    }
    if (check) {
      const before = load(sv.original);
      const same = (a, b, n) => a.buf.subarray(a.off, a.off + n).every((v, k) => v === b.buf[b.off + k]);
      for (let i = 0; i < 6; i++) {
        const m = partyRef(check, i), o = partyRef(before, i);
        if (!same(m, o, PARTY_MON) && !mon.empty(m)) { const p = validateMon(m, o, D); if (p) errors.push(`Party slot ${i + 1}: ${p}`); }
      }
      for (let b = 0; b < BOXES; b++) for (let s = 0; s < SLOTS; s++) {
        const m = boxRef(check, b, s), o = boxRef(before, b, s);
        if (!same(m, o, BOX_MON) && !mon.empty(m)) { const p = validateMon(m, o, D); if (p) errors.push(`Box ${b + 1} slot ${s + 1}: ${p}`); }
      }
      for (const p of POCKETS) {
        const now = readPocket(check, p), was = readPocket(before, p);
        if (JSON.stringify(now) === JSON.stringify(was)) continue;
        for (const it of now) if (!validItem(D, it.id) || it.qty < 1 || it.qty > 999) errors.push(`${p.name}: invalid entry (item ${it.id} ×${it.qty}).`);
      }
      if (partyCount(check) !== partyCount(before))
        for (let i = 0; i < partyCount(check); i++) if (mon.empty(partyRef(check, i))) errors.push(`The party count is ${partyCount(check)} but party slot ${i + 1} is empty.`);
    }
    if (errors.length) throw new Error('RadicalHex stopped the save to protect your file:\n' + errors.join('\n'));
    return out;
  }

  const validSpecies = (D, id) => !!(D.species[id] && D.species[id].n);
  const validItem = (D, id) => id === 0 || !!(D.items[id]);
  const validMove = (D, id) => id === 0 || (id < D.moves.length && !!D.moves[id]);
  function validateMon(m, o, D) {
    const sp = mon.species(m);
    if (!validSpecies(D, sp)) return `unknown species #${sp}.`;
    const curve = growth(D, sp);
    if (curve && mon.exp(m) > curve[100]) return 'EXP is above the level 100 maximum.';
    const mv = mon.moves(m), old = mon.empty(o) ? [] : mon.moves(o);
    if (!mv.some(x => x)) return 'it has no moves.';
    for (let i = 0; i < 4; i++) if (!validMove(D, mv[i]) && mv[i] !== old[i]) return `unknown move #${mv[i]}.`;
    const it = mon.item(m);
    if (!validItem(D, it) && (mon.empty(o) || it !== mon.item(o))) return `unknown held item #${it}.`;
    if (!BALLS[mon.ball(m)]) return 'unknown Poké Ball.';
    if (m.party && (mon.level(m) < 1 || mon.level(m) > 100)) return 'level is out of range.';
    return null;
  }

  // ── Slots ──
  const partyCount = sv => Math.min(6, sv.sb1[PARTY_COUNT]);
  const partyRef = (sv, i) => ({ buf: sv.sb1, off: PARTY + PARTY_MON * i, party: true, odds: sv.odds });
  const boxOff = (box, slot) => (box < 15 ? 4 + (box * SLOTS + slot) * BOX_MON
    : box === 15 ? 0x87B8 + slot * BOX_MON
      : box < 18 ? 0x90B4 + ((box - 16) * SLOTS + slot) * BOX_MON
        : 0xA298 + slot * BOX_MON);
  const boxRef = (sv, box, slot) => ({ buf: sv.ps, off: boxOff(box, slot), party: false, odds: sv.odds });
  const boxNameOff = box => (box < 15 ? 0x859C + 9 * box : box === 15 ? 0x90A0 : box < 18 ? 0xA284 + 9 * (box - 16) : 0xAB80);
  function boxName(sv, box) {
    const o = boxNameOff(box);
    const n = decodeText(sv.ps.subarray(o, o + 9));
    return n.trim() ? n : 'Box ' + (box + 1);
  }

  // ── One Pokémon ──
  // 76-byte BoxPokemon, unencrypted, with bit fields (positions from the ARM compiler); a party Pokémon adds 20 bytes.
  const S = 32; // start of the "secure" data
  const B = (m, bit, w) => getBits(m.buf, m.off, bit, w);
  const SB = (m, bit, w, v) => setBits(m.buf, m.off, bit, w, v);
  const shinyValue = m => { const o = mon.otid(m), p = mon.pid(m); return ((o >>> 16) ^ (o & 0xFFFF) ^ (p >>> 16) ^ (p & 0xFFFF)) >>> 0; };
  const erased = m => { for (let i = m.off, end = m.off + (m.party ? PARTY_MON : BOX_MON); i < end; i++) if (m.buf[i] !== 0xFF) return false; return true; };
  function clearErased(sv) {
    let n = 0;
    for (let b = 0; b < BOXES; b++) for (let s = 0; s < SLOTS; s++) {
      const m = boxRef(sv, b, s);
      if (mon.species(m) === 0x7FF && erased(m)) { m.buf.fill(0, m.off, m.off + BOX_MON); n++; }
    }
    return n;
  }
  const MOVE_BITS = [S * 8 + 96, S * 8 + 112, S * 8 + 128, S * 8 + 144]; // 11 bits each
  const PP_BYTES = [S + 20, S + 21, S + 22, S + 23]; // 7 bits each (the top bit is a hyper-training flag)
  const mon = {
    empty: m => { const sp = mon.species(m); return sp === 0 || (sp === 0x7FF && erased(m)); },
    pid: m => u32(m.buf, m.off),
    setPid: (m, v) => w32(m.buf, m.off, v),
    otid: m => u32(m.buf, m.off + 4),
    nickname: m => decodeText(m.buf.subarray(m.off + 8, m.off + 20)),
    setNickname(m, s) { const b = encodeText(s, 12); if (!b) return false; m.buf.set(b, m.off + 8); return true; },
    otName: m => decodeText(m.buf.subarray(m.off + 22, m.off + 29)),
    setOtName(m, s) { const b = encodeText(s, 7); if (!b) return false; m.buf.set(b, m.off + 22); return true; },
    species: m => B(m, S * 8, 11),
    setSpecies: (m, v) => { SB(m, S * 8, 11, v); SB(m, 169, 1, v ? 1 : 0); }, // hasSpecies flag
    item: m => B(m, (S + 2) * 8, 10),
    setItem: (m, v) => SB(m, (S + 2) * 8, 10, v),
    item2: m => B(m, (S + 8) * 8, 10),
    exp: m => B(m, (S + 4) * 8, 24),
    setExp: (m, v) => SB(m, (S + 4) * 8, 24, v),
    friendship: m => m.buf[m.off + S + 11],
    setFriendship: (m, v) => { m.buf[m.off + S + 11] = v; },
    ball: m => B(m, (S + 2) * 8 + 10, 6),
    setBall: (m, v) => SB(m, (S + 2) * 8 + 10, 6, v),
    level: m => (m.party ? m.buf[m.off + 80] : null),
    moves: m => MOVE_BITS.map(bit => B(m, bit, 11)),
    setMoves(m, mv, D) {
      const old = mon.moves(m);
      for (let i = 0; i < 4; i++) {
        if (mv[i] === old[i]) continue;
        SB(m, MOVE_BITS[i], 11, mv[i]);
        SB(m, PP_BYTES[i] * 8, 7, Math.min(127, D.pp[mv[i]] || 0)); // full PP for the new move
        m.buf[m.off + S + 10] &= ~(3 << (2 * i)); // no PP Ups for that slot
      }
    },
    movePp: m => (m.party ? PP_BYTES.map(o => m.buf[m.off + o] & 0x7F) : null),
    // UI order HP Atk Def SpA SpD Spe. Stored EV order HP Atk Def Spe SpA SpD.
    evs(m) { const b = m.off + S + 24, d = m.buf; return [d[b], d[b + 1], d[b + 2], d[b + 4], d[b + 5], d[b + 3]]; },
    setEvs(m, v) { const b = m.off + S + 24, d = m.buf; d[b] = v[0]; d[b + 1] = v[1]; d[b + 2] = v[2]; d[b + 3] = v[5]; d[b + 4] = v[3]; d[b + 5] = v[4]; },
    ivWord: m => u32(m.buf, m.off + S + 40),
    ivs(m) { const w = mon.ivWord(m), g = s => (w >>> s) & 31; return [g(0), g(5), g(10), g(20), g(25), g(15)]; },
    setIvs(m, v) {
      const w = ((mon.ivWord(m) & 0xC0000000) | v[0] | (v[1] << 5) | (v[2] << 10) | (v[5] << 15) | (v[3] << 20) | (v[4] << 25)) >>> 0;
      w32(m.buf, m.off + S + 40, w);
    },
    abilityNum: m => B(m, (S + 19) * 8 + 4, 2),
    setAbilityNum: (m, v) => SB(m, (S + 19) * 8 + 4, 2, v),
    hiddenAbility: m => mon.abilityNum(m) === 2,
    setHiddenAbility(m, on) { if (on) mon.setAbilityNum(m, 2); else if (mon.abilityNum(m) === 2) mon.setAbilityNum(m, 0); },
    isEgg: m => ((mon.ivWord(m) >>> 30) & 1) === 1 || B(m, 170, 1) === 1,
    abilitySlot: m => Math.min(mon.abilityNum(m), 1) + 1,
    abilityIndex: m => mon.abilityNum(m),
    // Nature: the personality's nature, changed by the "hidden nature" bits (how the game applies Mints).
    nature: m => ((mon.pid(m) % 25) ^ B(m, 163, 5)) % 25,
    setNature: (m, n) => SB(m, 163, 5, (mon.pid(m) % 25) ^ n),
    // Shiny: the usual personality/ID check against the save's shiny odds, flipped by the shiny bit (the game's own way).
    shiny: m => ((shinyValue(m) < (m.odds || RELEASE_SHINY_ODDS) ? 1 : 0) ^ B(m, 254, 1)) === 1,
    setShiny: (m, on) => SB(m, 254, 1, (shinyValue(m) < (m.odds || RELEASE_SHINY_ODDS) ? 1 : 0) ^ (on ? 1 : 0)),
    metLocation: m => m.buf[m.off + S + 37] | (B(m, (S + 9) * 8 + 2, 1) << 8) | (B(m, (S + 17) * 8 + 3, 5) << 9) | (B(m, (S + 19) * 8 + 3, 1) << 14),
    setMetLocation(m, v) {
      m.buf[m.off + S + 37] = v & 0xFF;
      const hi = (v >>> 8) & 0x7F;
      SB(m, (S + 9) * 8 + 2, 1, hi & 1); SB(m, (S + 17) * 8 + 3, 5, (hi >>> 1) & 0x1F); SB(m, (S + 19) * 8 + 3, 1, (hi >>> 6) & 1);
    },
    metLevel: m => B(m, (S + 38) * 8, 7),
    setMetLevel: (m, v) => SB(m, (S + 38) * 8, 7, v & 0x7F),
    otGender: m => B(m, (S + 39) * 8 + 3, 1),
    setOtGender: (m, g) => SB(m, (S + 39) * 8 + 3, 1, g & 1),
    partyStats: m => (m.party ? [84, 86, 88, 92, 94, 90].map(o => u16(m.buf, m.off + o)) : null),
  };

  // ── Healing ──
  const STATUS = ['', 'Asleep', 'Poisoned', 'Burned', 'Frozen', 'Paralyzed', 'Badly poisoned', 'Frostbitten'];
  function partyStatus(m) {
    if (!m.party) return '';
    const s = u32(m.buf, m.off + 76), hp = u16(m.buf, m.off + 82);
    if (hp === 0) return 'Fainted';
    if (s & 7) return 'Asleep';
    if (s & 0x80) return 'Badly poisoned';
    if (s & 0x08) return 'Poisoned';
    if (s & 0x10) return 'Burned';
    if (s & 0x20) return 'Frozen';
    if (s & 0x40) return 'Paralyzed';
    if (s & 0x1000) return 'Frostbitten';
    return '';
  }
  const maxPp = (D, move, ups) => { const base = D.pp[move] || 0; return base + Math.floor(base * 20 * ups / 100); };
  // The game keeps HP lost and status in the box part too (SetMonData HP/STATUS), so both are updated.
  const setHp = (m, hp) => { w16(m.buf, m.off + 82, hp); SB(m, 240, 14, Math.max(0, u16(m.buf, m.off + 84) - hp)); };
  function heal(D, m) {
    if (!m.party || mon.empty(m)) return false;
    const before = m.buf.slice(m.off, m.off + PARTY_MON);
    w32(m.buf, m.off + 76, 0); SB(m, 236, 4, 0); // status, and its copy in the box part
    setHp(m, u16(m.buf, m.off + 84));
    const mv = mon.moves(m), ups = m.buf[m.off + S + 10];
    for (let i = 0; i < 4; i++) SB(m, PP_BYTES[i] * 8, 7, mv[i] ? Math.min(127, maxPp(D, mv[i], (ups >> (2 * i)) & 3)) : 0);
    return m.buf.subarray(m.off, m.off + PARTY_MON).some((v, k) => v !== before[k]);
  }

  // ── Battle stats (the game's CalculateMonStats: hyper-trained IVs count as 31, nature from the hidden nature) ──
  const HYPER = [(S + 19) * 8 + 6, (S + 19) * 8 + 7, (S + 20) * 8 + 7, (S + 22) * 8 + 7, (S + 23) * 8 + 7, (S + 21) * 8 + 7]; // HP Atk Def SpA SpD Spe
  function calcStats(D, X, m) {
    const x = X && X.species[mon.species(m)];
    if (!x || !m.party) return null;
    const L = expLevel(D, m) || mon.level(m), iv = mon.ivs(m).map((v, i) => (B(m, HYPER[i], 1) ? 31 : v)), ev = mon.evs(m);
    const n = mon.nature(m), up = Math.floor(n / 5), down = n % 5;
    const natureIndex = [null, 0, 1, 3, 4, 2];
    return x.st.map((b, i) => {
      if (i === 0) return x.nat === 292 ? 1 : Math.floor((2 * b + iv[0] + Math.floor(ev[0] / 4)) * L / 100) + L + 10; // Shedinja: 1
      let v = Math.floor((2 * b + iv[i] + Math.floor(ev[i] / 4)) * L / 100) + 5;
      if (up !== down) { if (natureIndex[i] === up) v = Math.floor(v * 110 / 100); else if (natureIndex[i] === down) v = Math.floor(v * 90 / 100); }
      return v;
    });
  }
  const STAT_OFFSETS = [84, 86, 88, 92, 94, 90];
  function recalcStats(D, X, m) {
    const s = calcStats(D, X, m);
    if (!s) return false;
    const oldMax = u16(m.buf, m.off + 84), hp = u16(m.buf, m.off + 82);
    STAT_OFFSETS.forEach((o, i) => w16(m.buf, m.off + o, s[i]));
    setHp(m, hp === 0 ? 0 : Math.max(1, Math.min(s[0], hp + s[0] - oldMax)));
    return true;
  }

  // ── Legality ──
  const learnCache = new Map(), levelCache = new Map();
  const learnSet = (X, sp) => { if (!learnCache.has(sp)) learnCache.set(sp, new Set(X.species[sp] ? X.species[sp].ln : [])); return learnCache.get(sp); };
  const levelOnly = (X, sp) => { if (!levelCache.has(sp)) levelCache.set(sp, new Map((X.species[sp] && X.species[sp].lo || []).map(e => [e[0], e]))); return levelCache.get(sp); };
  function expLevel(D, m) {
    const t = growth(D, mon.species(m));
    if (!t) return null;
    let L = 1;
    while (L < 100 && t[L + 1] <= mon.exp(m)) L++;
    return L;
  }
  function legality(D, X, m) {
    const out = [], add = (level, text, field) => out.push({ level, text, field });
    const sp = mon.species(m), s = D.species[sp], x = X.species[sp], name = s && s.n ? s.n : `#${sp}`;
    if (mon.isEgg(m)) return [{ level: 'info', text: 'Eggs are not checked.' }];
    if (s && s.b) add('error', `${name} is a battle-only form and can't exist outside battle.`, 'species');
    if (!x) { add('info', `There is no SoulGold data for ${name}, so it can't be checked.`); return out; }
    const mv = mon.moves(m), set = learnSet(X, sp);
    if (!mv.some(Boolean)) add('error', 'It has no moves.', 'moves');
    mv.forEach((id, i) => { if (id && !set.has(id)) add('error', `${name} can't learn ${D.moves[id] || '#' + id} in SoulGold (not a level-up, TM, tutor, egg or pre-evolution move).`, 'move' + i); });
    const lvNow = expLevel(D, m), lo = levelOnly(X, sp);
    if (lvNow) mv.forEach((id, i) => {
      const e = id && set.has(id) && lo.get(id);
      if (!e || e[1] <= lvNow) return;
      add('warn', e[2] === sp ? `${name} learns ${D.moves[id]} by levelling up at level ${e[1]}, but it is level ${lvNow}.`
        : `${D.moves[id]} is learned by levelling up at level ${e[1]} (by its pre-evolution ${(D.species[e[2]] && D.species[e[2]].n) || '#' + e[2]}), but it is level ${lvNow}.`, 'move' + i);
    });
    const dup = mv.find((id, i) => id && mv.indexOf(id) !== i);
    if (dup) add('error', `${D.moves[dup] || '#' + dup} is in two move slots.`, 'moves');
    const ev = mon.evs(m), total = ev.reduce((a, b) => a + b, 0), over = STATS.filter((_, i) => ev[i] > EV_CAP);
    if (total > EV_TOTAL) add('error', `Its EVs add up to ${total}. A Pokémon can have at most ${EV_TOTAL}.`, 'evs');
    if (over.length) add('error', `${over.join(', ')} ${over.length > 1 ? 'EVs are' : 'EV is'} above ${EV_CAP}, the most one stat can have.`, 'evs');
    const an = mon.abilityNum(m);
    if (an === 3) add('error', 'Its ability slot is invalid.', 'ability');
    else if (an && !x.ab[an]) add('warn', `${name} has no ${an === 2 ? 'hidden ability' : 'second ability'} in SoulGold, so the game uses its first ability.`, 'ability');
    const L = expLevel(D, m);
    if (L && mon.metLevel(m) > L) add('warn', `It was met at level ${mon.metLevel(m)} but its EXP only reaches level ${L}.`, 'level');
    if (!mon.otName(m)) add('error', 'It has no original trainer name.', 'origin');
    if (X.metNames && !X.metNames[mon.metLocation(m)]) add('warn', `Its met location (#${mon.metLocation(m)}) is not a real place.`, 'origin');
    const it = mon.item(m);
    if (it && pocketOf(D, it) === 'key') add('warn', `${D.items[it] || 'That item'} is a key item, which Pokémon can't normally hold.`, 'item');
    if (m.party) {
      if (L && mon.level(m) !== L) add('warn', `Its level (${mon.level(m)}) doesn't match its EXP (level ${L}).`, 'level');
      const c = calcStats(D, X, m);
      if (c && c.join() !== mon.partyStats(m).join()) add('warn', 'Its battle stats are out of date.', 'stats');
    }
    return out;
  }
  const isIllegal = (D, X, m) => legality(D, X, m).some(p => p.level === 'error');
  function clampEvs(evs) {
    let left = EV_TOTAL;
    return evs.map(v => { const x = Math.max(0, Math.min(EV_CAP, left, v | 0)); left -= x; return x; });
  }

  // ── Species helpers ──
  // The species' base friendship (the game's gSpeciesInfo[].friendship; most are 50 in SoulGold).
  const baseFriendship = (D, sp) => (D.species[sp] && D.species[sp].f) ?? 50;
  const growth = (D, sp) => (D.species[sp] && D.species[sp].g ? D.exp[D.species[sp].g - 1] : null);
  function levelOf(D, m) {
    if (m.party) return mon.level(m);
    return expLevel(D, m);
  }
  function setLevel(D, m, L) {
    const t = growth(D, mon.species(m));
    if (!t) return false;
    L = Math.max(1, Math.min(100, L));
    mon.setExp(m, t[L]);
    if (m.party) m.buf[m.off + 80] = L;
    return true;
  }
  function setExp(D, m, e) {
    const t = growth(D, mon.species(m));
    if (!t) return false;
    mon.setExp(m, Math.max(0, Math.min(t[100], Math.floor(e) || 0)));
    if (m.party) m.buf[m.off + 80] = expLevel(D, m);
    return true;
  }
  const genderRatio = (D, sp) => (D.species[sp] && D.species[sp].gr !== undefined ? D.species[sp].gr : 127);
  function genderOf(D, m) {
    const gr = genderRatio(D, mon.species(m));
    if (gr === 255) return 2;
    if (gr === 254) return 1;
    if (gr === 0) return 0;
    return (mon.pid(m) & 0xFF) < gr ? 1 : 0;
  }
  // The name the game gives this species: its own species name (forms share their base name).
  function defaultNickname(D, sp) {
    const s = D.species[sp];
    if (!s || !s.n) return '';
    return [...(s.nn || s.n)].map(c => (c === '’' ? "'" : c)).slice(0, 12).join('');
  }

  // ── Personality ──
  // In SoulGold nature and shininess are separate from the personality (the game's own nature and shiny bits), so
  // the personality only decides gender here and is changed only for that.
  // A personality that already gives the nature and shininess, like a Pokémon caught in the game
  // (so the hidden nature and shiny bits stay 0). With nature or shiny left out, any value fits that part.
  function solvePid({ otid, nature = null, shiny = null, odds = RELEASE_SHINY_ODDS, gender = null, ratio = 127 }, rnd = Math.random) {
    const r = n => Math.floor(rnd() * n), ids = ((otid >>> 16) ^ (otid & 0xFFFF)) >>> 0;
    for (let n = 0; n < 100000; n++) {
      const lo = r(65536);
      if (gender !== null && ratio > 0 && ratio < 254 && (((lo & 0xFF) < ratio) !== (gender === 1))) continue;
      const sv = shiny === null ? r(65536) : shiny ? r(odds) : odds + r(65536 - odds);
      const pid = ((((ids ^ lo ^ sv) & 0xFFFF) << 16) | lo) >>> 0;
      if (nature === null || pid % 25 === nature) return pid;
    }
    throw new Error('Could not find a matching personality value.');
  }
  // Keeps a Pokémon's nature and shininess when its personality or IDs change.
  function keepLooks(m, fn) {
    const n = mon.nature(m), sh = mon.shiny(m);
    fn();
    mon.setNature(m, n); mon.setShiny(m, sh);
  }
  function setNatureShiny(m, nature, shiny) {
    mon.setNature(m, nature);
    mon.setShiny(m, shiny);
  }
  function abilityName(X, m) {
    const x = X && X.species[mon.species(m)];
    if (!x) return '';
    const an = mon.abilityNum(m);
    return (an < 3 && x.ab[an]) || x.ab[0];
  }
  function setAbility(D, m, index) { mon.setAbilityNum(m, Math.max(0, Math.min(2, index | 0))); }
  function setOtIds(D, m, tid, sid) {
    keepLooks(m, () => w32(m.buf, m.off + 4, (((sid & 0xFFFF) << 16) | (tid & 0xFFFF)) >>> 0));
  }
  function makeMine(sv, D, m) {
    const t = trainer(sv);
    m.buf.set(t.nameBytes, m.off + 22);
    mon.setOtGender(m, t.gender & 1);
    setOtIds(D, m, t.tid, t.sid);
  }
  // Gender comes from the personality's low byte; only that byte changes (bit 0 kept: it picks the default Tera type).
  function setGender(D, m, gender) {
    const ratio = genderRatio(D, mon.species(m));
    if (ratio === 0 || ratio >= 254) return false;
    const old = mon.pid(m);
    let low = -1;
    for (let v = 0; v < 256; v++) if (((v < ratio) === (gender === 1)) && (v & 1) === (old & 1)) { low = v; if (Math.random() < 0.5) break; }
    if (low < 0) for (let v = 0; v < 256; v++) if ((v < ratio) === (gender === 1)) { low = v; break; }
    if (low < 0) return false;
    keepLooks(m, () => mon.setPid(m, ((old & 0xFFFFFF00) | low) >>> 0));
    return true;
  }

  // ── Trainer ──
  const key = sv => u32(sv.sb2, KEY);
  function trainer(sv) {
    const k = key(sv);
    return {
      name: decodeText(sv.sb2.subarray(0, 8)),
      nameBytes: sv.sb2.slice(0, 7),
      gender: sv.sb2[8],
      tid: u16(sv.sb2, 0xA), sid: u16(sv.sb2, 0xC),
      money: (u32(sv.sb1, MONEY) ^ k) >>> 0,
      coins: (u16(sv.sb1, COINS) ^ (k & 0xFFFF)) & 0xFFFF,
    };
  }
  const setMoney = (sv, v) => w32(sv.sb1, MONEY, (Math.max(0, Math.min(MONEY_MAX, v)) ^ key(sv)) >>> 0);
  const setCoins = (sv, v) => w16(sv.sb1, COINS, (Math.max(0, Math.min(COINS_MAX, v)) ^ key(sv)) & 0xFFFF);
  const bp = sv => u16(sv.sb2, BP);
  const setBp = (sv, v) => w16(sv.sb2, BP, Math.max(0, Math.min(BP_MAX, Math.floor(v) || 0)));
  // The Candy Jar (a key item): EXP it has stored from battles, turned into Exp. Candies when used.
  const candyJar = sv => (u32(sv.sb3, CANDY_JAR) ^ key(sv)) >>> 0;
  const setCandyJar = (sv, v) => w32(sv.sb3, CANDY_JAR, (Math.max(0, Math.min(CANDY_JAR_MAX, Math.floor(v) || 0)) ^ key(sv)) >>> 0);

  // ── Bag (quantities are XORed with the save's key, as in every pocket of the game's bag) ──
  function readPocket(sv, p) {
    const k = key(sv) & 0xFFFF, items = [];
    for (let s = 0; s < p.cap; s++) {
      const o = BAG + p.off + s * 4, id = u16(sv.sb1, o), qty = (u16(sv.sb1, o + 2) ^ k) & 0xFFFF;
      if (!id) break;
      items.push({ id, qty });
    }
    return items;
  }
  function writePocket(sv, p, items) {
    if (items.length > p.cap) throw new Error(`${p.name} can hold ${p.cap} different items.`);
    const k = key(sv) & 0xFFFF;
    for (let s = 0; s < p.cap; s++) {
      const o = BAG + p.off + s * 4;
      if (s < items.length) { w16(sv.sb1, o, items[s].id); w16(sv.sb1, o + 2, (items[s].qty ^ k) & 0xFFFF); }
      else { w16(sv.sb1, o, 0); w16(sv.sb1, o + 2, k); } // an empty slot holds quantity 0, stored XORed like the game
    }
  }
  const pocketOf = (D, id) => (D.pocket && D.pocket[id]) || 'items';

  // ── Pokédex (seen and caught bitmaps in SaveBlock1; bit n-1 = national number n) ──
  function dexBit(sv, base, nat, on) {
    if (nat < 1 || nat > NATIONAL_DEX) return false;
    const o = base + ((nat - 1) >> 3), bit = 1 << ((nat - 1) & 7);
    if (on === undefined) return (sv.sb1[o] & bit) !== 0;
    sv.sb1[o] = on ? sv.sb1[o] | bit : sv.sb1[o] & ~bit;
    return on;
  }
  const dex = {
    seen: (sv, nat) => dexBit(sv, DEX_SEEN, nat),
    caught: (sv, nat) => dexBit(sv, DEX_CAUGHT, nat),
    register(sv, nat) { dexBit(sv, DEX_SEEN, nat, true); dexBit(sv, DEX_CAUGHT, nat, true); },
    count(sv) {
      const c = base => { let n = 0; for (let nat = 1; nat <= NATIONAL_DEX; nat++) if (dexBit(sv, base, nat)) n++; return n; };
      return { seen: c(DEX_SEEN), caught: c(DEX_CAUGHT) };
    },
    repair: () => 0, // no older RadicalHex ever wrote SoulGold saves
  };
  function registerOwned(sv, D) {
    const out = new Set();
    const check = m => {
      if (mon.empty(m) || mon.isEgg(m)) return;
      const nat = D.species[mon.species(m)] && D.species[mon.species(m)].nat;
      if (!nat || nat > NATIONAL_DEX) return;
      if (!dex.caught(sv, nat)) out.add(nat);
      dex.register(sv, nat);
    };
    for (let i = 0; i < partyCount(sv); i++) check(partyRef(sv, i));
    for (let b = 0; b < BOXES; b++) for (let s = 0; s < SLOTS; s++) check(boxRef(sv, b, s));
    return [...out];
  }

  // ── Creating, copying and moving ──
  function createInBox(sv, D, ref, opts) {
    if (ref.party) throw new Error('New Pokémon go into a box. Withdraw them in the game to add them to the party.');
    if (!mon.empty(ref)) throw new Error('That box slot is not empty.');
    if (!validSpecies(D, opts.species)) throw new Error('Choose a species from the list.');
    if (!growth(D, opts.species)) throw new Error('RadicalHex has no level data for this species, so it cannot create it.');
    if (!opts.moves.some(x => x)) throw new Error('Give it at least one move.');
    const t = trainer(sv), otid = ((t.sid << 16) | t.tid) >>> 0;
    const nick = encodeText(opts.nickname || defaultNickname(D, opts.species), 12);
    if (!nick) throw new Error('The nickname uses a character the game cannot show.');
    const b = new Uint8Array(BOX_MON), m = { buf: b, off: 0, party: false, odds: sv.odds };
    const ratio = genderRatio(D, opts.species);
    w32(b, 0, solvePid({ otid, nature: opts.nature | 0, shiny: !!opts.shiny, odds: sv.odds || RELEASE_SHINY_ODDS, gender: opts.gender, ratio }));
    w32(b, 4, otid);
    b.set(nick, 8);
    SB(m, 160, 3, LANGUAGE_ENGLISH);
    b.set(t.nameBytes, 22);
    mon.setSpecies(m, opts.species);
    mon.setItem(m, opts.item || 0);
    const L = Math.max(1, Math.min(100, opts.level | 0));
    mon.setExp(m, growth(D, opts.species)[L]);
    mon.setFriendship(m, opts.friendship ?? baseFriendship(D, opts.species));
    mon.setBall(m, opts.ball ?? 1);
    mon.setMoves(m, opts.moves.map(x => x | 0), D);
    mon.setEvs(m, opts.evs || [0, 0, 0, 0, 0, 0]);
    mon.setMetLocation(m, opts.metLocation ?? NEW_BARK_TOWN);
    mon.setMetLevel(m, L);
    SB(m, (S + 38) * 8 + 7, 4, VERSION_EMERALD);
    mon.setOtGender(m, t.gender & 1);
    mon.setIvs(m, opts.ivs || [31, 31, 31, 31, 31, 31]);
    mon.setAbilityNum(m, opts.hidden ? 2 : Math.max(0, Math.min(2, opts.ability | 0)));
    setNatureShiny(m, opts.nature | 0, !!opts.shiny);
    ref.buf.set(b, ref.off);
  }
  const release = ref => { if (!ref.party) ref.buf.fill(0, ref.off, ref.off + BOX_MON); };

  // The game's BoxMonToMon: the box data is kept as it is, status comes from the box part, no mail, stats calculated,
  // and HP is max HP minus the HP the Pokémon had lost.
  function boxToParty(D, X, src, dst) {
    const sp = mon.species(src), name = (D.species[sp] && D.species[sp].n) || `#${sp}`;
    if (!X || !X.species[sp]) throw new Error(`RadicalHex has no SoulGold stat data for ${name}, so it can't put it in the party. It can stay in a box.`);
    if (!growth(D, sp)) throw new Error(`RadicalHex has no level data for ${name}, so it can't put it in the party. It can stay in a box.`);
    const b = dst.buf, o = dst.off;
    const lost = getBits(src.buf, src.off, 240, 14), cs = getBits(src.buf, src.off, 236, 4);
    const STATUS_OF = [0, 1, 2, 3, 4, 5, 0x08, 0x10, 0x20, 0x40, 0x80, 0x1000]; // the game's sCompressedStatuses
    b.fill(0, o, o + PARTY_MON);
    b.set(src.buf.subarray(src.off, src.off + BOX_MON), o);
    w32(b, o + 76, STATUS_OF[cs] || 0);
    b[o + 81] = 0xFF; // no mail
    b[o + 80] = expLevel(D, src);
    const s = calcStats(D, X, dst);
    if (!s) throw new Error(`Could not work out ${name}'s battle stats.`);
    STAT_OFFSETS.forEach((so, i) => w16(b, o + so, s[i]));
    setHp(dst, Math.max(0, s[0] - lost));
  }
  const setPartyCount = (sv, n) => { sv.sb1[PARTY_COUNT] = n; };
  function withdraw(sv, D, X, ref) {
    if (ref.party || mon.empty(ref)) throw new Error('Pick a Pokémon in a box.');
    const n = partyCount(sv);
    if (n >= 6) throw new Error('Your party is full (6 Pokémon). Move one to a box first.');
    boxToParty(D, X, ref, partyRef(sv, n));
    setPartyCount(sv, n + 1);
    release(ref);
    return n;
  }
  function deposit(sv, D, i, dst) {
    const n = partyCount(sv);
    if (i >= n) throw new Error('Pick a Pokémon in your party.');
    let others = 0;
    for (let k = 0; k < n; k++) if (k !== i && !mon.isEgg(partyRef(sv, k))) others++;
    if (!others) throw new Error("That's your last Pokémon (eggs don't count). The game needs at least one in the party.");
    copyToBox(D, partyRef(sv, i), dst);
    sv.sb1.copyWithin(PARTY + i * PARTY_MON, PARTY + (i + 1) * PARTY_MON, PARTY + n * PARTY_MON);
    sv.sb1.fill(0, PARTY + (n - 1) * PARTY_MON, PARTY + n * PARTY_MON);
    setPartyCount(sv, n - 1);
  }
  const nonEggsBut = (sv, i) => { let n = 0; for (let k = 0; k < partyCount(sv); k++) if (k !== i && !mon.isEgg(partyRef(sv, k))) n++; return n; };
  function swapBoxParty(sv, D, X, bref, i) {
    if (bref.party || mon.empty(bref) || i >= partyCount(sv)) throw new Error('Pick a box Pokémon and a party Pokémon.');
    const p = partyRef(sv, i);
    if (mon.isEgg(bref) && !mon.isEgg(p) && !nonEggsBut(sv, i)) throw new Error("That's your last Pokémon (eggs don't count). The game needs at least one in the party.");
    const tmp = { buf: bref.buf.slice(bref.off, bref.off + BOX_MON), off: 0, party: false, odds: bref.odds };
    release(bref);
    copyToBox(D, p, bref);
    boxToParty(D, X, tmp, p);
  }
  function moveInParty(sv, i, j) {
    const n = partyCount(sv), base = PARTY;
    if (i >= n || i === j) return false;
    const a = sv.sb1.slice(base + i * PARTY_MON, base + (i + 1) * PARTY_MON);
    if (j < n) {
      sv.sb1.copyWithin(base + i * PARTY_MON, base + j * PARTY_MON, base + (j + 1) * PARTY_MON);
      sv.sb1.set(a, base + j * PARTY_MON);
    } else {
      if (i === n - 1) return false;
      sv.sb1.copyWithin(base + i * PARTY_MON, base + (i + 1) * PARTY_MON, base + n * PARTY_MON);
      sv.sb1.set(a, base + (n - 1) * PARTY_MON);
    }
    return true;
  }
  function moveMon(sv, D, X, from, to) {
    if (from.party === to.party && from.slot === to.slot && (from.party || from.box === to.box)) return false;
    if (from.party && to.party) return moveInParty(sv, from.slot, to.slot);
    if (!from.party && !to.party) { const a = boxRef(sv, from.box, from.slot); if (mon.empty(a)) return false; swap(a, boxRef(sv, to.box, to.slot)); return true; }
    const b = from.party ? boxRef(sv, to.box, to.slot) : boxRef(sv, from.box, from.slot), i = from.party ? from.slot : to.slot;
    if (from.party) { if (mon.empty(b)) deposit(sv, D, i, b); else swapBoxParty(sv, D, X, b, i); }
    else if (mon.empty(b)) return false;
    else if (i >= partyCount(sv)) withdraw(sv, D, X, b);
    else swapBoxParty(sv, D, X, b, i);
    return true;
  }
  function createInParty(sv, D, X, opts) {
    const n = partyCount(sv);
    if (n >= 6) throw new Error('Your party is full (6 Pokémon). Move one to a box first.');
    const tmp = { buf: new Uint8Array(BOX_MON), off: 0, party: false, odds: sv.odds };
    createInBox(sv, D, tmp, opts);
    boxToParty(D, X, tmp, partyRef(sv, n));
    setPartyCount(sv, n + 1);
    return n;
  }
  function swap(a, b) {
    if (a.party || b.party) throw new Error('Only box slots can be moved.');
    const t = a.buf.slice(a.off, a.off + BOX_MON);
    a.buf.set(b.buf.subarray(b.off, b.off + BOX_MON), a.off);
    b.buf.set(t, b.off);
  }
  // The game's deposit keeps the box part as it is (HP lost and status are already mirrored there).
  function copyToBox(D, src, dst) {
    if (dst.party || !mon.empty(dst)) throw new Error('Pick an empty box slot.');
    dst.buf.set(src.buf.subarray(src.off, src.off + BOX_MON), dst.off);
  }

  // ── Showdown sets ──
  const squash = s => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');
  function findName(list, name) {
    const q = squash(name);
    if (!q) return 0;
    for (let i = 1; i < list.length; i++) { const n = typeof list[i] === 'string' ? list[i] : list[i] && list[i].n; if (n && squash(n) === q) return i; }
    return -1;
  }
  function toShowdown(D, m, X) {
    const sp = D.species[mon.species(m)]?.n || '#' + mon.species(m), nick = mon.nickname(m);
    const g = genderOf(D, m), item = mon.item(m);
    let head = nick && nick !== defaultNickname(D, mon.species(m)) ? `${nick} (${sp})` : sp;
    if (g < 2 && genderRatio(D, mon.species(m)) % 254 !== 0) head += g ? ' (F)' : ' (M)';
    if (item) head += ' @ ' + (D.items[item] || '#' + item);
    const lines = [head];
    const ab = abilityName(X, m);
    if (ab) lines.push('Ability: ' + ab);
    const L = levelOf(D, m);
    if (L && L !== 100) lines.push('Level: ' + L);
    if (mon.shiny(m)) lines.push('Shiny: Yes');
    const ev = mon.evs(m), iv = mon.ivs(m);
    const evs = STATS.map((s, i) => (ev[i] ? `${ev[i]} ${s}` : '')).filter(Boolean);
    if (evs.length) lines.push('EVs: ' + evs.join(' / '));
    lines.push(NATURES[mon.nature(m)] + ' Nature');
    const ivs = STATS.map((s, i) => (iv[i] !== 31 ? `${iv[i]} ${s}` : '')).filter(Boolean);
    if (ivs.length) lines.push('IVs: ' + ivs.join(' / '));
    for (const x of mon.moves(m)) if (x) lines.push('- ' + (D.moves[x] || '#' + x));
    return lines.join('\n');
  }
  function fromShowdown(D, text, X) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) throw new Error('Paste a Showdown set first.');
    const warnings = [], opts = { level: 100, nature: 0, shiny: false, gender: null, item: 0, ball: 1, friendship: 255,
      moves: [0, 0, 0, 0], ivs: [31, 31, 31, 31, 31, 31], evs: [0, 0, 0, 0, 0, 0], ability: 0, nickname: '' };
    let head = lines[0], m;
    if ((m = head.match(/@\s*(.+)$/))) {
      const id = findName(D.items, m[1]);
      if (id > 0 && validItem(D, id)) opts.item = id; else warnings.push(`Item "${m[1]}" is not in SoulGold; left empty.`);
      head = head.slice(0, m.index).trim();
    }
    if ((m = head.match(/\((M|F)\)$/))) { opts.gender = m[1] === 'F' ? 1 : 0; head = head.slice(0, m.index).trim(); }
    if ((m = head.match(/^(.*)\(([^()]+)\)$/))) { opts.nickname = m[1].trim(); head = m[2].trim(); }
    opts.species = findName(D.species, head);
    if (opts.species <= 0) throw new Error(`"${head}" is not a SoulGold species name.`);
    const stats = s => s.split('/').map(x => x.trim().match(/^(\d+)\s+(\w+)/)).filter(Boolean)
      .map(([, v, k]) => [STATS.findIndex(n => n.toLowerCase() === k.toLowerCase()), +v]).filter(([i]) => i >= 0);
    let mi = 0;
    for (const l of lines.slice(1)) {
      if ((m = l.match(/^Level:\s*(\d+)/i))) opts.level = Math.max(1, Math.min(100, +m[1]));
      else if (/^Shiny:\s*Yes/i.test(l)) opts.shiny = true;
      else if ((m = l.match(/^(\w+)\s+Nature/i))) { const n = NATURES.findIndex(x => x.toLowerCase() === m[1].toLowerCase()); if (n >= 0) opts.nature = n; }
      else if ((m = l.match(/^EVs:\s*(.+)/i))) for (const [i, v] of stats(m[1])) opts.evs[i] = Math.min(255, v);
      else if ((m = l.match(/^IVs:\s*(.+)/i))) for (const [i, v] of stats(m[1])) opts.ivs[i] = Math.min(31, v);
      else if ((m = l.match(/^Happiness:\s*(\d+)/i))) opts.friendship = Math.min(255, +m[1]);
      else if ((m = l.match(/^[-~]\s*(.+)/))) {
        const id = findName(D.moves, m[1].replace(/\s*\[.*\]$/, ''));
        if (id <= 0) warnings.push(`Move "${m[1]}" is not in SoulGold; skipped.`);
        else if (mi < 4) opts.moves[mi++] = id; else warnings.push(`A Pokémon knows four moves, so ${D.moves[id]} was skipped.`);
      } else if ((m = l.match(/^Ability:\s*(.+)/i))) {
        const ab = X && X.species[opts.species] ? X.species[opts.species].ab : [];
        const i = ab.findIndex(a => a && squash(a) === squash(m[1]));
        if (i >= 0) opts.ability = i; else warnings.push(`${D.species[opts.species].n} can't have ${m[1]} in SoulGold; it gets ability 1.`);
      }
    }
    return { opts, warnings };
  }

  function unknownData(sv, D) {
    const out = [], refs = [];
    for (let i = 0; i < partyCount(sv); i++) refs.push([partyRef(sv, i), `Party slot ${i + 1}`]);
    for (let b = 0; b < BOXES; b++) for (let s = 0; s < SLOTS; s++) refs.push([boxRef(sv, b, s), `Box ${b + 1} slot ${s + 1}`]);
    for (const [m, where] of refs) {
      if (mon.empty(m)) { if (m.party) out.push(`${where} is empty but counted in the party.`); continue; }
      const sp = mon.species(m);
      if (!validSpecies(D, sp)) { out.push(`${where}: unknown species #${sp}.`); continue; }
      const bad = mon.moves(m).filter(x => x && !validMove(D, x));
      if (bad.length) out.push(`${where}: unknown move${bad.length > 1 ? 's' : ''} #${bad.join(', #')}.`);
      if (!validItem(D, mon.item(m))) out.push(`${where}: unknown held item #${mon.item(m)}.`);
    }
    for (const p of POCKETS) for (const it of readPocket(sv, p)) if (!validItem(D, it.id)) out.push(`${p.name}: unknown item #${it.id}.`);
    return out;
  }

  // ── Converting between emulators (the same as for Radical Red: only mGBA's clock block differs) ──
  const FLASH = 0x20000, RTC_BLOCK = 16;
  function saveLayout(bytes) {
    if (bytes.length === FLASH) return { ok: true, extra: 0, text: '128 KB, no clock data (RetroArch .srm, VBA-M)' };
    if (bytes.length === FLASH + RTC_BLOCK) return { ok: true, extra: RTC_BLOCK, text: '128 KB + 16 bytes of clock data (mGBA)' };
    return { ok: false, text: `${bytes.length.toLocaleString()} bytes, which isn't a layout RadicalHex knows how to convert` };
  }
  function convertSave(bytes, format) {
    const src = new Uint8Array(bytes), lay = saveLayout(src);
    if (!lay.ok) throw new Error(`This file is ${lay.text}, so it was not converted.`);
    load(src);
    const out = format === 'srm' ? src.slice(0, FLASH) : format === 'sav' ? src.slice() : null;
    if (!out) throw new Error('Unknown save format.');
    let back;
    try { back = load(out); } catch (e) { throw new Error('The converted save does not load, so it was not written: ' + e.message); }
    for (let i = 0; i < FLASH; i++) if (out[i] !== src[i]) throw new Error('The converted save does not match the original, so it was not written.');
    if (back.saveIndex !== load(src).saveIndex) throw new Error('The converted save does not match the original, so it was not written.');
    return out;
  }

  const api = {
    GAME: 'sg', BOXES, SLOTS, POCKETS, BALLS, NATURES, STATS, MONEY_MAX, COINS_MAX, CANDY_JAR_MAX, candyJar, setCandyJar, BP_MAX, bp, setBp, natureEffect,
    load, serialize, build, checksum, allowedRanges,
    partyCount, partyRef, boxRef, boxName, mon, levelOf, setLevel, setExp, growth, baseFriendship, genderOf, genderRatio, defaultNickname,
    solvePid, setNatureShiny, setGender, setOtIds, makeMine, abilityName, setAbility, trainer, setMoney, setCoins, readPocket, writePocket, pocketOf,
    dex, registerOwned, clearErased, NATIONAL_DEX, createInBox, release, swap, copyToBox, withdraw, deposit, createInParty, moveMon, toShowdown, fromShowdown, heal, partyStatus, STATUS,
    calcStats, recalcStats, legality, isIllegal, expLevel, unknownData, saveLayout, convertSave, EV_CAP, EV_TOTAL, clampEvs,
    learnable: (X, sp) => learnSet(X, sp),
    levelOnly: (X, sp) => levelOnly(X, sp),
    validSpecies, validItem, validMove, encodeText, decodeText,
    NICK_LEN: 12,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.SGCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
