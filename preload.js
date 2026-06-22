const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('win-minimize'),
  maximize: () => ipcRenderer.send('win-maximize'),
  close:    () => ipcRenderer.send('win-close'),
  toggleDevTools: () => ipcRenderer.send('toggle-devtools'),

  saveSettings: (data) => ipcRenderer.invoke('save-settings', data),
  loadSettings: ()     => ipcRenderer.invoke('load-settings'),

  ytdlpSubtitle:  (data) => ipcRenderer.invoke('ytdlp-subtitle', data),
  ytdlpKeyframes: (data) => ipcRenderer.invoke('ytdlp-keyframes', data),

  geminiRequest: (data) => ipcRenderer.invoke('gemini-request', data),

  edgeTTS:     (params) => ipcRenderer.invoke('edge-tts', params),
  edgeTTSFile: (params) => ipcRenderer.invoke('edge-tts-file', params),

  ffmpegBlur:   (data) => ipcRenderer.invoke('ffmpeg-blur', data),
  ffmpegCut:    (data) => ipcRenderer.invoke('ffmpeg-cut', data),
  ffmpegMerge:  (data) => ipcRenderer.invoke('ffmpeg-merge', data),
  ffmpegConcat: (data) => ipcRenderer.invoke('ffmpeg-concat', data),

  renderVideo: (data) => ipcRenderer.invoke('render-video', data),

  saveOutput: (data) => ipcRenderer.invoke('save-output', data),
  openFolder: (path) => ipcRenderer.invoke('open-folder', path),

  onProgress:      (cb) => ipcRenderer.on('progress',       (_e, data) => cb(data)),
  onRenderProgress:(cb) => ipcRenderer.on('render-progress', (_e, data) => cb(data)),
  offProgress:     ()   => ipcRenderer.removeAllListeners('progress'),
  offRenderProgress:()  => ipcRenderer.removeAllListeners('render-progress'),
});
