const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electron', {
  resetZoom: () => ipcRenderer.invoke('view:resetZoom'),
  toggleFullscreen: () => ipcRenderer.invoke('view:toggleFullscreen'),
  setSimpleFullscreen: (enabled) => ipcRenderer.invoke('view:setSimpleFullscreen', enabled),
  focusMain: () => ipcRenderer.invoke('app:focusMain'),
  notify: ({ title, body }) => ipcRenderer.invoke('app:notify', { title, body }),

  // Chat window management
  chatOpenWindow: () => ipcRenderer.invoke('chat:openWindow'),
  chatCloseWindow: () => ipcRenderer.invoke('chat:closeWindow'),
  chatFocusWindow: () => ipcRenderer.invoke('chat:focusWindow'),
  chatIsWindowOpen: () => ipcRenderer.invoke('chat:isWindowOpen'),

  // Listen for chat window closed event (from main process)
  onChatWindowClosed: (callback) => {
    const handler = () => callback();
    ipcRenderer.on('chat:windowClosed', handler);
    return () => ipcRenderer.removeListener('chat:windowClosed', handler);
  },

  // Check if this is the chat window
  isChatWindow: () => window.location.search.includes('chatWindow=1'),

  // File dialog
  openFileDialog: (options) => ipcRenderer.invoke('dialog:openFile', options),

  // Quit the app
  quit: () => ipcRenderer.invoke('app:quit'),

  // Listen for quit confirmation request (from menu Cmd+Q). The ack tells the
  // main process a live renderer took the request, which cancels its quit
  // fallback — without it the app would be unquittable whenever the renderer
  // shows something else than the app (server crash, error page).
  onConfirmQuit: (callback) => {
    const handler = () => {
      ipcRenderer.send('app:confirmQuitAck');
      callback();
    };
    ipcRenderer.on('app:confirmQuit', handler);
    return () => ipcRenderer.removeListener('app:confirmQuit', handler);
  }
});


