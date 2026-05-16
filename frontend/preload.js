/**
 * Preload script — contextBridge exposes a minimal, typed API to the renderer.
 * No Node APIs leak into the renderer process.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tilt', {
  // Engine
  engineStatus: () => ipcRenderer.invoke('engine:status'),
  launchTable: (opts) => ipcRenderer.invoke('engine:launch', opts),
  stopEngine: () => ipcRenderer.invoke('engine:stop'),

  // Dialogs
  chooseFolder: () => ipcRenderer.invoke('dialog:chooseFolder'),
  chooseFile: () => ipcRenderer.invoke('dialog:chooseFile'),

  // Table scanning
  scanFolder: (folder) => ipcRenderer.invoke('tables:scan', folder),

  // Subscriptions (renderer → listen for events from main)
  onEngineEvent: (cb) => ipcRenderer.on('engine:event', (_e, msg) => cb(msg)),
  onEngineLog: (cb) => ipcRenderer.on('engine:log', (_e, line) => cb(line)),
  onEngineStopped: (cb) => ipcRenderer.on('engine:stopped', (_e, info) => cb(info)),
  onFolderSelected: (cb) => ipcRenderer.on('tables:folderSelected', (_e, folder) => cb(folder)),

  // Cleanup
  removeAllListeners: (channel) => ipcRenderer.removeAllListeners(channel),
});
