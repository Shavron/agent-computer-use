import { app, BrowserWindow, ipcMain, shell, screen } from 'electron';
import path from 'path';
import { resolveHtmlPath } from './util';
import MenuBuilder from './menu';

let mainWindow: BrowserWindow | null = null;
let fadeInterval: NodeJS.Timeout | null = null;
let showTimeout: NodeJS.Timeout | null = null;

const FADE_STEP = 0.1;
const FADE_INTERVAL = 16;
const SHOW_DELAY = 500;

function executeFade(show: boolean, resolve: () => void) {
  if (!mainWindow) {
    resolve();
    return;
  }

  if (show) {
    mainWindow.setOpacity(0);
    mainWindow.showInactive();
  }

  let opacity = show ? 0 : 1;

  fadeInterval = setInterval(() => {
    if (!mainWindow) {
      if (fadeInterval) clearInterval(fadeInterval);
      resolve();
      return;
    }

    opacity = show ? opacity + FADE_STEP : opacity - FADE_STEP;
    opacity = Math.min(Math.max(opacity, 0), 1);
    mainWindow.setOpacity(opacity);

    if ((show && opacity >= 1) || (!show && opacity <= 0)) {
      if (fadeInterval) clearInterval(fadeInterval);
      if (!show) mainWindow.hide();
      resolve();
    }
  }, FADE_INTERVAL);
}

function fadeWindow(show: boolean, immediate = false): Promise<void> {
  return new Promise((resolve) => {
    if (!mainWindow) {
      resolve();
      return;
    }

    if (fadeInterval) {
      clearInterval(fadeInterval);
    }

    if (!show) {
      if (showTimeout) {
        clearTimeout(showTimeout);
        showTimeout = null;
      }
      executeFade(show, resolve);
      return;
    }

    if (showTimeout) {
      clearTimeout(showTimeout);
    }

    if (immediate) {
      executeFade(show, resolve);
    } else {
      showTimeout = setTimeout(() => {
        executeFade(show, resolve);
      }, SHOW_DELAY);
    }
  });
}

export async function createMainWindow(
  getAssetPath: (...paths: string[]) => string,
): Promise<BrowserWindow> {
  const primaryDisplay = screen.getPrimaryDisplay();
  const { width, height } = primaryDisplay.workAreaSize;

  mainWindow = new BrowserWindow({
    show: false,
    width: 450,
    height: height,
    x: width - 450,
    y: 0,
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    icon: getAssetPath('icon.png'),
    webPreferences: {
      // nodeIntegration: true, // added by abhilash
      // contextIsolation: true, // added by abhilash
      preload: app.isPackaged
        ? path.join(__dirname, 'preload.js')
        : path.join(__dirname, '../../.erb/dll/preload.js'),
    },
  });

  mainWindow.loadURL(resolveHtmlPath('index.html'));

  mainWindow.on('ready-to-show', () => {
    if (!mainWindow) {
      throw new Error('"mainWindow" is not defined');
    }
    if (process.env.START_MINIMIZED) {
      mainWindow.minimize();
    } else {
      // Use immediate=true for initial show
      fadeWindow(true, true);
    }
  });

  mainWindow.on('closed', () => {
    if (fadeInterval) {
      clearInterval(fadeInterval);
    }
    if (showTimeout) {
      clearTimeout(showTimeout);
    }
    mainWindow = null;
  });

  const menuBuilder = new MenuBuilder(mainWindow);
  menuBuilder.buildMenu();

  mainWindow.webContents.setWindowOpenHandler((edata) => {
    shell.openExternal(edata.url);
    return { action: 'deny' };
  });

  ipcMain.handle('minimize-window', () => {
    mainWindow?.minimize();
  });

  ipcMain.handle('maximize-window', () => {
    if (mainWindow?.isMaximized()) {
      mainWindow?.unmaximize();
    } else {
      mainWindow?.maximize();
    }
  });

  ipcMain.handle('close-window', async () => {
    if (mainWindow) {
      await fadeWindow(false);
      mainWindow.close();
    }
  });

  app.on('activate', () => {
    if (mainWindow === null) createMainWindow(getAssetPath);
  });

  return mainWindow;
}

export async function showWindow(show: boolean) {
  if (mainWindow) {
    await fadeWindow(show);
  }
}

export async function hideWindowBlock<T>(
  operation: () => Promise<T> | T,
): Promise<T> {
  try {
    await fadeWindow(false);
    const result = await Promise.resolve(operation());
    return result;
  } finally {
    await fadeWindow(true);
  }
}
