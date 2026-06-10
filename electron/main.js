const fs = require("node:fs");
const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain } = require("electron");

const { createStore } = require("./store");

app.commandLine.appendSwitch("autoplay-policy", "no-user-gesture-required");

let mainWindow = null;
let store = null;

function resolveWindowStatePath() {
  return path.join(app.getPath("userData"), "window-state.json");
}

function resolveAppRoot() {
  return app.getAppPath();
}

function resolveDataDir() {
  return path.join(resolveAppRoot(), "data");
}

function resolveDatabasePath() {
  if (app.isPackaged) {
    return path.join(app.getPath("userData"), "engram.db");
  }
  return path.join(resolveAppRoot(), "engram.db");
}

function resolveAboutPath() {
  return path.join(resolveAppRoot(), "docs", "about.md");
}

function resolveGuidePath() {
  return path.join(resolveAppRoot(), "docs", "guide.md");
}

function resolveBackupDir() {
  return path.join(app.getPath("documents"), "Engram Backups");
}

function loadWindowState() {
  const defaults = {
    width: 1320,
    height: 920,
    isMaximized: false,
    isFullScreen: false
  };

  try {
    const raw = fs.readFileSync(resolveWindowStatePath(), "utf8");
    const parsed = JSON.parse(raw);
    return {
      ...defaults,
      ...parsed
    };
  } catch {
    return defaults;
  }
}

function saveWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  const bounds = mainWindow.isMaximized() || mainWindow.isFullScreen()
    ? mainWindow.getNormalBounds()
    : mainWindow.getBounds();

  const payload = {
    ...bounds,
    isMaximized: mainWindow.isMaximized(),
    isFullScreen: mainWindow.isFullScreen()
  };

  fs.mkdirSync(path.dirname(resolveWindowStatePath()), { recursive: true });
  fs.writeFileSync(resolveWindowStatePath(), JSON.stringify(payload, null, 2), "utf8");
}

function emitWindowState() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    return;
  }

  mainWindow.webContents.send("engram:window-state", {
    isFullScreen: mainWindow.isFullScreen()
  });
}

function setupIpc() {
  ipcMain.handle("engram:get-stats", (_event, dayStartHour) => store.getStats(dayStartHour));
  ipcMain.handle("engram:get-study-activity", (_event, dayStartHour) => store.getStudyActivity(dayStartHour));
  ipcMain.handle("engram:get-today-tasks", (_event, limit) => store.getTodayTasks(limit));
  ipcMain.handle("engram:get-due-projection", (_event, days, dayStartHour) => store.getDueProjection(days, dayStartHour));
  ipcMain.handle("engram:list-books", () => store.listBooks());
  ipcMain.handle("engram:get-current-book", () => store.getCurrentBook());
  ipcMain.handle("engram:switch-book", (_event, bookKey) => store.switchBook(bookKey));
  ipcMain.handle("engram:get-about-content", () => fs.readFileSync(resolveAboutPath(), "utf8"));
  ipcMain.handle("engram:get-guide-content", () => fs.readFileSync(resolveGuidePath(), "utf8"));
  ipcMain.handle("engram:get-window-state", () => ({
    isFullScreen: Boolean(mainWindow?.isFullScreen()),
    isMaximized: Boolean(mainWindow?.isMaximized())
  }));
  ipcMain.handle("engram:show-window", () => {
    if (!mainWindow) {
      return { ok: false };
    }
    mainWindow.show();
    mainWindow.focus();
    return { ok: true };
  });
  ipcMain.handle("engram:toggle-fullscreen", () => {
    if (!mainWindow) {
      return { isFullScreen: false };
    }

    const nextState = !mainWindow.isFullScreen();
    mainWindow.setFullScreen(nextState);
    return { isFullScreen: nextState };
  });
  ipcMain.handle("engram:update-status", (_event, payload) => {
    try {
      return store.updateStatus(payload.wordId, payload.action, payload.replaceReviewLogId || null);
    } catch (error) {
      dialog.showErrorBox("更新学习状态失败", String(error.message || error));
      throw error;
    }
  });
  ipcMain.handle("engram:export-data", async () => {
    const defaultDir = resolveBackupDir();
    fs.mkdirSync(defaultDir, { recursive: true });
    const timestamp = new Date().toISOString().replace(/:/g, "-").replace(/\..+$/, "");
    const defaultPath = path.join(defaultDir, `engram-backup-${timestamp}.json`);

    const result = await dialog.showSaveDialog(mainWindow, {
      title: "导出学习数据",
      defaultPath,
      filters: [
        { name: "Engram Backup", extensions: ["json"] }
      ]
    });

    if (result.canceled || !result.filePath) {
      return { canceled: true };
    }

    const payload = store.exportData(app.getVersion());
    fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), "utf8");

    return {
      canceled: false,
      filePath: result.filePath
    };
  });
  ipcMain.handle("engram:import-data", async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "导入学习数据",
      properties: ["openFile"],
      filters: [
        { name: "Engram Backup", extensions: ["json"] },
        { name: "JSON", extensions: ["json"] }
      ]
    });

    if (result.canceled || !result.filePaths?.length) {
      return { canceled: true };
    }

    const filePath = result.filePaths[0];
    const raw = fs.readFileSync(filePath, "utf8");
    const payload = JSON.parse(raw);
    const summary = store.importData(payload);

    return {
      canceled: false,
      filePath,
      ...summary
    };
  });
  ipcMain.handle("engram:get-app-info", () => ({
    version: app.getVersion(),
    isPackaged: app.isPackaged
  }));
}

function createMainWindow() {
  const windowState = loadWindowState();
  mainWindow = new BrowserWindow({
    width: windowState.width,
    height: windowState.height,
    x: Number.isFinite(windowState.x) ? windowState.x : undefined,
    y: Number.isFinite(windowState.y) ? windowState.y : undefined,
    minWidth: 1080,
    minHeight: 760,
    show: false,
    autoHideMenuBar: true,
    title: "Engram",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  mainWindow.loadFile(path.join(resolveAppRoot(), "static", "index.html"));
  mainWindow.webContents.on("did-finish-load", emitWindowState);
  mainWindow.on("enter-full-screen", () => {
    saveWindowState();
    emitWindowState();
  });
  mainWindow.on("leave-full-screen", () => {
    saveWindowState();
    emitWindowState();
  });
  mainWindow.on("maximize", () => {
    saveWindowState();
    emitWindowState();
  });
  mainWindow.on("unmaximize", () => {
    saveWindowState();
    emitWindowState();
  });
  mainWindow.on("move", saveWindowState);
  mainWindow.on("resize", saveWindowState);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });

  if (windowState.isMaximized) {
    mainWindow.maximize();
  }
  if (windowState.isFullScreen) {
    mainWindow.setFullScreen(true);
  }
}

app.whenReady().then(() => {
  store = createStore({
    dbPath: resolveDatabasePath(),
    dataDir: resolveDataDir()
  });

  setupIpc();
  createMainWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createMainWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", () => {
  saveWindowState();
  if (store) {
    store.close();
  }
});
