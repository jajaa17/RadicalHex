// RadicalHex desktop shell: windows, file dialogs, backups and safe writes.
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const updater = require('./updater');

const SAVE_FILTERS = [{ name: 'GBA battery save', extensions: ['sav', 'srm', 'sa1', 'dsv', 'fla'] }, { name: 'All files', extensions: ['*'] }];
// Backups go in a "Backups" folder next to RadicalHex.exe. The portable .exe runs from a temporary copy, so electron-builder
// passes the folder the .exe was started from in PORTABLE_EXECUTABLE_DIR. If that folder can't be written to
// (Program Files, for example), backups go to Documents\RadicalHex\Backups, where versions before 1.0.5 kept them.
const oldBackupDir = () => path.join(app.getPath('documents'), 'RadicalHex', 'Backups');
let backupFolder = null;
function backupDir() {
  if (backupFolder) return backupFolder;
  const dir = path.join(process.env.PORTABLE_EXECUTABLE_DIR || (app.isPackaged ? path.dirname(process.execPath) : __dirname), 'Backups');
  try {
    fs.mkdirSync(dir, { recursive: true });
    const probe = path.join(dir, '.radicalhex-write-test');
    fs.writeFileSync(probe, 'ok'); fs.rmSync(probe);
    backupFolder = dir;
  } catch { backupFolder = oldBackupDir(); }
  return backupFolder;
}
// Folders whose backups are listed: the current one, plus the old Documents folder if it has backups from earlier versions.
const backupDirs = () => [...new Set([backupDir(), oldBackupDir()])].filter(d => fs.existsSync(d));
const sha1 = buf => crypto.createHash('sha1').update(buf).digest('hex');
const stamp = () => { // local time, e.g. 2026-10-02 23-22-47
  const d = new Date(), p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`;
};

// Small settings file in the app's data folder (e.g. the folder of the last save you opened).
const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');
function readSettings() { try { return JSON.parse(fs.readFileSync(settingsFile(), 'utf8')); } catch { return {}; } }
function writeSettings(patch) { try { fs.writeFileSync(settingsFile(), JSON.stringify({ ...readSettings(), ...patch }, null, 2)); } catch { /* a convenience only */ } }

let win;
let current = null; // { path, name }
const SMOKE = process.argv.includes('--smoke-test'); // CI: load the window, check it, quit

// RadicalHex only draws simple 2D pages, so the GPU process is not needed. Turning it off saves about 40 MB of memory.
app.disableHardwareAcceleration();
// RadicalHex never goes online, so the network helper runs inside the main process instead of its own (about 12 MB less).
app.commandLine.appendSwitch('enable-features', 'NetworkServiceInProcess2');

function createWindow() {
  // Open at a size that fits the screen (old 1024x768 monitors and scaled laptop screens included).
  const area = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1360, Math.round(area.width * 0.94)), height = Math.min(880, Math.round(area.height * 0.94));
  win = new BrowserWindow({
    width, height, minWidth: Math.min(900, area.width), minHeight: Math.min(560, area.height),
    title: 'RadicalHex',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141217' : '#f2f1f4',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  win.removeMenu();
  if (area.width <= 1280 || area.height <= 768) win.maximize(); // small screens: use all of it
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  // Links open in the real browser; the app never navigates away.
  win.webContents.setWindowOpenHandler(({ url }) => { if (/^https:\/\//.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', e => e.preventDefault());
  if (SMOKE) {
    win.webContents.on('console-message', (e, ...args) => {
      const level = e.level ?? args[0], message = e.message ?? args[1];
      if (level === 'error' || level === 3) { console.error('Renderer error:', message); app.exit(1); }
    });
    win.webContents.on('did-finish-load', async () => {
      const ok = await win.webContents.executeJavaScript(
        "typeof window.RHCore === 'object' && typeof window.rh === 'object' && window.rh.desktop === true && window.RH_DATA.species.length > 1300 && !!document.querySelector('#btnOpen')");
      console.log(ok ? 'Smoke test passed.' : 'Smoke test failed.');
      app.exit(ok ? 0 : 1);
    });
  }
  win.on('close', e => {
    if (!win.__dirty) return;
    const choice = dialog.showMessageBoxSync(win, {
      type: 'warning', buttons: ['Discard changes and quit', 'Cancel'], defaultId: 1, cancelId: 1,
      message: 'You have unsaved changes.', detail: 'Quit without saving them?',
    });
    if (choice !== 0) e.preventDefault();
  });
}

// Keeps a copy of the bytes in the backups folder unless the newest backup of this save is identical.
// A backup keeps the save's own file type (.srm stays .srm, .sav stays .sav); anything else is kept as .sav.
const BACKUP_EXTS = ['.sav', '.srm', '.sa1', '.dsv', '.fla'];
const isBackup = f => BACKUP_EXTS.includes(path.extname(f).toLowerCase());
function backup(name, bytes) {
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const { name: base, ext: e } = path.parse(name);
  const ext = BACKUP_EXTS.includes(e.toLowerCase()) ? e.toLowerCase() : '.sav';
  const mine = fs.readdirSync(dir).filter(f => f.startsWith(base + ' (') && path.extname(f).toLowerCase() === ext).sort();
  const last = mine[mine.length - 1];
  if (last && sha1(fs.readFileSync(path.join(dir, last))) === sha1(bytes)) return path.join(dir, last);
  const file = path.join(dir, `${base} (${stamp()})${ext}`);
  fs.writeFileSync(file, bytes);
  if (sha1(fs.readFileSync(file)) !== sha1(bytes)) throw new Error('The backup could not be verified.');
  return file;
}

function readSave(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.length < 0x20000 || bytes.length > 0x40000) throw new Error('This file is not the size of a GBA save.');
  current = { path: file, name: path.basename(file) };
  writeSettings({ lastDir: path.dirname(file) });
  const backupPath = backup(current.name, bytes);
  return { path: file, name: current.name, bytes: new Uint8Array(bytes), backup: backupPath };
}

// Writes through a temporary file, then renames over the target and reads it back.
function writeSafely(file, bytes) {
  const tmp = file + '.radicalhex-tmp';
  fs.writeFileSync(tmp, bytes);
  if (sha1(fs.readFileSync(tmp)) !== sha1(bytes)) { fs.rmSync(tmp, { force: true }); throw new Error('The new save could not be verified, so nothing was replaced.'); }
  fs.renameSync(tmp, file);
  if (sha1(fs.readFileSync(file)) !== sha1(bytes)) throw new Error('The save on disk does not match what was written. Restore it from Backups.');
}

const handle = (name, fn) => ipcMain.handle(name, async (_e, ...args) => {
  try { return { ok: true, value: await fn(...args) }; } catch (err) { return { ok: false, error: err.message }; }
});

handle('open-save', async () => {
  const last = readSettings().lastDir;
  const r = await dialog.showOpenDialog(win, { title: 'Open a Radical Red or SoulGold save', properties: ['openFile'], filters: SAVE_FILTERS,
    defaultPath: last && fs.existsSync(last) ? last : undefined }); // start in the folder of the last save
  return r.canceled ? null : readSave(r.filePaths[0]);
});
handle('open-path', async p => readSave(p));
handle('save', async bytes => {
  if (!current) throw new Error('Open a save first.');
  const buf = Buffer.from(bytes);
  backup(current.name, fs.readFileSync(current.path)); // the file as it is on disk right now
  writeSafely(current.path, buf);
  win.__dirty = false;
  return current.path;
});
handle('save-as', async bytes => {
  const r = await dialog.showSaveDialog(win, { title: 'Save a copy', defaultPath: current ? current.path.replace(/(\.\w+)?$/, ' (edited)$1') : 'RadicalRed.sav', filters: SAVE_FILTERS });
  if (r.canceled) return null;
  if (fs.existsSync(r.filePath)) backup(path.basename(r.filePath), fs.readFileSync(r.filePath));
  writeSafely(r.filePath, Buffer.from(bytes));
  current = { path: r.filePath, name: path.basename(r.filePath) };
  win.__dirty = false;
  return r.filePath;
});
// Writes a converted copy of the open save (RetroArch .srm or a plain .sav). The open file is never touched: a
// copy can't be written over it, a file already at the chosen path is backed up first, and the copy is verified.
const FORMATS = { srm: { name: 'RetroArch save', size: [0x20000] }, sav: { name: 'GBA battery save', size: [0x20000, 0x20010] } };
handle('convert-save', async ({ bytes, format } = {}) => {
  const f = FORMATS[format];
  if (!f) throw new Error('Unknown save format.');
  const buf = Buffer.from(bytes || []);
  if (!f.size.includes(buf.length)) throw new Error('The converted save is the wrong size, so it was not written.');
  const base = current ? current.path : path.join(readSettings().lastDir || app.getPath('documents'), 'RadicalRed.sav');
  const r = await dialog.showSaveDialog(win, { title: `Save a ${format === 'srm' ? 'RetroArch .srm' : '.sav'} copy`,
    defaultPath: base.replace(/(\.\w+)?$/, '.' + format), filters: [{ name: f.name, extensions: [format] }, { name: 'All files', extensions: ['*'] }] });
  if (r.canceled) return null;
  if (current && path.resolve(r.filePath).toLowerCase() === path.resolve(current.path).toLowerCase())
    throw new Error(`That is the save you have open (${current.name}). Pick another name or folder, so the original stays as it is.`);
  if (fs.existsSync(r.filePath)) backup(path.basename(r.filePath), fs.readFileSync(r.filePath));
  writeSafely(r.filePath, buf);
  return r.filePath;
});
handle('list-backups', async () => backupDirs().flatMap(dir => fs.readdirSync(dir).filter(isBackup).map(f => {
  const st = fs.statSync(path.join(dir, f));
  return { name: f, path: path.join(dir, f), size: st.size, time: st.mtimeMs, old: dir !== backupDir() };
})).sort((a, b) => b.time - a.time));
handle('read-backup', async p => {
  const full = path.resolve(p);
  if (!backupDirs().includes(path.dirname(full))) throw new Error('That file is not in a RadicalHex backups folder.');
  return new Uint8Array(fs.readFileSync(full));
});
// Deletes backups the user picked. Only save files (.sav, .srm...) directly inside a RadicalHex backups folder can be deleted.
handle('delete-backups', async paths => {
  const dirs = backupDirs();
  const ok = (Array.isArray(paths) ? paths : []).map(p => path.resolve(String(p)))
    .filter(f => isBackup(f) && dirs.includes(path.dirname(f)) && fs.existsSync(f));
  let n = 0;
  for (const f of ok) { fs.rmSync(f); n++; }
  return n;
});
handle('backup-now', async bytes => backup(current ? current.name : 'RadicalRed.sav', Buffer.from(bytes)));
handle('show-backups', async () => { fs.mkdirSync(backupDir(), { recursive: true }); return shell.openPath(backupDir()); });
handle('backup-dir', async () => backupDir());
handle('set-dirty', async d => { win.__dirty = !!d; });
handle('version', async () => app.getVersion());
// Updates (see updater.js). The check is on by default and can be turned off; the choice is kept in settings.json.
let updateNotice = null; // a message from the update step that just ran, shown once the window is up
handle('update-auto', async v => { if (typeof v === 'boolean') writeSettings({ autoUpdateCheck: v }); return readSettings().autoUpdateCheck !== false; });
handle('update-check', async () => updater.check());
handle('update-notice', async () => { const n = updateNotice; updateNotice = null; return n; });
handle('update-install', async () => {
  const dest = await updater.download(pct => { if (win && !win.isDestroyed()) win.webContents.send('update-progress', pct); });
  await updater.launch(dest);
  win.__dirty = false; // the window already asked about unsaved changes
  setTimeout(() => app.quit(), 100);
  return true;
});

app.whenReady().then(async () => {
  const fin = process.argv.indexOf('--finish-update');
  if (fin > 0 && !SMOKE) {
    const r = await updater.finish(process.argv[fin + 1]);
    if (r.done) { app.quit(); return; } // the updated RadicalHex.exe is starting
    if (r.message) updateNotice = r.message;
  } else updater.cleanup();
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
