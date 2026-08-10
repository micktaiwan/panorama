// Suppress Electron security warnings only during development
if (process.env.NODE_ENV !== 'production') {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = 'true';
}
const { app, BrowserWindow, nativeImage, Menu, screen, shell, ipcMain, Notification, globalShortcut, dialog } = require('electron');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
const path = require('path');
const fs = require('fs');
const http = require('http');

const SPLASH_HTML = `<!doctype html><html><head><meta charset="utf-8" />
<title>Panorama</title>
<style>
  :root {
    color-scheme: light dark;
    --bg: #0e1014;
    --glow: rgba(106,169,255,0.16);
    --text: #eef1f6;
    --muted: #7c8496;
    --accent: #6aa9ff;
    --accent-soft: #a9c9ff;
    --track: rgba(255,255,255,0.08);
    --ridge-far: rgba(106,169,255,0.13);
    --ridge-mid: rgba(106,169,255,0.20);
    --ridge-near: rgba(10,14,22,0.85);
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg: #f7f8fa;
      --glow: rgba(37,99,235,0.10);
      --text: #171a20;
      --muted: #6b7280;
      --accent: #2563eb;
      --accent-soft: #7aa2f7;
      --track: rgba(0,0,0,0.08);
      --ridge-far: rgba(37,99,235,0.12);
      --ridge-mid: rgba(37,99,235,0.18);
      --ridge-near: rgba(37,99,235,0.30);
    }
  }
  html, body { margin: 0; height: 100%; overflow: hidden; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Ubuntu, Helvetica, Arial, sans-serif;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    height: 100vh;
    background: var(--bg); color: var(--text);
    -webkit-user-select: none; user-select: none;
  }
  /* Night sky: three star layers twinkling out of phase, plus a rare shooting star */
  .sky {
    position: fixed; inset: 0; pointer-events: none; overflow: hidden;
    -webkit-mask-image: linear-gradient(to bottom, #000 40%, transparent 76%);
    mask-image: linear-gradient(to bottom, #000 40%, transparent 76%);
  }
  .stars { position: absolute; top: 0; left: 0; border-radius: 50%; animation: twinkle ease-in-out infinite; }
  .s1 { width: 1px; height: 1px; animation-duration: 4.1s; box-shadow: 1114px 140px 0 0 rgba(255,255,255,0.4), 1693px 382px 0 0 rgba(190,214,255,0.5), 294px 531px 0 0 rgba(190,214,255,0.5), 1407px 425px 0 0 rgba(255,255,255,0.4), 1350px 79px 0 0 rgba(255,255,255,0.4), 397px 88px 0 0 rgba(190,214,255,0.5), 1481px 502px 0 0 rgba(255,255,255,0.55), 800px 419px 0 0 rgba(255,255,255,0.4), 475px 178px 0 0 rgba(190,214,255,0.5), 1480px 209px 0 0 rgba(255,255,255,0.4), 1394px 69px 0 0 rgba(255,255,255,0.55), 540px 183px 0 0 rgba(255,255,255,0.4), 1654px 240px 0 0 rgba(190,214,255,0.5), 383px 220px 0 0 rgba(190,214,255,0.5), 1392px 142px 0 0 rgba(255,255,255,0.4), 1439px 397px 0 0 rgba(255,255,255,0.55), 1002px 31px 0 0 rgba(190,214,255,0.5), 679px 397px 0 0 rgba(255,255,255,0.55), 650px 197px 0 0 rgba(255,255,255,0.4), 1605px 216px 0 0 rgba(255,255,255,0.55), 428px 50px 0 0 rgba(190,214,255,0.5), 9px 130px 0 0 rgba(255,255,255,0.55), 710px 92px 0 0 rgba(190,214,255,0.5), 815px 286px 0 0 rgba(190,214,255,0.5), 1043px 397px 0 0 rgba(255,255,255,0.55), 942px 228px 0 0 rgba(255,255,255,0.4), 1128px 133px 0 0 rgba(255,255,255,0.4), 1622px 84px 0 0 rgba(255,255,255,0.4), 1541px 334px 0 0 rgba(255,255,255,0.55), 1088px 361px 0 0 rgba(255,255,255,0.4), 1368px 387px 0 0 rgba(255,255,255,0.55), 1348px 616px 0 0 rgba(255,255,255,0.4), 324px 306px 0 0 rgba(190,214,255,0.5), 1466px 309px 0 0 rgba(190,214,255,0.5), 147px 569px 0 0 rgba(255,255,255,0.55), 414px 231px 0 0 rgba(190,214,255,0.5), 527px 514px 0 0 rgba(255,255,255,0.55), 1368px 203px 0 0 rgba(255,255,255,0.4), 15px 151px 0 0 rgba(190,214,255,0.5), 1405px 465px 0 0 rgba(190,214,255,0.5), 1006px 513px 0 0 rgba(255,255,255,0.55), 10px 112px 0 0 rgba(255,255,255,0.4), 1100px 387px 0 0 rgba(190,214,255,0.5), 830px 366px 0 0 rgba(190,214,255,0.5), 1160px 49px 0 0 rgba(255,255,255,0.4), 362px 380px 0 0 rgba(255,255,255,0.4), 545px 386px 0 0 rgba(255,255,255,0.4), 640px 107px 0 0 rgba(255,255,255,0.55), 202px 289px 0 0 rgba(190,214,255,0.5), 1191px 273px 0 0 rgba(190,214,255,0.5), 1360px 149px 0 0 rgba(255,255,255,0.4), 814px 51px 0 0 rgba(190,214,255,0.5), 586px 1px 0 0 rgba(255,255,255,0.4), 663px 33px 0 0 rgba(255,255,255,0.55), 207px 45px 0 0 rgba(190,214,255,0.5), 1208px 399px 0 0 rgba(255,255,255,0.4), 372px 242px 0 0 rgba(190,214,255,0.5), 533px 33px 0 0 rgba(190,214,255,0.5), 605px 607px 0 0 rgba(255,255,255,0.55), 424px 315px 0 0 rgba(190,214,255,0.5), 431px 420px 0 0 rgba(255,255,255,0.55), 1392px 130px 0 0 rgba(255,255,255,0.4), 1237px 277px 0 0 rgba(190,214,255,0.5), 1162px 122px 0 0 rgba(255,255,255,0.55), 1308px 8px 0 0 rgba(255,255,255,0.55), 839px 237px 0 0 rgba(255,255,255,0.4), 1187px 346px 0 0 rgba(255,255,255,0.4), 588px 218px 0 0 rgba(255,255,255,0.4), 1004px 145px 0 0 rgba(190,214,255,0.5), 1583px 338px 0 0 rgba(255,255,255,0.4); }
  .s2 { width: 2px; height: 2px; animation-duration: 5.7s; animation-delay: -1.9s; box-shadow: 1505px 109px 0 0 rgba(255,255,255,0.85), 686px 178px 0 0 rgba(255,246,224,0.75), 1659px 8px 0 0 rgba(200,222,255,0.8), 643px 62px 0 0 rgba(255,246,224,0.75), 501px 528px 0 0 rgba(255,246,224,0.75), 1685px 413px 0 0 rgba(200,222,255,0.8), 1138px 488px 0 0 rgba(255,255,255,0.85), 1332px 295px 0 0 rgba(200,222,255,0.8), 952px 26px 0 0 rgba(255,246,224,0.75), 1267px 6px 0 0 rgba(200,222,255,0.8), 490px 439px 0 0 rgba(255,246,224,0.75), 1617px 251px 0 0 rgba(255,246,224,0.75), 343px 41px 0 0 rgba(255,255,255,0.85), 1545px 423px 0 0 rgba(255,255,255,0.85), 549px 463px 0 0 rgba(255,246,224,0.75), 1185px 361px 0 0 rgba(255,255,255,0.85), 1411px 439px 0 0 rgba(255,246,224,0.75), 383px 54px 0 0 rgba(255,255,255,0.85), 416px 148px 0 0 rgba(200,222,255,0.8), 841px 18px 0 0 rgba(255,255,255,0.85), 1063px 495px 0 0 rgba(255,255,255,0.85), 71px 100px 0 0 rgba(255,246,224,0.75), 848px 319px 0 0 rgba(200,222,255,0.8), 196px 430px 0 0 rgba(200,222,255,0.8), 1087px 310px 0 0 rgba(255,255,255,0.85), 199px 288px 0 0 rgba(200,222,255,0.8), 1319px 191px 0 0 rgba(255,255,255,0.85), 1685px 421px 0 0 rgba(255,246,224,0.75), 399px 73px 0 0 rgba(255,246,224,0.75), 1579px 182px 0 0 rgba(200,222,255,0.8), 1651px 342px 0 0 rgba(200,222,255,0.8), 1166px 253px 0 0 rgba(200,222,255,0.8), 1192px 370px 0 0 rgba(255,255,255,0.85), 444px 13px 0 0 rgba(255,255,255,0.85); }
  .s3 { width: 3px; height: 3px; animation-duration: 7.3s; animation-delay: -3.4s; box-shadow: 1451px 199px 0 0 rgba(255,255,255,0.95), 7px 28px 0 0 rgba(174,205,255,0.9), 1366px 246px 0 0 rgba(174,205,255,0.9), 1348px 319px 0 0 rgba(174,205,255,0.9), 1671px 279px 0 0 rgba(174,205,255,0.9), 227px 360px 0 0 rgba(255,255,255,0.95), 1134px 200px 0 0 rgba(174,205,255,0.9), 789px 7px 0 0 rgba(174,205,255,0.9), 203px 46px 0 0 rgba(174,205,255,0.9), 686px 174px 0 0 rgba(255,255,255,0.95), 1572px 171px 0 0 rgba(174,205,255,0.9), 1669px 356px 0 0 rgba(174,205,255,0.9), 646px 72px 0 0 rgba(174,205,255,0.9), 97px 5px 0 0 rgba(174,205,255,0.9), 703px 398px 0 0 rgba(174,205,255,0.9), 447px 45px 0 0 rgba(255,255,255,0.95); }
  @keyframes twinkle { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }
  .shooting {
    position: absolute; top: 14%; left: -12%;
    width: 120px; height: 1px;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.8));
    opacity: 0;
    animation: shoot 13s ease-in infinite;
  }
  @keyframes shoot {
    0%   { transform: translate(0, 0) rotate(16deg); opacity: 0; }
    3%   { opacity: 1; }
    13%  { transform: translate(78vw, 24vh) rotate(16deg); opacity: 0; }
    100% { transform: translate(78vw, 24vh) rotate(16deg); opacity: 0; }
  }
  /* Daytime panorama: no stars in light theme */
  @media (prefers-color-scheme: light) { .sky { display: none; } }
  /* Soft light pooling behind the wordmark */
  .halo {
    position: fixed; left: 50%; top: 42%; width: 720px; height: 720px;
    transform: translate(-50%, -50%);
    background: radial-gradient(circle, var(--glow) 0%, transparent 62%);
    animation: breathe 5s ease-in-out infinite;
    pointer-events: none;
  }
  @keyframes breathe {
    0%, 100% { opacity: 0.75; transform: translate(-50%, -50%) scale(1); }
    50%      { opacity: 1;    transform: translate(-50%, -50%) scale(1.08); }
  }
  .stage {
    position: relative; z-index: 1;
    display: flex; flex-direction: column; align-items: center;
    animation: rise 700ms cubic-bezier(0.22, 1, 0.36, 1) both;
  }
  @keyframes rise {
    from { opacity: 0; transform: translateY(10px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .logo {
    font-size: 30px; font-weight: 650; letter-spacing: 1.5px;
    background: linear-gradient(100deg, var(--text) 20%, var(--accent-soft) 44%, var(--accent) 52%, var(--text) 76%);
    background-size: 260% 100%;
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent; color: transparent;
    animation: sweep 3.6s ease-in-out infinite;
  }
  @keyframes sweep {
    0%   { background-position: 130% 0; }
    55%  { background-position: -30% 0; }
    100% { background-position: -30% 0; }
  }
  /* Indeterminate progress: a light travelling along a hairline track */
  .track {
    position: relative; margin-top: 30px;
    width: 190px; height: 2px; border-radius: 2px;
    background: var(--track); overflow: hidden;
  }
  .track::after {
    content: ""; position: absolute; inset: 0; width: 42%;
    border-radius: 2px;
    background: linear-gradient(90deg, transparent, var(--accent), transparent);
    animation: travel 1.5s cubic-bezier(0.65, 0, 0.35, 1) infinite;
  }
  @keyframes travel {
    0%   { transform: translateX(-110%); }
    100% { transform: translateX(340%); }
  }
  .status {
    margin-top: 18px; font-size: 12.5px; letter-spacing: 0.2px;
    color: var(--muted); min-height: 1.2em;
  }
  .dots span { animation: blink 1.4s infinite; }
  .dots span:nth-child(2) { animation-delay: 0.2s; }
  .dots span:nth-child(3) { animation-delay: 0.4s; }
  @keyframes blink { 0%, 60%, 100% { opacity: 0.25; } 30% { opacity: 1; } }
  /* The panorama itself: three ridges drifting at their own pace */
  .horizon {
    position: fixed; left: 0; right: 0; bottom: 0; height: 34vh; min-height: 130px;
    pointer-events: none; overflow: hidden;
    -webkit-mask-image: linear-gradient(to bottom, transparent, #000 45%);
    mask-image: linear-gradient(to bottom, transparent, #000 45%);
  }
  .horizon svg { position: absolute; bottom: 0; width: 100%; height: 100%; }
  .ridge { animation: drift linear infinite; }
  .ridge-far  { fill: var(--ridge-far);  animation-duration: 150s; }
  .ridge-mid  { fill: var(--ridge-mid);  animation-duration: 90s; }
  .ridge-near { fill: var(--ridge-near); animation-duration: 55s; }
  @keyframes drift { to { transform: translateX(-400px); } }
  @media (prefers-reduced-motion: reduce) {
    .halo, .logo, .ridge, .dots span, .stage, .stars { animation: none; }
    .shooting { display: none; }
    .logo { -webkit-text-fill-color: var(--text); color: var(--text); }
    .track::after { animation-duration: 2.4s; }
  }
</style></head>
<body>
  <div class="sky">
    <div class="stars s1"></div>
    <div class="stars s2"></div>
    <div class="stars s3"></div>
    <div class="shooting"></div>
  </div>
  <div class="halo"></div>
  <div class="stage">
    <div class="logo">Panorama</div>
    <div class="track"></div>
    <div class="status" id="status">Starting Meteor server<span class="dots"><span>.</span><span>.</span><span>.</span></span></div>
  </div>
  <div class="horizon">
    <svg viewBox="0 0 800 120" preserveAspectRatio="none" aria-hidden="true">
      <path class="ridge ridge-far" d="M0,70 L50,55 L100,62 L150,40 L200,58 L250,48 L300,66 L350,52 L400,70 L450,55 L500,62 L550,40 L600,58 L650,48 L700,66 L750,52 L800,70 L850,55 L900,62 L950,40 L1000,58 L1050,48 L1100,66 L1150,52 L1200,70 L1250,55 L1300,62 L1350,40 L1400,58 L1450,48 L1500,66 L1550,52 L1600,70 L1600,120 L0,120 Z" />
      <path class="ridge ridge-mid" d="M0,86 L50,58 L100,74 L150,46 L200,68 L250,52 L300,80 L350,54 L400,86 L450,58 L500,74 L550,46 L600,68 L650,52 L700,80 L750,54 L800,86 L850,58 L900,74 L950,46 L1000,68 L1050,52 L1100,80 L1150,54 L1200,86 L1250,58 L1300,74 L1350,46 L1400,68 L1450,52 L1500,80 L1550,54 L1600,86 L1600,120 L0,120 Z" />
      <path class="ridge ridge-near" d="M0,104 L50,80 L100,94 L150,68 L200,98 L250,74 L300,90 L350,72 L400,104 L450,80 L500,94 L550,68 L600,98 L650,74 L700,90 L750,72 L800,104 L850,80 L900,94 L950,68 L1000,98 L1050,74 L1100,90 L1150,72 L1200,104 L1250,80 L1300,94 L1350,68 L1400,98 L1450,74 L1500,90 L1550,72 L1600,104 L1600,120 L0,120 Z" />
    </svg>
  </div>
</body></html>`;

