const { app, BrowserWindow, nativeImage, Menu, screen } = require('electron');
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
    console.warn('[electron] Failed to load window state:', error);
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
      displayId: display ? display.id : undefined
    };
    fs.writeFileSync(getWindowStateFilePath(), JSON.stringify(state, null, 2), 'utf-8');
  } catch (error) {
    console.warn('[electron] Failed to save window state:', error);
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
  if (!savedState || !savedState.bounds) return null;
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
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
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
      console.warn(`[electron] icon.icns not usable at: ${icnsPath}. Falling back to PNG.`);
      dockIcon = nativeImage.createFromPath(pngPath);
    }
    if (!dockIcon.isEmpty()) {
      app.dock.setIcon(dockIcon);
      console.log('[electron] Dock icon set successfully.');
    } else {
      console.warn('[electron] No valid Dock icon found (icns/png).');
    }
  }
  createWindow(savedWindowState);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});


