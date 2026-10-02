// The only bridge between the window and the computer: a handful of file actions.
const { contextBridge, ipcRenderer, webUtils } = require('electron');

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
  backupNow: bytes => call('backup-now', bytes),
  showBackups: () => call('show-backups'),
  setDirty: d => call('set-dirty', d),
  version: () => call('version'),
});
