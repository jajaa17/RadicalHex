// RadicalHex updates.
// 1. check():  asks GitHub for the latest release (once at start, or when asked). Nothing about the user is sent.
// 2. download(): saves the new RadicalHex.exe next to the running one as RadicalHex.update.exe, and keeps it only if
//    its size and SHA-256 match what GitHub publishes for that file.
// 3. launch(): starts RadicalHex.update.exe with --finish-update, then this copy closes.
// 4. finish(): the new copy waits until the old RadicalHex.exe is free, swaps itself in, and starts it.
// Every step that fails leaves the current RadicalHex.exe exactly as it was.
const { app, net } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const REPO = 'jajaa17/RadicalHex', ASSET = 'RadicalHex.exe', UPDATE_NAME = 'RadicalHex.update.exe';
// Test-only overrides; the released app ignores them.
const dev = !app.isPackaged;
const API = (dev && process.env.RADICALHEX_UPDATE_API) || `https://api.github.com/repos/${REPO}/releases/latest`;
const DOWNLOAD_PREFIX = (dev && process.env.RADICALHEX_UPDATE_PREFIX) || `https://github.com/${REPO}/releases/download/`;
const MIN_SIZE = (dev && +process.env.RADICALHEX_UPDATE_MIN_SIZE) || 10e6;
const SWAP_SECONDS = (dev && +process.env.RADICALHEX_SWAP_SECONDS) || 120;

const parse = v => { const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim()); return m ? m.slice(1).map(Number) : null; };
// True when version a is newer than version b ("1.0.10" is newer than "1.0.9").
function isNewer(a, b) {
  const x = parse(a), y = parse(b);
  if (!x || !y) return false;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i];
  return false;
}
const same = (a, b) => path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase();
const sleep = ms => new Promise(r => setTimeout(r, ms));
// The .exe the user started. The portable launcher sets this; it is missing when RadicalHex runs from source.
const exeFile = () => process.env.PORTABLE_EXECUTABLE_FILE || null;
function fileHash(file) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    fs.createReadStream(file).on('data', d => h.update(d)).on('error', reject).on('end', () => resolve(h.digest('hex')));
  });
}
// Resolves once the process has started; rejects if Windows refused to start it.
const started = child => new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });

let pending = null, busy = false;

async function check() {
  pending = null;
  const res = await net.fetch(API, { headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'RadicalHex' }, cache: 'no-store', signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`GitHub answered ${res.status}. Try again later.`);
  const r = await res.json();
  const current = app.getVersion(), latest = String(r.tag_name || '').replace(/^v/, '');
  let page = String(r.html_url || '');
  if (!page.startsWith(`https://github.com/${REPO}/releases/`)) page = `https://github.com/${REPO}/releases/latest`;
  const info = { current, latest, newer: !r.draft && !r.prerelease && isNewer(latest, current), page, canInstall: false, reason: '' };
  if (!info.newer) return info;
  const a = (r.assets || []).find(x => x && x.name === ASSET);
  const valid = a && typeof a.browser_download_url === 'string' && a.browser_download_url.startsWith(DOWNLOAD_PREFIX)
    && /^sha256:[0-9a-f]{64}$/.test(a.digest || '') && Number.isInteger(a.size) && a.size >= MIN_SIZE && a.size < 600e6;
  if (!valid) info.reason = 'The new version is still being published on GitHub. Try again in a few minutes.';
  else if (!exeFile()) info.reason = 'Updating in place only works in the downloaded RadicalHex.exe.';
  else { info.canInstall = true; pending = { url: a.browser_download_url, size: a.size, sha256: a.digest.slice(7), version: latest }; }
  return info;
}

