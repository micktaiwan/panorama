// Suppress Electron security warnings only during development
if (process.env.NODE_ENV !== 'production') {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
}
const { app, BrowserWindow, nativeImage, Menu, screen, shell, ipcMain, Notification, globalShortcut } = require('electron');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const path = require('path');
const fs = require('fs');

function getWindowStateFilePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function loadWindowState() {
  try {
    const filePath = getWindowStateFilePath();
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      return data;
    }
  } catch (error) {
    console.error('[electron] Failed to load window state:', error);
  }
  return null;
}

function saveWindowState(win) {
  try {
    const bounds = win.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const state = {
      bounds,
      isMaximized: win.isMaximized(),
      isFullScreen: win.isFullScreen(),
      displayId: display?.id
    };
    fs.writeFileSync(getWindowStateFilePath(), JSON.stringify(state, null, 2), 'utf-8');
  } catch (error) {
    console.error('[electron] Failed to save window state:', error);
  }
}

function isRectWithin(container, rect) {
  return (
    rect.x >= container.x &&
    rect.y >= container.y &&
    rect.x + rect.width <= container.x + container.width &&
    rect.y + rect.height <= container.y + container.height
  );
}

function clampBoundsToWorkArea(bounds, workArea) {
  const width = Math.min(bounds.width, workArea.width);
  const height = Math.min(bounds.height, workArea.height);
  const maxX = workArea.x + workArea.width - width;
  const maxY = workArea.y + workArea.height - height;
  const x = Math.max(workArea.x, Math.min(bounds.x, maxX));
  const y = Math.max(workArea.y, Math.min(bounds.y, maxY));
  return { x, y, width, height };
}

function validateBounds(savedState) {
  if (!savedState?.bounds) return null;
  const savedBounds = savedState.bounds;
  const displays = screen.getAllDisplays();
  const targetDisplay =
    (savedState.displayId && displays.find((d) => d.id === savedState.displayId)) ||
    screen.getDisplayMatching(savedBounds) ||
    screen.getPrimaryDisplay();

  // If saved bounds are still fully visible on any display, keep them
  const anyVisible = displays.some((d) => isRectWithin(d.workArea, savedBounds));
  if (anyVisible) return savedBounds;

  // Otherwise, clamp the saved bounds to the target display's work area
  return clampBoundsToWorkArea(savedBounds, targetDisplay.workArea);
}

function showLoadingWindow(parent) {
  const loading = new BrowserWindow({
    width: 360,
    height: 140,
    resizable: false,
    minimizable: false,
    maximizable: false,
    parent,
    modal: true,
    show: true,
    title: 'Loading...',
    webPreferences: { sandbox: true }
  });
  const html = `<!doctype html><html><head><meta charset="utf-8" />
  <title>Loading</title>
  <style>body{margin:0;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,Ubuntu,Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;background:#fff;color:#333} .spinner{width:22px;height:22px;border:3px solid #eee;border-top-color:#999;border-radius:50%;animation:spin 1s linear infinite;margin-right:10px}@keyframes spin{to{transform:rotate(360deg)}}</style></head>
  <body><div class="spinner"></div><div>Loading...</div></body></html>`;
  loading.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
  return loading;
}

function handleFileDownloadAndOpen(win, url) {
  const loading = showLoadingWindow(win);
  const ses = win.webContents.session;
  const closeLoading = () => { if (!loading.isDestroyed()) loading.close(); };
  ses.once('will-download', (event, item) => {
    const filename = item.getFilename();
    const savePath = path.join(app.getPath('downloads'), filename);
    item.setSavePath(savePath);
    item.once('done', (_evt, state) => {
      closeLoading();
      if (state === 'completed') {
        shell.openPath(savePath);
      }
    });
  });
  win.webContents.downloadURL(url);
}

function createWindow(savedState) {
  const windowOptions = {
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  };

  const validated = validateBounds(savedState);
  if (validated) {
    const { x, y, width, height } = validated;
    if (Number.isFinite(x) && Number.isFinite(y)) {
      windowOptions.x = x;
      windowOptions.y = y;
    }
    if (Number.isFinite(width) && Number.isFinite(height)) {
      windowOptions.width = width;
      windowOptions.height = height;
    }
  }

  if (process.platform !== 'darwin') {
    const iconFileName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
    windowOptions.icon = path.join(__dirname, 'assets', iconFileName);
  }

  const win = new BrowserWindow(windowOptions);
  win.loadURL('http://localhost:3000');

  // Intercept popups/new windows to handle app file links gracefully
  win.webContents.setWindowOpenHandler(({ url }) => {
    const isAppFile = /\/files\//.test(url);
    if (isAppFile) {
      handleFileDownloadAndOpen(win, url);
      return { action: 'deny' };
    }
    const isHttpUrl = /^https?:\/\//i.test(url);
    if (isHttpUrl) {
      // Open external http(s) links in the user's default browser
      shell.openExternal(url);
      return { action: 'deny' };
    }
    // Deny creating new Electron windows by default
    return { action: 'deny' };
  });

  if (savedState) {
    if (savedState.isFullScreen) {
      win.setFullScreen(true);
    } else if (savedState.isMaximized) {
      win.maximize();
    }
  }

  let saveTimer = null;
  const queueSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveWindowState(win), 200);
  };
  win.on('resize', queueSave);
  win.on('move', queueSave);
  win.on('maximize', queueSave);
  win.on('unmaximize', queueSave);
  win.on('enter-full-screen', queueSave);
  win.on('leave-full-screen', queueSave);
  win.on('close', () => saveWindowState(win));
}