function waitForMeteor(url, win) {
  return new Promise((resolve) => {
    const tick = () => {
      if (win.isDestroyed()) return;
      // One attempt must schedule at most one retry: req.destroy() (on timeout)
      // also fires 'error', which without this guard doubles the polling loops
      // exponentially until the main process OOMs.
      let settled = false;
      const retry = () => {
        if (settled) return;
        settled = true;
        setTimeout(tick, 500);
      };
      const req = http.get(url, (res) => {
        res.destroy();
        if (res.statusCode && res.statusCode < 500) {
          settled = true;
          resolve();
        } else {
          retry();
        }
      });
      req.on('error', retry);
      req.setTimeout(2000, () => { req.destroy(); retry(); });
    };
    tick();
  });
}

function getWindowStateFilePath() {
  return path.join(app.getPath('userData'), 'window-state.json');
}

function getChatWindowStateFilePath() {
  return path.join(app.getPath('userData'), 'chat-window-state.json');
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

function loadChatWindowState() {
  try {
    const filePath = getChatWindowStateFilePath();
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(raw);
    }
  } catch (error) {
    console.error('[electron] Failed to load chat window state:', error);
  }
  return null;
}

function saveChatWindowState(win) {
  try {
    const bounds = win.getBounds();
    const display = screen.getDisplayMatching(bounds);
    const state = {
      bounds,
      displayId: display?.id
    };
    fs.writeFileSync(getChatWindowStateFilePath(), JSON.stringify(state, null, 2), 'utf-8');
  } catch (error) {
    console.error('[electron] Failed to save chat window state:', error);
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

// Chat window management
let chatWindow = null;
let mainWindow = null;

function getMainWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  // Fallback: find window that's not the chat window
  const allWindows = BrowserWindow.getAllWindows();
  return allWindows.find((w) => w !== chatWindow && !w.isDestroyed()) || null;
}

function createChatWindow() {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.focus();
    return;
  }

  const savedState = loadChatWindowState();
  const windowOptions = {
    width: 420,
    height: 600,
    minWidth: 300,
    minHeight: 400,
    title: 'Panorama Chat',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  };

  // Restore position/size from saved state
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

  chatWindow = new BrowserWindow(windowOptions);
  const port = process.env.METEOR_PORT || 3000;
  const chatUrl = `http://localhost:${port}?chatWindow=1`;
  chatWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(SPLASH_HTML));
  waitForMeteor(`http://localhost:${port}`, chatWindow).then(() => {
    if (chatWindow && !chatWindow.isDestroyed()) chatWindow.loadURL(chatUrl);
  });

  // Save state on move/resize
  let saveTimer = null;
  const queueSave = () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if (chatWindow && !chatWindow.isDestroyed()) {
        saveChatWindowState(chatWindow);
      }
    }, 200);
  };
  chatWindow.on('resize', queueSave);
  chatWindow.on('move', queueSave);

  // Handle close event - notify main window
  chatWindow.on('closed', () => {
    chatWindow = null;
    const main = getMainWindow();
    if (main && !main.isDestroyed()) {
      main.webContents.send('chat:windowClosed');
    }
  });

  // Save state before close
  chatWindow.on('close', () => {
    if (chatWindow && !chatWindow.isDestroyed()) {
      saveChatWindowState(chatWindow);
    }
  });
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
  mainWindow = win; // Track main window reference
  const port = process.env.METEOR_PORT || 3000;
  const meteorUrl = `http://localhost:${port}`;

  // Show splash immediately, then swap to Meteor URL once the server responds.
  // This makes the window appear instantly instead of waiting for Meteor's
  // (slow) startup against the remote MongoDB.
  win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(SPLASH_HTML));
  waitForMeteor(meteorUrl, win).then(() => {
    if (!win.isDestroyed()) win.loadURL(meteorUrl);
  });

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

