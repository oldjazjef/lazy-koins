import { contextBridge, ipcRenderer } from 'electron';
import { type DesktopBridge, IPC } from '../shared/bridge';

// Sandboxed preload (contextIsolation + sandbox): only `contextBridge` and `ipcRenderer` are used,
// and the page gets plain functions — never ipcRenderer itself.
const bridge: DesktopBridge = {
  platform: process.platform,
  mcp: {
    stdio: () => ipcRenderer.invoke(IPC.mcpStdio),
  },
  storage: {
    info: () => ipcRenderer.invoke(IPC.storageInfo),
    choose: () => ipcRenderer.invoke(IPC.storageChoose),
    useDefault: () => ipcRenderer.invoke(IPC.storageUseDefault),
    reveal: () => ipcRenderer.invoke(IPC.storageReveal),
  },
  lock: {
    onLocked: (listener) => {
      // Only the reason string reaches the page, never the IPC event.
      const handler = (_event: unknown, reason: unknown) =>
        listener(typeof reason === 'string' ? reason : 'unknown');
      ipcRenderer.on(IPC.locked, handler);
      return () => {
        ipcRenderer.removeListener(IPC.locked, handler);
      };
    },
    setIdleMinutes: (minutes) =>
      ipcRenderer.invoke(IPC.lockIdleMinutes, minutes),
  },
  notifications: {
    enabled: () => ipcRenderer.invoke(IPC.notificationsEnabled),
    setEnabled: (on) => ipcRenderer.invoke(IPC.notificationsSetEnabled, on),
    show: (notification) =>
      ipcRenderer.invoke(IPC.notificationsShow, notification),
  },
};

contextBridge.exposeInMainWorld('lazykoinsDesktop', bridge);
