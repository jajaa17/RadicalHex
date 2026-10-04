// RadicalHex save core: Pokémon Radical Red 4.1 (CFRU engine on FireRed).
// The layout follows PKForge's Radical Red engine (github.com/sofianeelhor/PKForge, GPLv3),
// re-checked against real saves. Works in the browser (window.RHCore) and in Node (require).
(function (root) {
  'use strict';

  // ── Layout ──
  // CFRU checksum window (and stream chunk size) of each of the 14 save sections.
  const WIN = [0xF24, 0xFF0, 0xFF0, 0xFF0, 0xD98, 0xFF0, 0xFF0, 0xFF0, 0xFF0, 0xFF0, 0xFF0, 0xFF0, 0xFF0, 0x450];
  const STREAM_SIZE = 8 * 0xFF0 + 0x450; // PokemonStorage: sections 5..13 concatenated
  const BOX_MON = 58, PARTY_MON = 100, SLOTS = 30, STRIDE = SLOTS * BOX_MON;
  const STREAM_BOXES = 19, BOXES = 25; // boxes 20-22 live in the raw sector 30/31 region, 23-25 in the save blocks
  const RAW_BASE = 0x1E000, RAW_BOX_OFF = 0xB0C, RAW_BOX_SIZE = 3 * STRIDE, RAW_FIRST = 0xFF0 - RAW_BOX_OFF;
  const rawFile = r => (r < 0xFF0 ? RAW_BASE + r : RAW_BASE + 0x1000 + (r - 0xFF0));
  // Boxes 23-24 sit in SaveBlock1 at 0x1F08 (sections 2-3), box 25 in SaveBlock2 at 0xB0 (section 0).
  // All three are inside checksummed sections. Verified against a real save with Pokémon in them.
  const EXT_SIZE = 3 * STRIDE, SB1_BOXES = 0x1F08, SB2_BOX = 0xB0;
  const extFile = (sec, i) => {
    if (i < 2 * STRIDE) { const o = SB1_BOXES + i; return sec[1 + Math.floor(o / 0xFF0)] + (o % 0xFF0); }
    return sec[0] + SB2_BOX + (i - 2 * STRIDE);
  };
  const BAG_IN_SECTOR = 0x518; // bag bytes in section 13's tail; the rest continue in the raw region
  const POCKETS = [
    { key: 'items', name: 'Items', off: 0x000, cap: 450, max: 999 },
    { key: 'key', name: 'Key Items', off: 0x708, cap: 75, max: 1 },
    { key: 'balls', name: 'Poké Balls', off: 0x834, cap: 50, max: 999 },
    { key: 'tms', name: 'TMs & HMs', off: 0x8FC, cap: 128, max: 1 },
    { key: 'berries', name: 'Berries', off: 0xAFC, cap: 75, max: 999 },
  ];
  const BAG_END = 0xAFC + 75 * 4; // end of the bag image
  // Pokédex: two LSB-first bitmaps in section 1, bit n-1 = national number n. Radical Red 4.1 makes them 164 bytes each
  // (seen at 0x310, caught at 0x3B4), found by comparing real saves; CFRU's own 125-byte layout puts caught at 0x38D.
  const DEX_SEEN = 0x310, DEX_CAUGHT = 0x3B4, DEX_BYTES = 0xA4, NATIONAL_DEX = 1025;
  const DEX_USED = ((NATIONAL_DEX - 1) >> 3) + 1; // bytes that hold real entries
  const MONEY_MAX = 999999, COINS_MAX = 9999;
  const EV_CAP = 252, EV_TOTAL = 510; // the game's limits (CFRU config.h EV_CAP, pokemon.h MAX_TOTAL_EVS)

  const BALLS = ['Master Ball', 'Ultra Ball', 'Great Ball', 'Poké Ball', 'Safari Ball', 'Net Ball', 'Dive Ball', 'Nest Ball',
    'Repeat Ball', 'Timer Ball', 'Luxury Ball', 'Premier Ball', 'Dusk Ball', 'Heal Ball', 'Quick Ball', 'Cherish Ball',
    'Park Ball', 'Fast Ball', 'Level Ball', 'Lure Ball', 'Heavy Ball', 'Love Ball', 'Friend Ball', 'Moon Ball',
    'Sport Ball', 'Beast Ball', 'Dream Ball'];
  const NATURES = ['Hardy', 'Lonely', 'Brave', 'Adamant', 'Naughty', 'Bold', 'Docile', 'Relaxed', 'Impish', 'Lax',
    'Timid', 'Hasty', 'Serious', 'Jolly', 'Naive', 'Modest', 'Mild', 'Quiet', 'Bashful', 'Rash',
    'Calm', 'Gentle', 'Sassy', 'Careful', 'Quirky'];
  // Nature n raises stat floor(n/5) and lowers n%5, in Atk/Def/Spe/SpA/SpD order.
  const NATURE_STATS = ['Atk', 'Def', 'Spe', 'SpA', 'SpD'];
  const natureEffect = n => (Math.floor(n / 5) === n % 5 ? 'neutral' : `+${NATURE_STATS[Math.floor(n / 5)]} −${NATURE_STATS[n % 5]}`);
  const STATS = ['HP', 'Atk', 'Def', 'SpA', 'SpD', 'Spe'];
  const PALLET_TOWN = 88, GAME_FIRERED = 4;

  // ── Bytes ──
  const u16 = (b, o) => b[o] | (b[o + 1] << 8);
  const u32 = (b, o) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;
  const w16 = (b, o, v) => { b[o] = v & 255; b[o + 1] = (v >>> 8) & 255; };
  const w32 = (b, o, v) => { b[o] = v & 255; b[o + 1] = (v >>> 8) & 255; b[o + 2] = (v >>> 16) & 255; b[o + 3] = (v >>> 24) & 255; };

  function checksum(b, off, len) {
    let s = 0;
    for (let i = 0; i < (len & ~3); i += 4) s = (s + u32(b, off + i)) >>> 0;
    return (s + (s >>> 16)) & 0xFFFF;
  }

  // ── Gen 3 text ──
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
  // Returns null when a character cannot be written in the game's alphabet.
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

  // ── Load / save ──
  function load(input) {
    if (!input || input.length < 0x20000) throw new Error('This file is too small to be a GBA save (it must be at least 128 KB).');
    const data = new Uint8Array(input);
    // The game keeps two save slots (sectors 0-13 and 14-27) and picks one the way CFRU's GetSaveValidStatus does:
    // a slot counts only if all 14 sections are in it with valid checksums, and the slot with the higher save counter
    // wins. Sectors outside the slots, and stray or half-written sectors in the other slot (an emulator can write the
    // file while the game is saving), are ignored, as the game ignores them.
    const slots = [0, 1].map(k => {
      const sec = Array(14).fill(-1), idx = Array(14).fill(0);
      let counter = 0, signed = false, bad = 0;
      for (let i = 0; i < 14; i++) {
        const o = (k * 14 + i) * 0x1000;
        if (((u32(data, o + 0xFF8) & 0xFFFFFF00) >>> 0) !== 0x08012000) continue;
        signed = true;
        const id = u16(data, o + 0xFF4);
        if (id >= 14 || checksum(data, o, WIN[id]) !== u16(data, o + 0xFF6)) { bad++; continue; }
        sec[id] = o; idx[id] = counter = u32(data, o + 0xFFC); // a later copy of a section replaces an earlier one, as in the game
      }
      return { sec, idx, counter, signed, bad, ok: sec.every(o => o >= 0) };
    });
    const [a, b] = slots;
    if (!a.signed && !b.signed) throw new Error('This is not a Radical Red save: some save sections are missing. Use the .sav/.srm battery save, not a save state.');
    // A slot with good sections and only blank ones besides: the emulator wrote the file in the middle of the game's save.
    const partial = s => !s.bad && s.sec.filter(o => o >= 0).length >= 7;
    if (!a.ok && !b.ok && (partial(a) || partial(b))) throw new Error('This save was only partly written (some of its sections are blank or from an unfinished save), so RadicalHex will not edit it. The emulator probably wrote the file while the game was still saving: close the game in the emulator (or quit it) so it writes the whole save, then open the file again.');
    if (!a.ok && !b.ok) throw new Error('This is not a Radical Red 4.1 save: the section checksums do not match (vanilla FireRed, another hack, or a damaged file).');
    const newer = (x, y) => ((x === 0xFFFFFFFF && y === 0) || (x === 0 && y === 0xFFFFFFFF)) ? (x + 1) >>> 0 > (y + 1) >>> 0 : x > y;
    const use = !b.ok ? a : !a.ok ? b : newer(b.counter, a.counter) ? b : a;
    const { sec, idx } = use, skip = use === a ? b : a;
    // The other slot holds a newer save that is incomplete or damaged (the game was still saving, or the file is
    // damaged there). The game loads the previous, complete save then, and so does RadicalHex, but it says so.
    let newerDamaged = null;
    for (let i = 0; i < 14; i++) {
      const o = (skip === a ? i : 14 + i) * 0x1000;
      if (((u32(data, o + 0xFF8) & 0xFFFFFF00) >>> 0) !== 0x08012000 || u16(data, o + 0xFF4) >= 14) continue;
      const n = u32(data, o + 0xFFC);
      if (newer(n, use.counter) && (newerDamaged === null || newer(n, newerDamaged))) newerDamaged = n;
    }
    if (new Set(idx).size !== 1) throw new Error('The newest save in this file was only partly written (its sections come from different saves), so RadicalHex will not edit it. Load the save in the game, save again, and close the game before opening it here.');
    const pc = u32(data, sec[1] + 0x34);
    if (pc > 6) throw new Error('The party count in this save is invalid, so RadicalHex will not edit it.');
    const stream = new Uint8Array(STREAM_SIZE);
    let c = 0;
    for (let id = 5; id <= 13; id++) { stream.set(data.subarray(sec[id], sec[id] + WIN[id]), c); c += WIN[id]; }
    const raw = new Uint8Array(RAW_BOX_SIZE);
    raw.set(data.subarray(rawFile(RAW_BOX_OFF), rawFile(RAW_BOX_OFF) + RAW_FIRST));
    raw.set(data.subarray(rawFile(0xFF0), rawFile(0xFF0) + RAW_BOX_SIZE - RAW_FIRST), RAW_FIRST);
    const ext = new Uint8Array(EXT_SIZE);
    for (let i = 0; i < EXT_SIZE; i++) ext[i] = data[extFile(sec, i)];
    return { data, sec, stream, raw, ext, saveIndex: idx[0], newerDamaged, original: new Uint8Array(input) };
  }

  // CFRU's expanded flags (0x900-0x18FF) live in the unused tails of sections 0 and 4 (its "save block parasite":
  // 0xCC bytes after section 0's data, then 0x258 after section 4's). Radical Red keeps its game modes there.
  function flag(sv, id) {
    const i = (id - 0x900) >> 3;
    if (id < 0x900 || i >= 0xCC + 0x258) return false;
    const o = i < 0xCC ? sv.sec[0] + WIN[0] + i : sv.sec[4] + WIN[4] + (i - 0xCC);
    return ((sv.data[o] >> (id & 7)) & 1) === 1;
  }
  // Minimal Grinding mode (every IV 31, no EVs) sets flags 0x1032 and 0x1040 when the game starts; a Normal game
  // started the same way has neither (found by comparing two fresh saves, one with the mode on and one with it off).
  const MIN_GRIND_FLAGS = [0x1032, 0x1040];
  const modes = sv => ({ minGrind: MIN_GRIND_FLAGS.some(id => flag(sv, id)) });

  // Builds the output file. Only the live save slot is written; the older slot stays as the game's own fallback.
  function serialize(sv) {
    const out = new Uint8Array(sv.data);
    let c = 0;
    for (let id = 5; id <= 13; id++) { out.set(sv.stream.subarray(c, c + WIN[id]), sv.sec[id]); c += WIN[id]; }
    out.set(sv.raw.subarray(0, RAW_FIRST), rawFile(RAW_BOX_OFF));
    out.set(sv.raw.subarray(RAW_FIRST), rawFile(0xFF0));
    for (let i = 0; i < EXT_SIZE; i++) out[extFile(sv.sec, i)] = sv.ext[i];
    for (const id of [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13]) w16(out, sv.sec[id] + 0xFF6, checksum(out, sv.sec[id], WIN[id]));
    return out;
  }

  // File ranges RadicalHex is allowed to change. Anything else changing means a bug, and the save is refused.
  function allowedRanges(sv) {
    const s = sv.sec, r = [];
    r.push([s[1] + 0x34, s[1] + 0x38 + 6 * PARTY_MON], [s[1] + 0x290, s[1] + 0x296], [s[1] + DEX_SEEN, s[1] + DEX_CAUGHT + DEX_USED]);
    for (const id of [0, 1, 2, 3, 5, 6, 7, 8, 9, 10, 11, 12, 13]) r.push([s[id] + 0xFF6, s[id] + 0xFF8]);
    for (let i = 0; i < EXT_SIZE; i++) { const f = extFile(s, i); if (r.length && r[r.length - 1][1] === f) r[r.length - 1][1]++; else r.push([f, f + 1]); }
    for (let id = 5; id <= 13; id++) r.push([s[id], s[id] + WIN[id]]);
    r.push([s[13] + 0xAD8, s[13] + 0xAD8 + BAG_IN_SECTOR], [rawFile(0), rawFile(BAG_END - BAG_IN_SECTOR)]);
    r.push([rawFile(RAW_BOX_OFF), rawFile(RAW_BOX_OFF) + RAW_FIRST], [rawFile(0xFF0), rawFile(0xFF0) + RAW_BOX_SIZE - RAW_FIRST]);
    return r;
  }

  // Serializes and proves the result is safe: reloads it, checks every changed byte is in an allowed range,
  // and validates every Pokémon and bag entry that changed. Returns { bytes } or throws with the reasons.
  function build(sv, D) {
    const out = serialize(sv);
    const errors = [];
    if (out.length !== sv.original.length) errors.push('The file size changed.');
    let check;
    try { check = load(out); } catch (e) { errors.push('The edited file does not load: ' + e.message); }
    const ranges = allowedRanges(sv);
    for (let i = 0; i < out.length; i++) {
      if (out[i] === sv.original[i]) continue;
      if (!ranges.some(([a, b]) => i >= a && i < b)) { errors.push(`Unexpected change at byte 0x${i.toString(16)}.`); break; }
    }
    if (check) {
      const before = load(sv.original);
      const same = (a, b, n) => a.buf.subarray(a.off, a.off + n).every((v, k) => v === b.buf[b.off + k]);
      const each = (fn) => {
        for (let i = 0; i < 6; i++) fn(partyRef(check, i), partyRef(before, i), `Party slot ${i + 1}`, PARTY_MON);
        for (let b = 0; b < BOXES; b++) for (let s = 0; s < SLOTS; s++) fn(boxRef(check, b, s), boxRef(before, b, s), `Box ${b + 1} slot ${s + 1}`, BOX_MON);
      };
      each((m, o, where, n) => {
        if (same(m, o, n) || mon.empty(m)) return;
        const problem = validateMon(m, o, D);
        if (problem) errors.push(`${where}: ${problem}`);
      });
      for (const p of POCKETS) {
        const now = readPocket(check, p), was = readPocket(before, p);
        if (JSON.stringify(now) === JSON.stringify(was)) continue;
        for (const it of now) if (!validItem(D, it.id) || it.qty < 1 || it.qty > 999) errors.push(`${p.name}: invalid entry (item ${it.id} ×${it.qty}).`);
      }
    }
    // The game keeps its party packed: every slot below the party count holds a Pokémon.
    if (check && partyCount(check) !== partyCount(load(sv.original)))
      for (let i = 0; i < partyCount(check); i++) if (mon.empty(partyRef(check, i))) errors.push(`The party count is ${partyCount(check)} but party slot ${i + 1} is empty.`);
    if (errors.length) throw new Error('RadicalHex stopped the save to protect your file:\n' + errors.join('\n'));
    return out;
  }

  const validSpecies = (D, id) => !!(D.species[id] && D.species[id].n);
  const validItem = (D, id) => id === 0 || !!(D.items[id] && D.items[id] !== '.' && !D.items[id].startsWith('-') && !D.items[id].includes('Free Space') && !D.items[id].startsWith('?'));
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
    if (mon.ball(m) >= BALLS.length) return 'unknown Poké Ball.';
    if (m.party && (mon.level(m) < 1 || mon.level(m) > 100)) return 'level is out of range.';
    return null;
  }

  // ── Slots ──
  const partyCount = sv => Math.min(6, u32(sv.data, sv.sec[1] + 0x34));
  const partyRef = (sv, i) => ({ buf: sv.data, off: sv.sec[1] + 0x38 + PARTY_MON * i, party: true });
  const boxRef = (sv, box, slot) => (box < STREAM_BOXES
    ? { buf: sv.stream, off: 4 + (box * SLOTS + slot) * BOX_MON, party: false }
    : box < 22 ? { buf: sv.raw, off: (box - STREAM_BOXES) * STRIDE + slot * BOX_MON, party: false }
      : { buf: sv.ext, off: (box - 22) * STRIDE + slot * BOX_MON, party: false });
  function boxName(sv, box) {
    const o = box < 14 ? 0x8344 + 9 * box : 0x8344 - 9 * (box - 13);
    const n = decodeText(sv.stream.subarray(o, o + 9));
    return n.trim() ? n : 'Box ' + (box + 1);
  }

  // ── One Pokémon ──
  // Party form: 100 bytes. PC form: 58 bytes with moves packed 10 bits each. Both are unencrypted.
  const F = (m, party, box) => m.off + (m.party ? party : box);
  const erased = m => { for (let i = m.off, end = m.off + (m.party ? PARTY_MON : BOX_MON); i < end; i++) if (m.buf[i] !== 0xFF) return false; return true; };
  // Turns never-written (all 0xFF) box slots into ordinary empty slots (all 0), as the game clears an empty slot.
  // Runs only on the bytes being saved. Returns how many slots were cleared.
  function clearErased(sv) {
    let n = 0;
    for (let b = 0; b < BOXES; b++) for (let s = 0; s < SLOTS; s++) {
      const m = boxRef(sv, b, s);
      if (mon.species(m) === 0xFFFF && erased(m)) { m.buf.fill(0, m.off, m.off + BOX_MON); n++; }
    }
    return n;
  }
  const mon = {
    // Empty: no species, or never written. Flash that the game has never written reads as 0xFF bytes, and RetroArch
    // keeps a new .srm that way, so a slot of nothing but 0xFF is an empty slot too.
    empty: m => { const sp = mon.species(m); return sp === 0 || (sp === 0xFFFF && erased(m)); },
    pid: m => u32(m.buf, m.off),
    setPid: (m, v) => w32(m.buf, m.off, v),
    otid: m => u32(m.buf, m.off + 4),
    nickname: m => decodeText(m.buf.subarray(m.off + 8, m.off + 18)),
    setNickname(m, s) { const b = encodeText(s, 10); if (!b) return false; m.buf.set(b, m.off + 8); return true; },
    otName: m => decodeText(m.buf.subarray(m.off + 0x14, m.off + 0x1B)),
    species: m => u16(m.buf, F(m, 0x20, 0x1C)),
    setSpecies(m, v) {
      w16(m.buf, F(m, 0x20, 0x1C), v);
      if (m.party) w16(m.buf, m.off + 0x1C, 0); // CFRU's in-battle backup species (0 outside battle), so the game never reverts the edit
    },
    item: m => u16(m.buf, F(m, 0x22, 0x1E)),
    setItem: (m, v) => w16(m.buf, F(m, 0x22, 0x1E), v),
    exp: m => u32(m.buf, F(m, 0x24, 0x20)),
    setExp: (m, v) => w32(m.buf, F(m, 0x24, 0x20), v),
    friendship: m => m.buf[F(m, 0x29, 0x25)],
    setFriendship: (m, v) => { m.buf[F(m, 0x29, 0x25)] = v; },
    ball: m => m.buf[F(m, 0x2A, 0x26)],
    setBall: (m, v) => { m.buf[F(m, 0x2A, 0x26)] = v; },
    level: m => (m.party ? m.buf[m.off + 0x54] : null),
    moves(m) {
      if (m.party) return [0, 1, 2, 3].map(i => u16(m.buf, m.off + 0x2C + 2 * i));
      let p = 0;
      for (let i = 4; i >= 0; i--) p = p * 256 + m.buf[m.off + 0x27 + i];
      return [0, 1, 2, 3].map(i => Math.floor(p / 2 ** (10 * i)) % 1024);
    },
    setMoves(m, mv, D) {
      const old = mon.moves(m);
      if (m.party) {
        for (let i = 0; i < 4; i++) {
          if (mv[i] === old[i]) continue;
          w16(m.buf, m.off + 0x2C + 2 * i, mv[i]);
          m.buf[m.off + 0x34 + i] = D.pp[mv[i]] || 0; // full PP for the new move
          m.buf[m.off + 0x28] &= ~(3 << (2 * i)); // clear PP Ups for that slot
        }
        return;
      }
      let p = 0;
      for (let i = 3; i >= 0; i--) p = p * 1024 + (mv[i] & 0x3FF);
      for (let i = 0; i < 5; i++) { m.buf[m.off + 0x27 + i] = p % 256; p = Math.floor(p / 256); }
      for (let i = 0; i < 4; i++) if (mv[i] !== old[i]) m.buf[m.off + 0x24] &= ~(3 << (2 * i));
    },
    movePp: m => (m.party ? [0, 1, 2, 3].map(i => m.buf[m.off + 0x34 + i]) : null),
    // UI order HP Atk Def SpA SpD Spe. Stored EV order HP Atk Def Spe SpA SpD.
    evs(m) { const b = F(m, 0x38, 0x2C), d = m.buf; return [d[b], d[b + 1], d[b + 2], d[b + 4], d[b + 5], d[b + 3]]; },
    setEvs(m, v) { const b = F(m, 0x38, 0x2C), d = m.buf; d[b] = v[0]; d[b + 1] = v[1]; d[b + 2] = v[2]; d[b + 3] = v[5]; d[b + 4] = v[3]; d[b + 5] = v[4]; },
    ivWord: m => u32(m.buf, F(m, 0x48, 0x36)),
    ivs(m) { const w = mon.ivWord(m), g = s => (w >>> s) & 31; return [g(0), g(5), g(10), g(20), g(25), g(15)]; },
    setIvs(m, v) {
      const w = ((mon.ivWord(m) & 0xC0000000) | v[0] | (v[1] << 5) | (v[2] << 10) | (v[5] << 15) | (v[3] << 20) | (v[4] << 25)) >>> 0;
      w32(m.buf, F(m, 0x48, 0x36), w);
    },
    hiddenAbility: m => (mon.ivWord(m) >>> 31) === 1,
    setHiddenAbility(m, on) { const w = mon.ivWord(m); w32(m.buf, F(m, 0x48, 0x36), (on ? w | 0x80000000 : w & 0x7FFFFFFF) >>> 0); },
    isEgg: m => ((mon.ivWord(m) >>> 30) & 1) === 1,
    abilitySlot: m => (mon.pid(m) & 1) + 1,
    abilityIndex: m => (mon.hiddenAbility(m) ? 2 : mon.pid(m) & 1), // 0 = ability 1, 1 = ability 2, 2 = hidden
    nature: m => mon.pid(m) % 25,
    shiny(m) { const x = (mon.otid(m) ^ mon.pid(m)) >>> 0; return ((x & 0xFFFF) ^ (x >>> 16)) < 16; },
    metLocation: m => m.buf[F(m, 0x45, 0x33)],
    setMetLocation: (m, v) => { m.buf[F(m, 0x45, 0x33)] = v & 0xFF; },
    // Met info word: bits 0-6 met level (0 = hatched), 7-10 game of origin, 15 OT gender.
    metLevel: m => u16(m.buf, F(m, 0x46, 0x34)) & 0x7F,
    setMetLevel: (m, v) => w16(m.buf, F(m, 0x46, 0x34), (u16(m.buf, F(m, 0x46, 0x34)) & ~0x7F) | (v & 0x7F)),
    otGender: m => u16(m.buf, F(m, 0x46, 0x34)) >>> 15,
    setOtGender: (m, g) => w16(m.buf, F(m, 0x46, 0x34), (u16(m.buf, F(m, 0x46, 0x34)) & 0x7FFF) | ((g & 1) << 15)),
    setOtName(m, s) { const b = encodeText(s, 7); if (!b) return false; m.buf.set(b, m.off + 0x14); return true; },
    hp: m => (m.party ? u16(m.buf, m.off + 0x56) : null), // current HP (party only)
    partyStats: m => (m.party ? [0x58, 0x5A, 0x5C, 0x60, 0x62, 0x5E].map(o => u16(m.buf, m.off + o)) : null),
  };

  // ── Healing (party only: the game keeps no HP, status or PP for boxed Pokémon) ──
  const STATUS = ['', 'Asleep', 'Poisoned', 'Burned', 'Frozen', 'Paralyzed', 'Badly poisoned'];
  function partyStatus(m) {
    if (!m.party) return '';
    const s = u32(m.buf, m.off + 0x50), hp = u16(m.buf, m.off + 0x56);
    if (hp === 0) return 'Fainted';
    if (s & 7) return 'Asleep';
    if (s & 0x80) return 'Badly poisoned';
    if (s & 0x08) return 'Poisoned';
    if (s & 0x10) return 'Burned';
    if (s & 0x20) return 'Frozen';
    if (s & 0x40) return 'Paralyzed';
    return '';
  }
  // The game's CalculatePPWithBonus: each PP Up adds 20% of the base PP, rounded down once at the end.
  const maxPp = (D, move, ups) => { const base = D.pp[move] || 0; return base + Math.floor(base * 20 * ups / 100); };
  // Returns true when something changed.
  function heal(D, m) {
    if (!m.party || mon.empty(m)) return false;
    const before = m.buf.slice(m.off, m.off + PARTY_MON);
    w32(m.buf, m.off + 0x50, 0); // status
    w16(m.buf, m.off + 0x56, u16(m.buf, m.off + 0x58)); // HP = max HP
    const mv = mon.moves(m), ups = m.buf[m.off + 0x28];
    for (let i = 0; i < 4; i++) m.buf[m.off + 0x34 + i] = mv[i] ? Math.min(255, maxPp(D, mv[i], (ups >> (2 * i)) & 3)) : 0;
    return m.buf.subarray(m.off, m.off + PARTY_MON).some((v, k) => v !== before[k]);
  }

  // ── Battle stats (Radical Red base stats; this formula reproduces the game's stored party stats exactly) ──
  function calcStats(D, X, m) {
    const x = X && X.species[mon.species(m)];
    if (!x || !m.party) return null;
    const L = mon.level(m), iv = mon.ivs(m), ev = mon.evs(m), n = mon.nature(m), up = Math.floor(n / 5), down = n % 5;
    const natureIndex = [null, 0, 1, 3, 4, 2]; // HP Atk Def SpA SpD Spe -> nature order Atk Def Spe SpA SpD
    return x.st.map((b, i) => {
      const base = Math.floor((2 * b + iv[i] + Math.floor(ev[i] / 4)) * L / 100);
      if (i === 0) return b === 1 ? 1 : base + L + 10;
      let v = base + 5;
      if (up !== down) { if (natureIndex[i] === up) v = Math.floor(v * 110 / 100); else if (natureIndex[i] === down) v = Math.floor(v * 90 / 100); }
      return v;
    });
  }
  const STAT_OFFSETS = [0x58, 0x5A, 0x5C, 0x60, 0x62, 0x5E];
  // Rewrites a party Pokémon's stats; current HP moves with max HP like a level-up, and a fainted Pokémon stays fainted.
  function recalcStats(D, X, m) {
    const s = calcStats(D, X, m);
    if (!s) return false;
    const oldMax = u16(m.buf, m.off + 0x58), hp = u16(m.buf, m.off + 0x56);
    STAT_OFFSETS.forEach((o, i) => w16(m.buf, m.off + o, s[i]));
    w16(m.buf, m.off + 0x56, hp === 0 ? 0 : Math.max(1, Math.min(s[0], hp + s[0] - oldMax)));
    return true;
  }

  // ── Legality (Radical Red rules) ──
  // Returns [{ level: 'error' | 'warn' | 'info', text, field }]. Errors are things the game cannot produce.
  const learnCache = new Map();
  const learnSet = (X, sp) => { if (!learnCache.has(sp)) learnCache.set(sp, new Set(X.species[sp] ? X.species[sp].ln : [])); return learnCache.get(sp); };
  // Moves only learned by levelling up: move -> [move, lowest level, species that learns it there (itself or a pre-evolution)].
  const levelCache = new Map();
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
    if (!x) { add('info', `There is no Radical Red data for ${name}, so it can't be checked.`); return out; }
    const mv = mon.moves(m), set = learnSet(X, sp);
    if (!mv.some(Boolean)) add('error', 'It has no moves.', 'moves');
    mv.forEach((id, i) => { if (id && !set.has(id)) add('error', `${name} can't learn ${D.moves[id] || '#' + id} in Radical Red (not a level-up, TM, tutor, egg or pre-evolution move).`, 'move' + i); });
    // A move it can only get by levelling up, at a level it hasn't reached (like PKHeX). A warning, not an error:
    // CFRU's Move Relearner can be set to teach level-up moves early, so it might still be possible in Radical Red.
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
    if (mon.hiddenAbility(m) && !x.ab[2]) add('warn', `${name} has no hidden ability in Radical Red, so the game uses its normal ability.`, 'ability');
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
  // EVs the game allows: at most 252 per stat and 510 in total, filled in stat order.
  function clampEvs(evs) {
    let left = EV_TOTAL;
    return evs.map(v => { const x = Math.max(0, Math.min(EV_CAP, left, v | 0)); left -= x; return x; });
  }

  // ── Species helpers ──
  const growth = (D, sp) => (D.species[sp] && D.species[sp].g ? D.exp[D.species[sp].g - 1] : null);
  function levelOf(D, m) {
    if (m.party) return mon.level(m);
    const t = growth(D, mon.species(m));
    if (!t) return null;
    const e = mon.exp(m);
    let L = 1;
    while (L < 100 && t[L + 1] <= e) L++;
    return L;
  }
  function setLevel(D, m, L) {
    const t = growth(D, mon.species(m));
    if (!t) return false;
    L = Math.max(1, Math.min(100, L));
    mon.setExp(m, t[L]);
    if (m.party) m.buf[m.off + 0x54] = L;
    return true;
  }
  // Exact EXP, kept between 0 and the level 100 amount. The level follows from it (a party Pokémon's stored level too).
  function setExp(D, m, e) {
    const t = growth(D, mon.species(m));
    if (!t) return false;
    mon.setExp(m, Math.max(0, Math.min(t[100], Math.floor(e) || 0)));
    if (m.party) m.buf[m.off + 0x54] = expLevel(D, m);
    return true;
  }
  // Gender: 0 male, 1 female, 2 genderless. Threshold 0 = male only, 254 = female only, 255 = genderless.
  const genderRatio = (D, sp) => (D.species[sp] && D.species[sp].gr !== undefined ? D.species[sp].gr : 127);
  function genderOf(D, m) {
    const gr = genderRatio(D, mon.species(m));
    if (gr === 255) return 2;
    if (gr === 254) return 1;
    if (gr === 0) return 0;
    return (mon.pid(m) & 0xFF) < gr ? 1 : 0;
  }
  // The name the game itself gives this species (forms use the base name; long names use the ROM's short spelling).
  function defaultNickname(D, sp) {
    const s = D.species[sp];
    if (!s || !s.n) return '';
    if (D.nick && D.nick[s.nat]) return D.nick[s.nat];
    let base = s.n;
    if (s.nat) { const first = D.species.findIndex(x => x && x.nat === s.nat && x.n); if (first > 0) base = D.species[first].n; }
    return [...base].slice(0, 10).join('');
  }

  // ── Personality (PID) ──
  // Finds a PID with the wanted nature and shininess. lowByte keeps gender and ability slot when given.
  // keep: optional pid => bool for anything else the new PID must preserve.
  function solvePid({ otid, nature, shiny, lowByte = null, gender = null, ratio = 127, abilityBit = null, keep = null }, rnd = Math.random) {
    const tid = otid & 0xFFFF, sid = otid >>> 16, r = n => Math.floor(rnd() * n);
    for (let n = 0; n < 500000; n++) {
      let low = lowByte;
      if (low === null) {
        low = r(256);
        if (gender !== null && ratio > 0 && ratio < 254 && ((low < ratio) !== (gender === 1))) continue;
        if (abilityBit !== null && (low & 1) !== abilityBit) continue;
      }
      const lo16 = (r(256) << 8) | low;
      let hi;
      if (shiny) hi = (tid ^ sid ^ lo16 ^ r(8)) & 0xFFFF; // xor below 8: shiny under either shiny rule
      else { hi = r(65536); if ((tid ^ sid ^ lo16 ^ hi) < 16) continue; }
      const pid = ((hi << 16) | lo16) >>> 0;
      if (pid % 25 === nature && (!keep || keep(pid))) return pid;
    }
    throw new Error('Could not find a matching personality value.');
  }
  // Unown's letter and Minior's core also come from the PID; the game keeps them when it rerolls one (Ability Capsule).
  const unownLetter = p => ((((p >>> 24) & 3) << 6) | (((p >>> 16) & 3) << 4) | (((p >>> 8) & 3) << 2) | (p & 3)) % 28;
  function keepForm(D, m) {
    const n = (D.species[mon.species(m)] || {}).n || '', old = mon.pid(m);
    if (n === 'Unown') return p => unownLetter(p) === unownLetter(old);
    if (/^Minior\b/.test(n)) return p => p % 7 === old % 7;
    return null;
  }
  function setNatureShiny(m, nature, shiny, D) {
    mon.setPid(m, solvePid({ otid: mon.otid(m), nature, shiny, lowByte: mon.pid(m) & 0xFF, keep: D ? keepForm(D, m) : null }));
  }
  // Ability: the personality's lowest bit picks ability 1 or 2, and a separate flag picks the hidden ability.
  // A slot the species doesn't have falls back to ability 1, like the game.
  function abilityName(X, m) {
    const x = X && X.species[mon.species(m)];
    if (!x) return '';
    if (mon.hiddenAbility(m) && x.ab[2]) return x.ab[2];
    return ((mon.pid(m) & 1) && x.ab[1]) || x.ab[0];
  }
  // index: 0 = ability 1, 1 = ability 2, 2 = hidden. Nature, shininess and gender stay the same.
  function setAbility(D, m, index) {
    mon.setHiddenAbility(m, index === 2);
    if (index === 2 || (mon.pid(m) & 1) === index) return;
    const ratio = genderRatio(D, mon.species(m));
    mon.setPid(m, solvePid({ otid: mon.otid(m), nature: mon.nature(m), shiny: mon.shiny(m), gender: genderOf(D, m), ratio, abilityBit: index, keep: keepForm(D, m) }));
  }
  // New original trainer IDs. The game reads shininess from the IDs and the personality, so the personality is
  // re-rolled when needed to keep the Pokémon shiny or not shiny (nature, gender, ability and form stay too).
  function setOtIds(D, m, tid, sid) {
    const shiny = mon.shiny(m);
    w32(m.buf, m.off + 4, (((sid & 0xFFFF) << 16) | (tid & 0xFFFF)) >>> 0);
    if (mon.shiny(m) !== shiny) setNatureShiny(m, mon.nature(m), shiny, D);
  }
  // Makes the Pokémon the save's own: OT name, gender and IDs of the trainer (shininess kept).
  function makeMine(sv, D, m) {
    const t = trainer(sv);
    m.buf.set(t.nameBytes, m.off + 0x14);
    mon.setOtGender(m, t.gender & 1);
    setOtIds(D, m, t.tid, t.sid);
  }
  function setGender(D, m, gender) {
    const ratio = genderRatio(D, mon.species(m));
    if (ratio === 0 || ratio >= 254) return false;
    mon.setPid(m, solvePid({ otid: mon.otid(m), nature: mon.nature(m), shiny: mon.shiny(m), gender, ratio, abilityBit: mon.pid(m) & 1, keep: keepForm(D, m) }));
    return true;
  }

  // ── Trainer ──
  const key = sv => u32(sv.data, sv.sec[0] + 0xF20);
  function trainer(sv) {
    const s0 = sv.sec[0], k = key(sv);
    return {
      name: decodeText(sv.data.subarray(s0, s0 + 8)),
      nameBytes: sv.data.slice(s0, s0 + 7),
      gender: sv.data[s0 + 8],
      tid: u16(sv.data, s0 + 0xA), sid: u16(sv.data, s0 + 0xC),
      money: (u32(sv.data, sv.sec[1] + 0x290) ^ k) >>> 0,
      coins: (u16(sv.data, sv.sec[1] + 0x294) ^ (k & 0xFFFF)) & 0xFFFF,
    };
  }
  const setMoney = (sv, v) => w32(sv.data, sv.sec[1] + 0x290, (Math.max(0, Math.min(MONEY_MAX, v)) ^ key(sv)) >>> 0);
  const setCoins = (sv, v) => w16(sv.data, sv.sec[1] + 0x294, (Math.max(0, Math.min(COINS_MAX, v)) ^ key(sv)) & 0xFFFF);

  // ── Bag ──
  const bagOff = (sv, i) => (i < BAG_IN_SECTOR ? sv.sec[13] + 0xAD8 + i : rawFile(i - BAG_IN_SECTOR));
  function readPocket(sv, p) {
    const k = key(sv) & 0xFFFF, items = [];
    for (let s = 0; s < p.cap; s++) {
      const o = bagOff(sv, p.off + s * 4), id = u16(sv.data, o), qty = (u16(sv.data, o + 2) ^ k) & 0xFFFF;
      if (!id) break;
      items.push({ id, qty });
    }
    return items;
  }
  // Rewrites the whole pocket: entries first, then zeroed slots, so nothing stale survives.
  function writePocket(sv, p, items) {
    if (items.length > p.cap) throw new Error(`${p.name} can hold ${p.cap} different items.`);
    const k = key(sv) & 0xFFFF;
    for (let s = 0; s < p.cap; s++) {
      const o = bagOff(sv, p.off + s * 4);
      if (s < items.length) { w16(sv.data, o, items[s].id); w16(sv.data, o + 2, (items[s].qty ^ k) & 0xFFFF); }
      else { w16(sv.data, o, 0); w16(sv.data, o + 2, 0); }
    }
  }
  // Pocket an item belongs to (the rules PKForge validated against a real save).
  function pocketOf(D, id) {
    const n = D.items[id] || '';
    if ((id >= 1 && id <= 12) || (id >= 239 && id <= 253)) return 'balls';
    if (n.endsWith(' Berry')) return 'berries';
    if (/^[TH]M\d+$/.test(n)) return 'tms';
    if ((id >= 259 && id <= 265) || (id >= 347 && id <= 374) || id === 182) return 'key';
    return 'items';
  }

  // ── Pokédex ──
  function dexBit(sv, base, nat, on) {
    if (nat < 1 || nat > (on === false ? DEX_BYTES * 8 : NATIONAL_DEX)) return false;
    const o = sv.sec[1] + base + ((nat - 1) >> 3), bit = 1 << ((nat - 1) & 7);
    if (on === undefined) return (sv.data[o] & bit) !== 0;
    sv.data[o] = on ? sv.data[o] | bit : sv.data[o] & ~bit;
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
    // Removes entries the game can't make, left by RadicalHex 1.0.0-1.0.7 (which wrote "caught" at CFRU's 0x38D):
    // seen entries above No. 1025, and caught entries that were never seen. Returns how many it removed.
    repair(sv) {
      let n = 0;
      for (let nat = NATIONAL_DEX + 1; nat <= (DEX_CAUGHT - DEX_SEEN) * 8; nat++) if (dexBit(sv, DEX_SEEN, nat)) { dexBit(sv, DEX_SEEN, nat, false); n++; }
      for (let nat = 1; nat <= NATIONAL_DEX; nat++) if (dexBit(sv, DEX_CAUGHT, nat) && !dexBit(sv, DEX_SEEN, nat)) { dexBit(sv, DEX_CAUGHT, nat, false); n++; }
      return n;
    },
  };
  // Like PKHeX: when saving, every Pokémon in the file (party and all boxes, eggs excluded) is registered as seen and
  // caught, as the game itself does for anything you own (catching, gifts, trades, evolving, hatching). Something
  // added and then removed or replaced before saving is never registered. Returns the national numbers that became caught.
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

  // ── Creating, copying and moving PC Pokémon ──
  // opts: species, level, nature, shiny, gender, nickname, item, ball, friendship, moves[4], ivs[6], evs[6],
  // ability (0 = ability 1, 1 = ability 2, 2 = hidden; hidden: true also means 2), metLocation (default Pallet Town)
  function createInBox(sv, D, ref, opts) {
    if (ref.party) throw new Error('New Pokémon go into a box. Withdraw them in the game to add them to the party.');
    if (!mon.empty(ref)) throw new Error('That box slot is not empty.');
    if (!validSpecies(D, opts.species)) throw new Error('Choose a species from the list.');
    if (!growth(D, opts.species)) throw new Error('RadicalHex has no level data for this species, so it cannot create it.');
    if (!opts.moves.some(x => x)) throw new Error('Give it at least one move.');
    const t = trainer(sv), otid = ((t.sid << 16) | t.tid) >>> 0;
    const nick = encodeText(opts.nickname || defaultNickname(D, opts.species), 10);
    if (!nick) throw new Error('The nickname uses a character the game cannot show.');
    const b = new Uint8Array(BOX_MON);
    const ratio = genderRatio(D, opts.species);
    const ability = opts.hidden ? 2 : opts.ability | 0;
    w32(b, 0, solvePid({ otid, nature: opts.nature, shiny: opts.shiny, gender: opts.gender, ratio, abilityBit: ability < 2 ? ability : null }));
    w32(b, 4, otid);
    b.set(nick, 8);
    b[0x12] = 2; // English
    b[0x13] = 2; // has species
    b.set(t.nameBytes, 0x14);
    const m = { buf: b, off: 0, party: false };
    mon.setSpecies(m, opts.species);
    mon.setItem(m, opts.item || 0);
    const L = Math.max(1, Math.min(100, opts.level | 0));
    mon.setExp(m, growth(D, opts.species)[L]);
    mon.setFriendship(m, opts.friendship ?? 70);
    mon.setBall(m, opts.ball ?? 3);
    mon.setMoves(m, opts.moves.map(x => x | 0), D);
    mon.setEvs(m, opts.evs || [0, 0, 0, 0, 0, 0]);
    b[0x33] = opts.metLocation ?? PALLET_TOWN;
    w16(b, 0x34, L | (GAME_FIRERED << 7) | ((t.gender & 1) << 15));
    mon.setIvs(m, opts.ivs || [31, 31, 31, 31, 31, 31]);
    if (ability === 2) mon.setHiddenAbility(m, true);
    ref.buf.set(b, ref.off);
  }
  const release = ref => { if (!ref.party) ref.buf.fill(0, ref.off, ref.off + BOX_MON); };

  // ── Party: withdraw, deposit, add ──
  // A box Pokémon in the 100-byte party form, like the game's withdraw (CFRU CreateBoxMonFromCompressedMon, then BoxMonToMon):
  // PP refilled with PP Ups, no status, no mail, level from EXP, battle stats calculated and full HP.
  function boxToParty(D, X, src, dst) {
    const sp = mon.species(src), name = (D.species[sp] && D.species[sp].n) || `#${sp}`;
    if (!X || !X.species[sp]) throw new Error(`RadicalHex has no Radical Red stat data for ${name}, so it can't put it in the party. It can stay in a box.`);
    if (!growth(D, sp)) throw new Error(`RadicalHex has no level data for ${name}, so it can't put it in the party. It can stay in a box.`);
    const b = dst.buf, o = dst.off, s = src.buf, so = src.off;
    b.fill(0, o, o + PARTY_MON);
    b.set(s.subarray(so, so + 0x1C), o); // PID, OT ID, nickname, language, flags, OT name, markings
    mon.setSpecies(dst, sp); mon.setItem(dst, mon.item(src)); mon.setExp(dst, mon.exp(src));
    b[o + 0x28] = s[so + 0x24]; // PP Ups
    mon.setFriendship(dst, mon.friendship(src)); mon.setBall(dst, mon.ball(src));
    const mv = mon.moves(src), ups = s[so + 0x24];
    for (let i = 0; i < 4; i++) { w16(b, o + 0x2C + 2 * i, mv[i]); b[o + 0x34 + i] = mv[i] ? Math.min(255, maxPp(D, mv[i], (ups >> (2 * i)) & 3)) : 0; }
    mon.setEvs(dst, mon.evs(src));
    b[o + 0x44] = s[so + 0x32]; b[o + 0x45] = s[so + 0x33]; w16(b, o + 0x46, u16(s, so + 0x34)); w32(b, o + 0x48, mon.ivWord(src));
    b[o + 0x54] = levelOf(D, src);
    b[o + 0x55] = 0xFF; // no mail
    if (!recalcStats(D, X, dst)) throw new Error(`Could not work out ${name}'s battle stats.`);
    w16(b, o + 0x56, u16(b, o + 0x58)); // full HP
  }
  const setPartyCount = (sv, n) => w32(sv.data, sv.sec[1] + 0x34, n);
  // Copies a Pokémon (from a box or the party) to the end of the party, leaving the original where it is.
  function copyToParty(sv, D, X, src) {
    if (mon.empty(src)) throw new Error('Pick a Pokémon to copy.');
    const n = partyCount(sv);
    if (n >= 6) throw new Error('Your party is full (6 Pokémon). Move one to a box first.');
    const dst = partyRef(sv, n);
    if (src.party) dst.buf.set(src.buf.slice(src.off, src.off + PARTY_MON), dst.off);
    else boxToParty(D, X, src, dst);
    setPartyCount(sv, n + 1);
    return n;
  }
  // Moves a box Pokémon to the end of the party. Returns its party slot.
  function withdraw(sv, D, X, ref) {
    if (ref.party || mon.empty(ref)) throw new Error('Pick a Pokémon in a box.');
    const n = partyCount(sv);
    if (n >= 6) throw new Error('Your party is full (6 Pokémon). Move one to a box first.');
    boxToParty(D, X, ref, partyRef(sv, n));
    setPartyCount(sv, n + 1);
    release(ref);
    return n;
  }
  // Moves a party Pokémon into an empty box slot; the Pokémon after it move up, like the game.
  function deposit(sv, D, i, dst) {
    const n = partyCount(sv);
    if (i >= n) throw new Error('Pick a Pokémon in your party.');
    let others = 0;
    for (let k = 0; k < n; k++) if (k !== i && !mon.isEgg(partyRef(sv, k))) others++;
    if (!others) throw new Error("That's your last Pokémon (eggs don't count). The game needs at least one in the party.");
    copyToBox(D, partyRef(sv, i), dst);
    const base = sv.sec[1] + 0x38;
    sv.data.copyWithin(base + i * PARTY_MON, base + (i + 1) * PARTY_MON, base + n * PARTY_MON);
    sv.data.fill(0, base + (n - 1) * PARTY_MON, base + n * PARTY_MON);
    setPartyCount(sv, n - 1);
  }
  const nonEggsBut = (sv, i) => { let n = 0; for (let k = 0; k < partyCount(sv); k++) if (k !== i && !mon.isEgg(partyRef(sv, k))) n++; return n; };
  // Party slot i <-> a box slot holding a Pokémon: each goes where the other was (box one withdrawn, party one deposited).
  function swapBoxParty(sv, D, X, bref, i) {
    if (bref.party || mon.empty(bref) || i >= partyCount(sv)) throw new Error('Pick a box Pokémon and a party Pokémon.');
    const p = partyRef(sv, i);
    if (mon.isEgg(bref) && !mon.isEgg(p) && !nonEggsBut(sv, i)) throw new Error("That's your last Pokémon (eggs don't count). The game needs at least one in the party.");
    const tmp = { buf: bref.buf.slice(bref.off, bref.off + BOX_MON), off: 0, party: false };
    release(bref);
    copyToBox(D, p, bref);
    boxToParty(D, X, tmp, p);
  }
  // Moves party slot i onto party slot j: two Pokémon swap places; an empty slot j puts it last (the party stays packed).
  function moveInParty(sv, i, j) {
    const n = partyCount(sv), base = sv.sec[1] + 0x38;
    if (i >= n || i === j) return false;
    const a = sv.data.slice(base + i * PARTY_MON, base + (i + 1) * PARTY_MON);
    if (j < n) {
      sv.data.copyWithin(base + i * PARTY_MON, base + j * PARTY_MON, base + (j + 1) * PARTY_MON);
      sv.data.set(a, base + j * PARTY_MON);
    } else {
      if (i === n - 1) return false;
      sv.data.copyWithin(base + i * PARTY_MON, base + (i + 1) * PARTY_MON, base + n * PARTY_MON);
      sv.data.set(a, base + (n - 1) * PARTY_MON);
    }
    return true;
  }
  // One drag and drop: from and to are { party, box, slot }. Returns false when nothing moves.
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
  // Creates a new Pokémon straight in the party (same options as createInBox). Returns its party slot.
  function createInParty(sv, D, X, opts) {
    const n = partyCount(sv);
    if (n >= 6) throw new Error('Your party is full (6 Pokémon). Move one to a box first.');
    const tmp = { buf: new Uint8Array(BOX_MON), off: 0, party: false };
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
  // Copies any Pokémon (party or box) into an empty box slot, converting to the 58-byte PC form like the game's deposit.
  function copyToBox(D, src, dst) {
    if (dst.party || !mon.empty(dst)) throw new Error('Pick an empty box slot.');
    if (!src.party) { dst.buf.set(src.buf.subarray(src.off, src.off + BOX_MON), dst.off); return; }
    const b = new Uint8Array(BOX_MON), m = { buf: b, off: 0, party: false };
    b.set(src.buf.subarray(src.off, src.off + 0x1C), 0); // PID, OTID, nickname, language, flags, OT, markings
    mon.setSpecies(m, mon.species(src)); mon.setItem(m, mon.item(src)); mon.setExp(m, mon.exp(src));
    mon.setFriendship(m, mon.friendship(src)); mon.setBall(m, mon.ball(src));
    mon.setMoves(m, mon.moves(src), D);
    b[0x24] = src.buf[src.off + 0x28]; // PP Ups
    mon.setEvs(m, mon.evs(src));
    b[0x32] = src.buf[src.off + 0x44]; b[0x33] = src.buf[src.off + 0x45];
    w16(b, 0x34, u16(src.buf, src.off + 0x46)); w32(b, 0x36, mon.ivWord(src));
    dst.buf.set(b, dst.off);
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
  // Parses one Showdown set into createInBox options. Returns { opts, warnings }. X (the RadicalDex) is needed to read the ability.
  function fromShowdown(D, text, X) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) throw new Error('Paste a Showdown set first.');
    const warnings = [], opts = { level: 100, nature: 0, shiny: false, gender: null, item: 0, ball: 3, friendship: 255,
      moves: [0, 0, 0, 0], ivs: [31, 31, 31, 31, 31, 31], evs: [0, 0, 0, 0, 0, 0], ability: 0, nickname: '' };
    let head = lines[0], m;
    if ((m = head.match(/@\s*(.+)$/))) {
      const id = findName(D.items, m[1]);
      if (id > 0 && validItem(D, id)) opts.item = id; else warnings.push(`Item "${m[1]}" is not in Radical Red; left empty.`);
      head = head.slice(0, m.index).trim();
    }
    if ((m = head.match(/\((M|F)\)$/))) { opts.gender = m[1] === 'F' ? 1 : 0; head = head.slice(0, m.index).trim(); }
    if ((m = head.match(/^(.*)\(([^()]+)\)$/))) { opts.nickname = m[1].trim(); head = m[2].trim(); }
    opts.species = findName(D.species, head);
    if (opts.species <= 0) throw new Error(`"${head}" is not a Radical Red species name.`);
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
        if (id <= 0) warnings.push(`Move "${m[1]}" is not in Radical Red; skipped.`);
        else if (mi < 4) opts.moves[mi++] = id; else warnings.push(`A Pokémon knows four moves, so ${D.moves[id]} was skipped.`);
      } else if ((m = l.match(/^Ability:\s*(.+)/i))) {
        const ab = X && X.species[opts.species] ? X.species[opts.species].ab : [];
        const i = ab.findIndex(a => a && squash(a) === squash(m[1]));
        if (i >= 0) opts.ability = i; else warnings.push(`${D.species[opts.species].n} can't have ${m[1]} in Radical Red; it gets ability 1.`);
      }
    }
    return { opts, warnings };
  }

  // Things in a save that Radical Red 4.1 doesn't have: unknown species, moves or held items on any Pokémon, unknown bag
  // items, or a party count that doesn't fit. A save like that is probably from another version of Radical Red (or another
  // hack), and editing it could damage it. Returns a short list of what was found (empty when everything is known).
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

  // ── Converting between emulators ──
  // A GBA battery save is the same 128 KB of flash in every emulator. mGBA adds a 16-byte real-time clock block after it
  // (Radical Red uses the clock for day and night); RetroArch's .srm is the 128 KB alone. Returns the layout of a file.
  const FLASH = 0x20000, RTC_BLOCK = 16;
  function saveLayout(bytes) {
    if (bytes.length === FLASH) return { ok: true, extra: 0, text: '128 KB, no clock data (RetroArch .srm, VBA-M)' };
    if (bytes.length === FLASH + RTC_BLOCK) return { ok: true, extra: RTC_BLOCK, text: '128 KB + 16 bytes of clock data (mGBA)' };
    return { ok: false, text: `${bytes.length.toLocaleString()} bytes, which isn't a layout RadicalHex knows how to convert` };
  }
  // format 'srm' (RetroArch): the 128 KB alone. format 'sav' (mGBA, VBA-M, My Boy!): the 128 KB, keeping mGBA's clock
  // block if the file has one. Throws unless the result is a valid save holding exactly the same save data.
  function convertSave(bytes, format) {
    const src = new Uint8Array(bytes), lay = saveLayout(src);
    if (!lay.ok) throw new Error(`This file is ${lay.text}, so it was not converted.`);
    load(src); // must be a real Radical Red save
    const out = format === 'srm' ? src.slice(0, FLASH) : format === 'sav' ? src.slice() : null;
    if (!out) throw new Error('Unknown save format.');
    let back;
    try { back = load(out); } catch (e) { throw new Error('The converted save does not load, so it was not written: ' + e.message); }
    for (let i = 0; i < FLASH; i++) if (out[i] !== src[i]) throw new Error('The converted save does not match the original, so it was not written.');
    if (back.saveIndex !== load(src).saveIndex) throw new Error('The converted save does not match the original, so it was not written.');
    return out;
  }

  const api = {
    WIN, BOXES, SLOTS, POCKETS, BALLS, NATURES, STATS, MONEY_MAX, COINS_MAX, natureEffect,
    load, serialize, build, checksum, allowedRanges, flag, modes,
    partyCount, partyRef, boxRef, boxName, mon, levelOf, setLevel, setExp, growth, genderOf, genderRatio, defaultNickname,
    solvePid, setNatureShiny, setGender, setOtIds, makeMine, abilityName, setAbility, trainer, setMoney, setCoins, readPocket, writePocket, pocketOf,
    dex, registerOwned, clearErased, NATIONAL_DEX, createInBox, release, swap, copyToBox, copyToParty, withdraw, deposit, createInParty, moveMon, toShowdown, fromShowdown, heal, partyStatus, STATUS,
    calcStats, recalcStats, legality, isIllegal, expLevel, unknownData, saveLayout, convertSave, EV_CAP, EV_TOTAL, clampEvs,
    learnable: (X, sp) => learnSet(X, sp),
    levelOnly: (X, sp) => levelOnly(X, sp), // move -> [move, level, species] for moves only learned by levelling up // Set of move ids the species can know in Radical Red (what legality checks)
    validSpecies, validItem, validMove, encodeText, decodeText,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RHCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
