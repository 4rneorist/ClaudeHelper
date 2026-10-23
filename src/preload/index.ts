import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IPC, type ClaudeHelperApi } from '../shared/ipc'

function subscribe<A extends unknown[]>(
  channel: string,
  listener: (...args: A) => void
): () => void {
  const wrapped = (_e: Electron.IpcRendererEvent, ...args: unknown[]): void =>
    listener(...(args as A))
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api: ClaudeHelperApi = {
  appInfo: () => ipcRenderer.invoke(IPC.appInfo),
  startSession: (req) => ipcRenderer.invoke(IPC.sessionStart, req),
  write: (id, data, binary) => ipcRenderer.send(IPC.sessionWrite, id, data, binary === true),
  resize: (id, cols, rows) => ipcRenderer.send(IPC.sessionResize, id, cols, rows),
  kill: (id) => ipcRenderer.invoke(IPC.sessionKill, id),
  onData: (listener) => subscribe(IPC.sessionData, listener),
  onExit: (listener) => subscribe(IPC.sessionExit, listener),
  getSettings: () => ipcRenderer.invoke(IPC.settingsGet),
  updateSettings: (patch) => ipcRenderer.invoke(IPC.settingsUpdate, patch),
  removeRecent: (folder) => ipcRenderer.invoke(IPC.recentRemove, folder),
  setFolderColor: (folder, color) => ipcRenderer.invoke(IPC.folderColorSet, folder, color),
  setFolderTitle: (folder, title) => ipcRenderer.invoke(IPC.folderTitleSet, folder, title),
  setFolderMuted: (folder, muted) => ipcRenderer.invoke(IPC.folderMutedSet, folder, muted),
  openFolder: (folder) => ipcRenderer.send(IPC.openFolder, folder),
  claudeStatus: () => ipcRenderer.invoke(IPC.claudeStatus),
  pickFolder: () => ipcRenderer.invoke(IPC.pickFolder),
  pickExecutable: () => ipcRenderer.invoke(IPC.pickExecutable),
  confirm: (opts) => ipcRenderer.invoke(IPC.confirm, opts),
  contextMenu: (hasSelection) => ipcRenderer.invoke(IPC.contextMenu, hasSelection),
  readClipboard: () => ipcRenderer.invoke(IPC.clipboardRead),
  writeClipboard: (text) => ipcRenderer.send(IPC.clipboardWrite, text),
  openExternal: (url) => ipcRenderer.send(IPC.openExternal, url),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  listShells: () => ipcRenderer.invoke(IPC.shellsList),
  listPastSessions: (cwd, limit) => ipcRenderer.invoke(IPC.pastSessions, cwd, limit),
  loadUiState: () => ipcRenderer.invoke(IPC.uiLoad),
  saveUiState: (state) => ipcRenderer.invoke(IPC.uiSave, state),
  onUiFlushRequest: (listener) => subscribe(IPC.uiFlushRequest, listener),
  notifyAttention: (req) => ipcRenderer.send(IPC.attentionNotify, req),
  setAttentionSummary: (summary) => ipcRenderer.send(IPC.attentionSummary, summary),
  onAttentionFocus: (listener) => subscribe(IPC.attentionFocus, listener),
  gitInfo: (folder) => ipcRenderer.invoke(IPC.gitInfo, folder)
}

contextBridge.exposeInMainWorld('api', api)
