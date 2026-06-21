const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { spawn, execFile } = require('child_process');
const edgeTTS = require('./edge-tts');

app.commandLine.appendSwitch('disable-features', 'OutOfBlinkCors');
app.commandLine.appendSwitch('disable-background-timer-throttling');

let SETTINGS_PATH = '';

// ── SETTINGS ──
ipcMain.handle('save-settings', async (_e, data) => {
  try { fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2)); return { ok: true }; }
  catch(e) { return { ok: false, error: e.message }; }
});
ipcMain.handle('load-settings', async () => {
  try {
    if (fs.existsSync(SETTINGS_PATH)) return JSON.parse(fs.readFileSync(SETTINGS_PATH, 'utf8'));
    return {};
  } catch(e) { return {}; }
});

// ── SELECT VIDEO FILE ──
ipcMain.handle('select-video-file', async () => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showOpenDialog(win, {
    title: 'Chọn video anime',
    filters: [{ name: 'Video', extensions: ['mp4','mkv','avi','mov','webm','flv'] }],
    properties: ['openFile']
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

// ── GET VIDEO INFO via FFprobe ──
ipcMain.handle('get-video-info', async (_e, filePath) => {
  return new Promise((resolve) => {
    let ffmpegPath;
    try { ffmpegPath = getFFmpegPath(); } catch(e) { return resolve({ error: e.message }); }
    const ffprobePath = ffmpegPath.replace('ffmpeg', 'ffprobe');
    const args = ['-v','quiet','-print_format','json','-show_format','-show_streams', filePath];
    execFile(ffprobePath.replace('ffprobe','ffmpeg'), ['-i', filePath, '-f','null','-'], (err, stdout, stderr) => {
      const durationMatch = (stderr||'').match(/Duration:\s*([\d:]+)/);
      const sizeKB = fs.existsSync(filePath) ? Math.round(fs.statSync(filePath).size / 1024) : 0;
      resolve({ duration: durationMatch ? durationMatch[1] : '?', sizeKB, path: filePath });
    });
  });
});

// ── FFMPEG HELPERS ──
function getFFmpegPath() {
  let p = require('ffmpeg-static');
  if (p && p.includes('app.asar')) p = p.replace('app.asar', 'app.asar.unpacked');
  return p;
}

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const ffmpegPath = getFFmpegPath();
    const proc = spawn(ffmpegPath, args);
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code === 0) resolve({ ok: true });
      else reject(new Error(`FFmpeg exit ${code}: ${stderr.slice(-400)}`));
    });
    proc.on('error', e => reject(e));
  });
}

// ── FFMPEG: BLUR VIOLATIONS ──
ipcMain.handle('ffmpeg-blur', async (_e, { input, output, violations }) => {
  try {
    if (!violations || violations.length === 0) {
      fs.copyFileSync(input, output);
      return { ok: true };
    }
    // Build boxblur filter for each violation area
    const filters = violations.map(v =>
      `boxblur=luma_radius=20:luma_power=5:x=${v.x}:y=${v.y}:w=${v.w}:h=${v.h}:enable='between(t,${v.t1},${v.t2})'`
    ).join(',');
    await runFFmpeg(['-i', input, '-vf', filters, '-c:a', 'copy', '-y', output]);
    return { ok: true };
  } catch(e) { return { ok: false, error: e.message }; }
});

// ── FFMPEG: CUT SCENE ──
ipcMain.handle('ffmpeg-cut', async (_e, { input, output, start, end }) => {
  try {
    await runFFmpeg(['-ss', String(start), '-to', String(end), '-i', input, '-c', 'copy', '-y', output]);
    return { ok: true };
  } catch(e) { return { ok: false, error: e.message }; }
});

// ── FFMPEG: MERGE VIDEO + AUDIO ──
ipcMain.handle('ffmpeg-merge', async (_e, { video, audio, output }) => {
  try {
    await runFFmpeg([
      '-i', video, '-i', audio,
      '-c:v', 'copy', '-c:a', 'aac', '-b:a', '128k',
      '-shortest', '-y', output
    ]);
    return { ok: true };
  } catch(e) { return { ok: false, error: e.message }; }
});