app.whenReady().then(() => {
  app.setName('Panorama');

  // Configure custom About panel (macOS)
  if (process.platform === 'darwin') {
    const aboutIconPath = path.join(__dirname, 'assets', 'icon.icns');
    app.setAboutPanelOptions({
      applicationName: 'Panorama',
      applicationVersion: app.getVersion(),
      version: `Electron ${process.versions.electron}`,
      credits: 'Panorama — Personal knowledge, notes, tasks and reporting toolkit.',
      iconPath: aboutIconPath,
      copyright: '© 2025 Panorama'
    });
  }

  const isMac = process.platform === 'darwin';
  const savedWindowState = loadWindowState();
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'services' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' }
            ]
          }
        ]
      : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        ...(isMac
          ? [{ role: 'pasteAndMatchStyle' }, { role: 'delete' }, { role: 'selectAll' }]
          : [{ role: 'delete' }, { type: 'separator' }, { role: 'selectAll' }])
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Back',
          accelerator: 'CmdOrCtrl+Left',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            const wc = win?.webContents;
            const nh = wc?.navigationHistory;
            if (nh?.canGoBack()) {
              nh.goBack();
            }
          }
        },
        {
          label: 'Forward',
          accelerator: 'CmdOrCtrl+Right',
          click: () => {
            const win = BrowserWindow.getFocusedWindow();
            const wc = win?.webContents;
            const nh = wc?.navigationHistory;
            if (nh?.canGoForward()) {
              nh.goForward();
            }
          }
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom', accelerator: 'CmdOrCtrl+Shift+0' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen', accelerator: 'CmdOrCtrl+Shift+9' }
      ]
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' },
        ...(isMac
          ? [{ role: 'zoom' }, { type: 'separator' }, { role: 'front' }, { type: 'separator' }, { role: 'window' }]
          : [{ role: 'close' }])
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
  if (process.platform === 'darwin') {
    const icnsPath = path.join(__dirname, 'assets', 'icon.icns');
    const pngPath = path.join(__dirname, 'assets', 'icon.png');
    let dockIcon = nativeImage.createFromPath(icnsPath);
    if (dockIcon.isEmpty()) {
      console.error(`[electron] icon.icns not usable at: ${icnsPath}. Falling back to PNG.`);
      dockIcon = nativeImage.createFromPath(pngPath);
    }
    if (!dockIcon.isEmpty()) {
      app.dock.setIcon(dockIcon);
    } else {
      console.error('[electron] No valid Dock icon found (icns/png).');
    }
  }
  createWindow(savedWindowState);

  // Register macOS global shortcut to focus/open Panorama
  if (process.platform === 'darwin') {
    const accelerator = 'CommandOrControl+Shift+P';
    const wasRegistered = globalShortcut.isRegistered(accelerator);
    const handler = () => {
      let win = BrowserWindow.getAllWindows()[0];
      if (!win) {
        createWindow(loadWindowState());
        win = BrowserWindow.getAllWindows()[0];
      }
      if (win) {
        if (win.isMinimized()) win.restore();
        win.show();
        win.focus();
      }
    };
    const success = globalShortcut.register(accelerator, handler);
    const nowRegistered = globalShortcut.isRegistered(accelerator);
    if (!success || !nowRegistered) {
      console.error(`[electron] Failed to register global shortcut ${accelerator}`);
      if (Notification.isSupported()) {
        new Notification({
          title: 'Panorama',
          body: "Impossible d'activer Cmd-Shift-P: déjà utilisé par une autre app."
        }).show();
      }
    } else if (wasRegistered) {
      if (Notification.isSupported()) {
        new Notification({
          title: 'Panorama',
          body: 'Raccourci Cmd-Shift-P mis à jour.'
        }).show();
      }
    }
  }
});

ipcMain.handle('view:resetZoom', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.webContents.setZoomLevel(0);
});

ipcMain.handle('view:toggleFullscreen', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.setFullScreen(!win.isFullScreen());
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on('will-quit', () => {
  // Unregister all global shortcuts
  globalShortcut.unregisterAll();
});

ipcMain.handle('app:notify', (_event, { title, body }) => {
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body });
  n.on('click', () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) { win.show(); win.focus(); }
  });
  n.show();
});

ipcMain.handle('app:focusMain', () => {
  const win = BrowserWindow.getAllWindows()[0];
  if (win) { win.show(); win.focus(); }
});


