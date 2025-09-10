const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  resetZoom: () => ipcRenderer.invoke('view:resetZoom'),
  toggleFullscreen: () => ipcRenderer.invoke('view:toggleFullscreen')
});