// ── FFMPEG: CONCAT SCENES ──
ipcMain.handle('ffmpeg-concat', async (_e, { scenes, output }) => {
  try {
    const tmpList = path.join(os.tmpdir(), `recap_list_${Date.now()}.txt`);
    const listContent = scenes.map(s => `file '${s.replace(/'/g, "'\\''")}'`).join('\n');
    fs.writeFileSync(tmpList, listContent);
    await runFFmpeg([
      '-f', 'concat', '-safe', '0', '-i', tmpList,
      '-c:v', 'libx264', '-preset', 'fast', '-crf', '18',
      '-c:a', 'aac', '-b:a', '128k',
      '-vf', 'scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,setsar=1',
      '-r', '30', '-pix_fmt', 'yuv420p',
      '-movflags', '+faststart', '-y', output
    ]);
    try { fs.unlinkSync(tmpList); } catch(e) {}
    return { ok: true };
  } catch(e) { return { ok: false, error: e.message }; }
});

// ── SAVE OUTPUT (save dialog) ──
ipcMain.handle('save-output', async (_e, { tmpPath, filename }) => {
  const win = BrowserWindow.getFocusedWindow();
  const result = await dialog.showSaveDialog(win, {
    title: 'Lưu video recap',
    defaultPath: path.join(os.homedir(), 'Desktop', filename || 'recap.mp4'),
    filters: [{ name: 'MP4 Video', extensions: ['mp4'] }]
  });
  if (result.canceled || !result.filePath) return { ok: false, error: 'Đã hủy' };
  fs.copyFileSync(tmpPath, result.filePath);
  return { ok: true, outPath: result.filePath };
});

ipcMain.handle('open-folder', async (_e, filePath) => {
  shell.showItemInFolder(filePath);
});

// ── GEMINI API REQUEST (ShopAIKey endpoint) ──
const SHOPAIKEY_BASE   = 'https://direct.shopaikey.com';
const GEMINI_MODEL     = 'gemini-3.1-flash-lite';

ipcMain.handle('gemini-request', async (_e, { apiKey, model, contents, generationConfig }) => {
  try {
    const useModel = model || GEMINI_MODEL;
    const url = `${SHOPAIKEY_BASE}/v1beta/models/${useModel}:generateContent?key=${apiKey}`;
    const body = { contents, generationConfig: generationConfig || { maxOutputTokens: 8192 } };
    const res  = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    const data = await res.json();
    if (data.error) return { ok: false, error: data.error.message };
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return { ok: true, text };
  } catch(e) { return { ok: false, error: e.message }; }
});

// ── GEMINI FILE UPLOAD (for video) ──
ipcMain.handle('gemini-upload-file', async (_e, { apiKey, filePath, mimeType }) => {
  try {
    const fileBuffer = fs.readFileSync(filePath);
    const fileSize   = fileBuffer.length;
    // Step 1: initiate resumable upload
    const initRes = await fetch(
      `https://direct.shopaikey.com/upload/v1beta/files?key=${apiKey}`,
      {
        method: 'POST',
        headers: {
          'X-Goog-Upload-Protocol': 'resumable',
          'X-Goog-Upload-Command': 'start',
          'X-Goog-Upload-Header-Content-Length': String(fileSize),
          'X-Goog-Upload-Header-Content-Type': mimeType || 'video/mp4',
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ file: { display_name: path.basename(filePath) } })
      }
    );
    const uploadUrl = initRes.headers.get('x-goog-upload-url');
    if (!uploadUrl) return { ok: false, error: 'Cannot get upload URL' };
    // Step 2: upload bytes
    const uploadRes = await fetch(uploadUrl, {
      method: 'POST',
      headers: {
        'Content-Length': String(fileSize),
        'X-Goog-Upload-Offset': '0',
        'X-Goog-Upload-Command': 'upload, finalize'
      },
      body: fileBuffer
    });
    const uploadData = await uploadRes.json();
    if (!uploadData.file) return { ok: false, error: 'Upload failed' };
    // Step 3: wait for file to be ACTIVE
    const fileUri  = uploadData.file.uri;
    const fileName = uploadData.file.name;
    let state = uploadData.file.state;
    let attempts = 0;
    while (state === 'PROCESSING' && attempts < 30) {
      await new Promise(r => setTimeout(r, 3000));
      const checkRes = await fetch(
        `https://direct.shopaikey.com/v1beta/${fileName}?key=${apiKey}`
      );
      const checkData = await checkRes.json();
      state = checkData.state;
      attempts++;
    }
    if (state !== 'ACTIVE') return { ok: false, error: `File state: ${state}` };
    return { ok: true, fileUri, fileName };
  } catch(e) { return { ok: false, error: e.message }; }
});