// Quitting goes through the renderer so the app can show its confirmation modal.
// But the renderer is not always the app: on a server crash it shows the Meteor
// error page, which listens to nothing — the request then falls in the void and
// the app becomes impossible to quit. So the confirmation is asked for, never
// trusted: without an acknowledgement from a live renderer, quit outright.
const QUIT_ACK_TIMEOUT_MS = 1000;
let quitAckTimer = null;

function requestQuitConfirmation(win) {
  if (quitAckTimer) clearTimeout(quitAckTimer);
  quitAckTimer = setTimeout(() => {
    quitAckTimer = null;
    app.quit();
  }, QUIT_ACK_TIMEOUT_MS);
  win.webContents.send('app:confirmQuit');
}

// Sent by preload as soon as the app's quit handler receives the request, which
// proves the renderer is alive and will decide itself whether to quit.
ipcMain.on('app:confirmQuitAck', () => {
  if (!quitAckTimer) return;
  clearTimeout(quitAckTimer);
  quitAckTimer = null;
});

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
              {
                label: 'Quit',
                accelerator: 'CmdOrCtrl+Q',
                click: () => {
                  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0];
                  if (win) {
                    requestQuitConfirmation(win);
                  } else {
                    app.quit();
                  }
                }
              }
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
    const pngPath = path.join(__dirname, 'assets', 'icon.png');
    const dockIcon = nativeImage.createFromPath(pngPath);
    if (!dockIcon.isEmpty()) {
      app.dock.setIcon(dockIcon);
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

ipcMain.handle('view:setSimpleFullscreen', (_event, enabled) => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.setSimpleFullScreen(enabled);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow(loadWindowState());
});

