const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  resetZoom: () => ipcRenderer.invoke('view:resetZoom'),
  toggleFullscreen: () => ipcRenderer.invoke('view:toggleFullscreen'),
  focusMain: () => ipcRenderer.invoke('app:focusMain'),
  notify: ({ title, body }) => ipcRenderer.invoke('app:notify', { title, body })
});


