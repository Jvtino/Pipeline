// preload.js — safe bridge between the renderer (index.html) and the main process.
// Exposes a small, fixed surface; no Node access leaks into the page.
"use strict";
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("pipelineAPI", {
  // provider: "google" | "microsoft" | "imap"; opts only for imap {email, pass, host?, port?}
  connect: (provider, opts) => ipcRenderer.invoke("pipeline:connect", { provider, opts }),
  listAccounts: () => ipcRenderer.invoke("pipeline:listAccounts"),
  disconnect: (id) => ipcRenderer.invoke("pipeline:disconnect", id),
  fetchThreads: () => ipcRenderer.invoke("pipeline:fetchThreads"),
  openExternal: (url) => ipcRenderer.invoke("pipeline:openExternal", url),
});
