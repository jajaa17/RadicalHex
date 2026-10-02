// RadicalHex desktop shell: windows, file dialogs, backups and safe writes.
const { app, BrowserWindow, ipcMain, dialog, shell, nativeTheme, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const SAVE_FILTERS = [{ name: 'GBA battery save', extensions: ['sav', 'srm', 'sa1', 'dsv', 'fla'] }, { name: 'All files', extensions: ['*'] }];
const backupDir = () => path.join(app.getPath('documents'), 'RadicalHex', 'Backups');
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

function createWindow() {
  // Open at a size that fits the screen (old 1024x768 monitors and scaled laptop screens included).
  const area = screen.getPrimaryDisplay().workAreaSize;
  const width = Math.min(1360, Math.round(area.width * 0.94)), height = Math.min(880, Math.round(area.height * 0.94));
  win = new BrowserWindow({
    width, height, minWidth: Math.min(900, area.width), minHeight: Math.min(560, area.height),
    title: 'RadicalHex',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#141217' : '#f2f1f4',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true },
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

// Keeps a copy of the bytes in Documents\RadicalHex\Backups unless the newest backup of this save is identical.
function backup(name, bytes) {
  const dir = backupDir();
  fs.mkdirSync(dir, { recursive: true });
  const base = path.parse(name).name;
  const mine = fs.readdirSync(dir).filter(f => f.startsWith(base + ' (') && f.endsWith('.sav')).sort();
  const last = mine[mine.length - 1];
  if (last && sha1(fs.readFileSync(path.join(dir, last))) === sha1(bytes)) return path.join(dir, last);
  const file = path.join(dir, `${base} (${stamp()}).sav`);
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
  const r = await dialog.showOpenDialog(win, { title: 'Open a Radical Red save', properties: ['openFile'], filters: SAVE_FILTERS,
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
handle('list-backups', async () => {
  const dir = backupDir();
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.sav')).map(f => {
    const st = fs.statSync(path.join(dir, f));
    return { name: f, path: path.join(dir, f), size: st.size, time: st.mtimeMs };
  }).sort((a, b) => b.time - a.time);
});
handle('read-backup', async p => {
  const dir = backupDir(), full = path.resolve(p);
  if (path.dirname(full) !== dir) throw new Error('That file is not in the RadicalHex backups folder.');
  return new Uint8Array(fs.readFileSync(full));
});
handle('backup-now', async bytes => backup(current ? current.name : 'RadicalRed.sav', Buffer.from(bytes)));
handle('show-backups', async () => { fs.mkdirSync(backupDir(), { recursive: true }); return shell.openPath(backupDir()); });
handle('set-dirty', async d => { win.__dirty = !!d; });
handle('version', async () => app.getVersion());

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
