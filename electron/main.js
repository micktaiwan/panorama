const { app, BrowserWindow, nativeImage } = require('electron');
const path = require('path');

function createWindow() {
  const windowOptions = {
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  };

  if (process.platform !== 'darwin') {
    const iconFileName = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
    windowOptions.icon = path.join(__dirname, 'assets', iconFileName);
  }

  const win = new BrowserWindow(windowOptions);
  win.loadURL('http://localhost:3000');
}

app.whenReady().then(() => {
  if (process.platform === 'darwin') {
    const iconPath = path.join(__dirname, 'assets', 'icon.icns');
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) {
      app.dock.setIcon(icon);
    }
  }
  createWindow();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});