app.on('will-quit', () => {
  // Unregister all global shortcuts
  globalShortcut.unregisterAll();
});

ipcMain.handle('app:quit', () => {
  app.quit();
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

// Chat window IPC handlers
ipcMain.handle('chat:openWindow', () => {
  createChatWindow();
});

ipcMain.handle('chat:closeWindow', () => {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.close();
  }
});

ipcMain.handle('chat:focusWindow', () => {
  if (chatWindow && !chatWindow.isDestroyed()) {
    chatWindow.focus();
  }
});

ipcMain.handle('chat:isWindowOpen', () => {
  return chatWindow !== null && !chatWindow.isDestroyed();
});

// File dialog
ipcMain.handle('dialog:openFile', async (_event, options = {}) => {
  const win = BrowserWindow.getFocusedWindow() || getMainWindow();
  let defaultPath = options.defaultPath || app.getPath('home');
  // Expand tilde
  if (defaultPath === '~' || defaultPath.startsWith('~/')) {
    defaultPath = path.join(app.getPath('home'), defaultPath.slice(1));
  }
  const result = await dialog.showOpenDialog(win, {
    title: 'Open File',
    defaultPath,
    properties: ['openFile'],
    filters: [
      { name: 'Text Files', extensions: ['md', 'txt', 'js', 'jsx', 'ts', 'tsx', 'json', 'css', 'html', 'yaml', 'yml', 'toml', 'py', 'rb', 'go', 'rs', 'sh', 'sql', 'vue', 'svelte', 'csv', 'log', 'prisma', 'proto', 'xml'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });
  if (result.canceled || result.filePaths.length === 0) return null;
  return result.filePaths[0];
});


