const { contextBridge, ipcRenderer, webUtils } = require('electron');

const EVENTS = new Set(['palette:open', 'toast', 'inbox:changed', 'nav', 'notice', 'widget', 'theme']);

contextBridge.exposeInMainWorld('api', {
  invoke: (channel, payload) => ipcRenderer.invoke('jt:' + channel, payload),
  on: (channel, cb) => {
    if (!EVENTS.has(channel)) return;
    ipcRenderer.on('jt:' + channel, (_e, data) => cb(data));
  },
  pathFor: (file) => webUtils.getPathForFile(file),
});
