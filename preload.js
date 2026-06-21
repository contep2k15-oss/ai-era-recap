const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  minimize: () => ipcRenderer.send('win-minimize'),
  maximize: () => ipcRenderer.send('win-maximize'),
  close:    () => ipcRenderer.send('win-close'),
  toggleDevTools: () => ipcRenderer.send('toggle-devtools'),

  // Settings - API key
  saveSettings: (data) => ipcRenderer.invoke('save-settings', data),
  loadSettings: ()     => ipcRenderer.invoke('load-settings'),

  // Video
  selectVideoFile: ()  => ipcRenderer.invoke('select-video-file'),
  getVideoInfo: (path) => ipcRenderer.invoke('get-video-info', path),

  // Whisper STT
  runWhisper: (data)   => ipcRenderer.invoke('run-whisper', data),

  // Gemini
  geminiRequest: (data) => ipcRenderer.invoke('gemini-request', data),
  geminiUploadFile: (data) => ipcRenderer.invoke('gemini-upload-file', data),

  // Edge TTS
  edgeTTS: (params)   => ipcRenderer.invoke('edge-tts', params),

  // FFmpeg
  ffmpegBlur: (data)  => ipcRenderer.invoke('ffmpeg-blur', data),
  ffmpegCut:  (data)  => ipcRenderer.invoke('ffmpeg-cut', data),
  ffmpegMerge:(data)  => ipcRenderer.invoke('ffmpeg-merge', data),
  ffmpegConcat:(data) => ipcRenderer.invoke('ffmpeg-concat', data),

  // Output
  saveOutput: (data)  => ipcRenderer.invoke('save-output', data),
  openFolder: (path)  => ipcRenderer.invoke('open-folder', path),

  // Progress events from main
  onProgress: (cb)    => ipcRenderer.on('progress', (_e, data) => cb(data)),
  offProgress: ()     => ipcRenderer.removeAllListeners('progress'),
});