// ── WHISPER STT ──
ipcMain.handle('run-whisper', async (event, { filePath, model }) => {
  return new Promise((resolve) => {
    // Try python whisper first
    const whisperModel = model || 'medium';
    const outDir = os.tmpdir();
    const pythonCmd = process.platform === 'win32' ? 'python' : 'python3';
    const proc = spawn(pythonCmd, [
      '-m', 'whisper', filePath,
      '--model', whisperModel,
      '--output_format', 'json',
      '--output_dir', outDir,
      '--language', 'ja'
    ]);
    let stderr = '';
    proc.stderr.on('data', d => {
      stderr += d.toString();
      event.sender.send('progress', { step: 'whisper', log: d.toString() });
    });
    proc.on('close', (code) => {
      if (code === 0) {
        const baseName = path.basename(filePath, path.extname(filePath));
        const jsonPath = path.join(outDir, baseName + '.json');
        try {
          const result = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
          resolve({ ok: true, segments: result.segments, text: result.text });
        } catch(e) {
          resolve({ ok: false, error: 'Cannot read whisper output: ' + e.message });
        }
      } else {
        resolve({ ok: false, error: `Whisper failed (${code}). Hãy cài: pip install openai-whisper` });
      }
    });
    proc.on('error', () => {
      resolve({ ok: false, error: 'Whisper chưa được cài. Hãy cài: pip install openai-whisper ffmpeg' });
    });
  });
});

// ── EDGE TTS ──
ipcMain.handle('edge-tts', async (_e, { text, voice, rate, pitch }) => {
  try {
    const buf = await edgeTTS.synthesize(text, { voice, rate: rate || '+0%', pitch: pitch || '+0Hz' });
    return { ok: true, data: buf.toString('base64') };
  } catch(e) { return { ok: false, error: e.message }; }
});

// ── WINDOW ──
function createWindow() {
  const win = new BrowserWindow({
    width: 1280, height: 820, minWidth: 920, minHeight: 600,
    frame: false, titleBarStyle: 'hidden', backgroundColor: '#0a0f0e',
    icon: path.join(__dirname, 'assets', 'icon.png'),
    webPreferences: {
      nodeIntegration: false, contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
      webSecurity: false, backgroundThrottling: false,
    },
    show: false,
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
  win.once('ready-to-show', () => win.show());
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
}

ipcMain.on('win-minimize', () => BrowserWindow.getFocusedWindow()?.minimize());
ipcMain.on('win-maximize', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win?.isMaximized()) win.unmaximize(); else win?.maximize();
});
ipcMain.on('win-close', () => BrowserWindow.getFocusedWindow()?.close());
ipcMain.on('toggle-devtools', () => {
  const win = BrowserWindow.getFocusedWindow();
  if (win) win.webContents.isDevToolsOpened() ? win.webContents.closeDevTools() : win.webContents.openDevTools();
});

app.whenReady().then(() => {
  SETTINGS_PATH = path.join(app.getPath('userData'), 'settings.json');
  createWindow();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
