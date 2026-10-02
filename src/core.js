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
  const DEX_SEEN = 0x310, DEX_CAUGHT = 0x38D, DEX_BYTES = 125;
  const MONEY_MAX = 999999, COINS_MAX = 9999;

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
    const sec = Array(14).fill(-1), idx = Array(14).fill(0);
    for (let s = 0; s < 32; s++) {
      const o = s * 0x1000;
      if (((u32(data, o + 0xFF8) & 0xFFFFFF00) >>> 0) !== 0x08012000) continue;
      const id = u16(data, o + 0xFF4);
      if (id >= 14) continue;
      const n = u32(data, o + 0xFFC);
      if (sec[id] < 0 || n >= idx[id]) { sec[id] = o; idx[id] = n; }
    }
    if (sec.some(o => o < 0)) throw new Error('This is not a Radical Red save: some save sections are missing. Use the .sav/.srm battery save, not a save state.');
    if (sec.some((o, id) => checksum(data, o, WIN[id]) !== u16(data, o + 0xFF6)))
      throw new Error('This is not a Radical Red 4.1 save: the section checksums do not match (vanilla FireRed, another hack, or a damaged file).');
    if (new Set(idx).size !== 1) throw new Error('The save sections disagree about which save is newest. The file may be damaged, so RadicalHex will not edit it.');
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
    return { data, sec, stream, raw, ext, saveIndex: idx[0], original: new Uint8Array(input) };
  }

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
    r.push([s[1] + 0x38, s[1] + 0x38 + 6 * PARTY_MON], [s[1] + 0x290, s[1] + 0x296], [s[1] + DEX_SEEN, s[1] + DEX_CAUGHT + DEX_BYTES]);
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
  const mon = {
    empty: m => mon.species(m) === 0,
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
    nature: m => mon.pid(m) % 25,
    shiny(m) { const x = (mon.otid(m) ^ mon.pid(m)) >>> 0; return ((x & 0xFFFF) ^ (x >>> 16)) < 16; },
    metLocation: m => m.buf[F(m, 0x45, 0x33)],
    metLevel: m => u16(m.buf, F(m, 0x46, 0x34)) & 0x7F,
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
  const maxPp = (D, move, ups) => { const base = D.pp[move] || 0; return base + Math.floor(base / 5) * ups; };
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
  function solvePid({ otid, nature, shiny, lowByte = null, gender = null, ratio = 127, abilityBit = null }, rnd = Math.random) {
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
      if (pid % 25 === nature) return pid;
    }
    throw new Error('Could not find a matching personality value.');
  }
  function setNatureShiny(m, nature, shiny) {
    mon.setPid(m, solvePid({ otid: mon.otid(m), nature, shiny, lowByte: mon.pid(m) & 0xFF }));
  }
  function setGender(D, m, gender) {
    const ratio = genderRatio(D, mon.species(m));
    if (ratio === 0 || ratio >= 254) return false;
    mon.setPid(m, solvePid({ otid: mon.otid(m), nature: mon.nature(m), shiny: mon.shiny(m), gender, ratio, abilityBit: mon.pid(m) & 1 }));
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
    if (nat < 1 || nat > DEX_BYTES * 8) return false;
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
      const c = base => { let n = 0; for (let i = 0; i < DEX_BYTES; i++) { let x = sv.data[sv.sec[1] + base + i]; while (x) { n += x & 1; x >>= 1; } } return n; };
      return { seen: c(DEX_SEEN), caught: c(DEX_CAUGHT) };
    },
  };

  // ── Creating, copying and moving PC Pokémon ──
  // opts: species, level, nature, shiny, gender, nickname, item, ball, friendship, moves[4], ivs[6], evs[6], hidden
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
    w32(b, 0, solvePid({ otid, nature: opts.nature, shiny: opts.shiny, gender: opts.gender, ratio }));
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
    b[0x33] = PALLET_TOWN;
    w16(b, 0x34, L | (GAME_FIRERED << 7) | ((t.gender & 1) << 15));
    mon.setIvs(m, opts.ivs || [31, 31, 31, 31, 31, 31]);
    if (opts.hidden) mon.setHiddenAbility(m, true);
    ref.buf.set(b, ref.off);
    if (D.species[opts.species].nat) dex.register(sv, D.species[opts.species].nat);
  }
  const release = ref => { if (!ref.party) ref.buf.fill(0, ref.off, ref.off + BOX_MON); };
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
  function toShowdown(D, m) {
    const sp = D.species[mon.species(m)]?.n || '#' + mon.species(m), nick = mon.nickname(m);
    const g = genderOf(D, m), item = mon.item(m);
    let head = nick && nick !== defaultNickname(D, mon.species(m)) ? `${nick} (${sp})` : sp;
    if (g < 2 && genderRatio(D, mon.species(m)) % 254 !== 0) head += g ? ' (F)' : ' (M)';
    if (item) head += ' @ ' + (D.items[item] || '#' + item);
    const lines = [head];
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
  // Parses one Showdown set into createInBox options. Returns { opts, warnings }.
  function fromShowdown(D, text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    if (!lines.length) throw new Error('Paste a Showdown set first.');
    const warnings = [], opts = { level: 100, nature: 0, shiny: false, gender: null, item: 0, ball: 3, friendship: 255,
      moves: [0, 0, 0, 0], ivs: [31, 31, 31, 31, 31, 31], evs: [0, 0, 0, 0, 0, 0], hidden: false, nickname: '' };
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
        if (id > 0 && mi < 4) opts.moves[mi++] = id; else warnings.push(`Move "${m[1]}" is not in Radical Red; skipped.`);
      } else if (/^Ability:/i.test(l)) warnings.push('Abilities come from the species in Radical Red; only Hidden Ability can be toggled.');
    }
    return { opts, warnings };
  }

  const api = {
    WIN, BOXES, SLOTS, POCKETS, BALLS, NATURES, STATS, MONEY_MAX, COINS_MAX, natureEffect,
    load, serialize, build, checksum, allowedRanges,
    partyCount, partyRef, boxRef, boxName, mon, levelOf, setLevel, growth, genderOf, genderRatio, defaultNickname,
    solvePid, setNatureShiny, setGender, trainer, setMoney, setCoins, readPocket, writePocket, pocketOf,
    dex, createInBox, release, swap, copyToBox, toShowdown, fromShowdown, heal, partyStatus, STATUS,
    validSpecies, validItem, validMove, encodeText, decodeText,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RHCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
