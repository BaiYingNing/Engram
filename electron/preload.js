const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("engramAPI", {
  getAppInfo: () => ipcRenderer.invoke("engram:get-app-info"),
  getStats: () => ipcRenderer.invoke("engram:get-stats"),
  getStudyActivity: () => ipcRenderer.invoke("engram:get-study-activity"),
  getTodayTasks: (limit) => ipcRenderer.invoke("engram:get-today-tasks", limit),
  getDueProjection: (days) => ipcRenderer.invoke("engram:get-due-projection", days),
  listBooks: () => ipcRenderer.invoke("engram:list-books"),
  getCurrentBook: () => ipcRenderer.invoke("engram:get-current-book"),
  switchBook: (bookKey) => ipcRenderer.invoke("engram:switch-book", bookKey),
  getAboutContent: () => ipcRenderer.invoke("engram:get-about-content"),
  getGuideContent: () => ipcRenderer.invoke("engram:get-guide-content"),
  getWindowState: () => ipcRenderer.invoke("engram:get-window-state"),
  showWindow: () => ipcRenderer.invoke("engram:show-window"),
  toggleFullScreen: () => ipcRenderer.invoke("engram:toggle-fullscreen"),
  exportData: () => ipcRenderer.invoke("engram:export-data"),
  importData: () => ipcRenderer.invoke("engram:import-data"),
  onWindowStateChange: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on("engram:window-state", listener);
    return () => ipcRenderer.removeListener("engram:window-state", listener);
  },
  updateStatus: (wordId, action, replaceReviewLogId = null) => ipcRenderer.invoke("engram:update-status", {
    wordId,
    action,
    replaceReviewLogId
  })
});
