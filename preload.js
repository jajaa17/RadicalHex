// The only bridge between the window and the computer: a handful of file actions.
const { contextBridge, ipcRenderer, webUtils, webFrame } = require('electron');

const call = (name, ...args) => ipcRenderer.invoke(name, ...args).then(r => {
  if (!r.ok) throw new Error(r.error);
  return r.value;
});

contextBridge.exposeInMainWorld('rh', {
  desktop: true,
  openSave: () => call('open-save'),
  openFile: file => call('open-path', webUtils.getPathForFile(file)),
  save: bytes => call('save', bytes),
  saveAs: bytes => call('save-as', bytes),
  listBackups: () => call('list-backups'),
  readBackup: p => call('read-backup', p),
  deleteBackups: paths => call('delete-backups', paths),
  backupNow: bytes => call('backup-now', bytes),
  showBackups: () => call('show-backups'),
  backupDir: () => call('backup-dir'),
  setDirty: d => call('set-dirty', d),
  version: () => call('version'),
  // Updates
  checkUpdate: () => call('update-check'),
  installUpdate: () => call('update-install'),
  autoUpdateCheck: v => call('update-auto', v),
  updateNotice: () => call('update-notice'),
  onUpdateProgress: fn => { ipcRenderer.removeAllListeners('update-progress'); ipcRenderer.on('update-progress', (_e, pct) => fn(pct)); },
  // Lets go of sprites and other images that are no longer on screen.
  trimMemory: () => { try { webFrame.clearCache(); } catch { /* best effort */ } },
});
