const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("engramAPI", {
  getAppInfo: () => ipcRenderer.invoke("engram:get-app-info"),
  getStats: () => ipcRenderer.invoke("engram:get-stats"),
  getStudyActivity: () => ipcRenderer.invoke("engram:get-study-activity"),
  getTodayTasks: (limit) => ipcRenderer.invoke("engram:get-today-tasks", limit),
  getDueProjection: (days) => ipcRenderer.invoke("engram:get-due-projection", days),
  getAboutContent: () => ipcRenderer.invoke("engram:get-about-content"),
  getGuideContent: () => ipcRenderer.invoke("engram:get-guide-content"),
  getWindowState: () => ipcRenderer.invoke("engram:get-window-state"),
  showWindow: () => ipcRenderer.invoke("engram:show-window"),
  toggleFullScreen: () => ipcRenderer.invoke("engram:toggle-fullscreen"),
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
