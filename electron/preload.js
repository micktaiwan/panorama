const { contextBridge } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  // Fill with IPC helpers later
});


