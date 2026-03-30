const { contextBridge, ipcRenderer } = require('electron');

function bindListener(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('desktopPet', {
  getState: () => ipcRenderer.invoke('get-state'),
  saveState: (patch) => ipcRenderer.invoke('save-state', patch),
  updateFocus: (patch) => ipcRenderer.invoke('update-focus', patch),
  generateAvatar: (payload) => ipcRenderer.invoke('generate-avatar', payload),
  chatAvatar: (payload) => ipcRenderer.invoke('chat-avatar', payload),
  selectImage: () => ipcRenderer.invoke('select-image'),
  showControlWindow: () => ipcRenderer.invoke('show-control-window'),
  testLLMConnection: (settings) => ipcRenderer.invoke('test-llm-connection', settings),
  getWeatherNow: (settings) => ipcRenderer.invoke('get-weather-now', settings),
  openPreviewUrl: (url) => ipcRenderer.invoke('open-preview-url', url),
  triggerVisitor: () => ipcRenderer.invoke('trigger-visitor'),
  playSound: (soundId) => ipcRenderer.send('play-sound', soundId),
  onStateUpdated: (callback) => bindListener('state-updated', callback),
  onVisitor: (callback) => bindListener('show-visitor', callback),
  onPlaySound: (callback) => bindListener('play-sound', callback),
  startDrag: (payload) => ipcRenderer.send('start-drag', payload),
  dragging: (payload) => ipcRenderer.send('dragging', payload),
  endDrag: () => ipcRenderer.send('end-drag')
});