async function download(onProgress) {
  if (!pending) throw new Error('Check for updates first.');
  if (busy) throw new Error('The update is already downloading.');
  busy = true;
  const dir = path.dirname(exeFile()), part = path.join(dir, UPDATE_NAME + '.part'), dest = path.join(dir, UPDATE_NAME);
  const want = pending;
  try {
    fs.rmSync(part, { force: true });
    fs.rmSync(dest, { force: true });
    const res = await net.fetch(want.url, { headers: { 'User-Agent': 'RadicalHex' }, cache: 'no-store', signal: AbortSignal.timeout(30 * 60000) });
    if (!res.ok || !res.body) throw new Error(`The download failed (GitHub answered ${res.status}). Try again later.`);
    const hash = crypto.createHash('sha256'), out = fs.openSync(part, 'w');
    let got = 0, shown = -1;
    try {
      const reader = res.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.length;
        if (got > want.size) throw new Error('The download is bigger than GitHub says it should be, so it was thrown away.');
        hash.update(value);
        fs.writeSync(out, value);
        const pct = Math.floor(got / want.size * 100);
        if (pct !== shown) { shown = pct; onProgress(pct); }
      }
      fs.fsyncSync(out);
    } finally { fs.closeSync(out); }
    if (got !== want.size) throw new Error('The download was cut short. Try again.');
    if (hash.digest('hex') !== want.sha256) throw new Error("The download doesn't match GitHub's checksum, so it was thrown away. Try again.");
    if (await fileHash(part) !== want.sha256) throw new Error("The downloaded file changed on disk (antivirus?), so it was thrown away.");
    fs.renameSync(part, dest);
    if (process.platform !== 'win32') fs.chmodSync(dest, 0o755); // only Windows runs a file without the execute bit
    return dest;
  } catch (e) {
    try { fs.rmSync(part, { force: true }); } catch { /* removed on the next start */ }
    if (e.code === 'EACCES' || e.code === 'EPERM') throw new Error(`RadicalHex can't write in ${dir}. Move RadicalHex.exe to a folder you own, or download the update from GitHub.`);
    throw e;
  } finally { busy = false; }
}

// Starts the downloaded copy, which finishes the update after this copy has closed.
async function launch(dest) {
  const child = spawn(dest, ['--finish-update', exeFile()], { detached: true, stdio: 'ignore' });
  await started(child);
  child.unref();
}

// Runs in the new copy (RadicalHex.update.exe --finish-update <RadicalHex.exe>).
// Returns { done: true } when the updated RadicalHex.exe was started (this copy should close), otherwise
// { done: false, message } and this copy keeps running. ignore: true when the arguments aren't a real update.
async function finish(target) {
  const self = exeFile();
  if (!self || !target || path.basename(self).toLowerCase() !== UPDATE_NAME.toLowerCase() || !/\.exe$/i.test(target)
    || !same(path.dirname(target), path.dirname(self)) || same(target, self) || !fs.existsSync(target)) return { done: false, ignore: true };
  const tmp = target + '.new';
  try {
    fs.copyFileSync(self, tmp);
    if (await fileHash(tmp) !== await fileHash(self)) throw new Error('The copy of the new version did not match.');
    // The old RadicalHex.exe stays locked until it has fully closed, so keep trying for a while.
    const until = Date.now() + SWAP_SECONDS * 1000;
    for (;;) {
      try { fs.renameSync(tmp, target); break; } catch (e) { if (Date.now() > until) throw e; await sleep(500); }
    }
  } catch (e) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* removed on the next start */ }
    return { done: false, message: `RadicalHex was updated to v${app.getVersion()}, but ${path.basename(target)} couldn't be replaced (${e.code || e.message}), so it was left as it was. This window is the new version, running from ${UPDATE_NAME}. Close every RadicalHex window and update again, or rename ${UPDATE_NAME} to ${path.basename(target)} yourself.` };
  }
  try {
    const child = spawn(target, [], { detached: true, stdio: 'ignore' });
    await started(child);
    child.unref();
    return { done: true };
  } catch {
    return { done: false, message: `RadicalHex was updated to v${app.getVersion()}. Start ${path.basename(target)} again to use it.` };
  }
}

// On a normal start, removes what a finished or failed update left behind next to RadicalHex.exe.
// The update copy may still be closing, so this retries for a minute.
function cleanup() {
  const self = exeFile();
  if (!self || path.basename(self).toLowerCase() === UPDATE_NAME.toLowerCase()) return;
  const dir = path.dirname(self);
  const files = [UPDATE_NAME, UPDATE_NAME + '.part', path.basename(self) + '.new'].map(f => path.join(dir, f));
  let tries = 0;
  const run = () => {
    let left = false;
    for (const f of files) { try { fs.rmSync(f, { force: true }); } catch { left = true; } }
    if (left && ++tries < 60) setTimeout(run, 1000);
  };
  run();
}

module.exports = { check, download, launch, finish, cleanup, isNewer };
