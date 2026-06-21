const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('win-minimize'),
  maximize: () => ipcRenderer.send('win-maximize'),
  close:    () => ipcRenderer.send('win-close'),
  toggleDevTools: () => ipcRenderer.send('toggle-devtools'),

  // Settings
  saveSettings: (data) => ipcRenderer.invoke('save-settings', data),
  loadSettings: ()     => ipcRenderer.invoke('load-settings'),

  // yt-dlp
  ytdlpSubtitle:  (data) => ipcRenderer.invoke('ytdlp-subtitle', data),
  ytdlpKeyframes: (data) => ipcRenderer.invoke('ytdlp-keyframes', data),

  // Gemini
  geminiRequest: (data) => ipcRenderer.invoke('gemini-request', data),

  // Edge TTS
  edgeTTS: (params) => ipcRenderer.invoke('edge-tts', params),

  // FFmpeg
  ffmpegBlur:   (data) => ipcRenderer.invoke('ffmpeg-blur', data),
  ffmpegCut:    (data) => ipcRenderer.invoke('ffmpeg-cut', data),
  ffmpegMerge:  (data) => ipcRenderer.invoke('ffmpeg-merge', data),
  ffmpegConcat: (data) => ipcRenderer.invoke('ffmpeg-concat', data),

  // Output
  saveOutput: (data) => ipcRenderer.invoke('save-output', data),
  openFolder: (path) => ipcRenderer.invoke('open-folder', path),

  // Progress events
  onProgress:  (cb) => ipcRenderer.on('progress', (_e, data) => cb(data)),
  offProgress: ()   => ipcRenderer.removeAllListeners('progress'),
});
