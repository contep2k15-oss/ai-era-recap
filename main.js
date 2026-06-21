const { app, BrowserWindow, shell, ipcMain, dialog } = require('electron');
const path = require('path');
const fs   = require('fs');
const os   = require('os');
const { spawn } = require('child_process');
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

ipcMain.handle('open-folder', async (_e, filePath) => {
  shell.showItemInFolder(filePath);
});

// ── FFMPEG HELPERS ──
function getFFmpegPath() {
  let p = require('ffmpeg-static');
  if (p && p.includes('app.asar')) p = p.replace('app.asar', 'app.asar.unpacked');
  return p;
}

function runFFmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(getFFmpegPath(), args);
    let stderr = '';
    proc.stderr.on('data', d => { stderr += d.toString(); });
    proc.on('close', code => {
      if (code === 0) resolve({ ok: true });
      else reject(new Error(`FFmpeg exit ${code}: ${stderr.slice(-400)}`));
    });
    proc.on('error', e => reject(e));
  });
}

function getPythonCmd() {
  return process.platform === 'win32' ? 'python' : 'python3';
}

// ── YT-DLP: LẤY SUBTITLE ──
ipcMain.handle('ytdlp-subtitle', async (event, { url }) => {
  return new Promise((resolve) => {
    const tmpDir = path.join(os.tmpdir(), `recap_sub_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    // Thử lấy subtitle có sẵn trước
    const proc = spawn('yt-dlp', [
      url,
      '--write-subs',
      '--write-auto-subs',
      '--sub-langs', 'vi,en,ja',
      '--sub-format', 'vtt/srt/best',
      '--skip-download',
      '--output', path.join(tmpDir, 'sub'),
      '--no-playlist'
    ]);

    let stderr = '';
    proc.stderr.on('data', d => {
      stderr += d.toString();
      event.sender.send('progress', { step: 'subtitle', log: d.toString() });
    });

    proc.on('close', (code) => {
      // Tìm file subtitle đã tải
      const files = fs.readdirSync(tmpDir);
      const subFile = files.find(f => f.endsWith('.vtt') || f.endsWith('.srt'));

      if (subFile) {
        const content = fs.readFileSync(path.join(tmpDir, subFile), 'utf8');
        const segments = parseSubtitle(content, subFile.endsWith('.vtt'));
        try { fs.rmSync(tmpDir, { recursive: true }); } catch(e) {}
        resolve({ ok: true, segments, text: segments.map(s => s.text).join(' '), source: 'subtitle' });
      } else {
        try { fs.rmSync(tmpDir, { recursive: true }); } catch(e) {}
        resolve({ ok: false, error: 'Không tìm thấy subtitle' });
      }
    });

    proc.on('error', () => resolve({ ok: false, error: 'yt-dlp chưa cài. Hãy cài: pip install yt-dlp' }));
  });
});

// ── PARSE SUBTITLE VTT/SRT → segments ──
function parseSubtitle(content, isVtt) {
  const segments = [];
  // Regex khớp cả VTT và SRT timestamp
  const timeRegex = /(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})/g;
  const lines = content.split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();
    const match = line.match(/(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})\s*-->\s*(\d{1,2}):(\d{2}):(\d{2})[.,](\d{3})/);
    if (match) {
      const toSec = (h,m,s,ms) => parseInt(h)*3600 + parseInt(m)*60 + parseInt(s) + parseInt(ms)/1000;
      const start = toSec(match[1],match[2],match[3],match[4]);
      const end   = toSec(match[5],match[6],match[7],match[8]);
      // Gom text các dòng sau timestamp
      const textLines = [];
      i++;
      while (i < lines.length && lines[i].trim() !== '' && !lines[i].match(/^\d+$/) && !lines[i].includes('-->')) {
        // Bỏ VTT tags như <c>, <00:00:00.000>
        const clean = lines[i].replace(/<[^>]+>/g, '').trim();
        if (clean) textLines.push(clean);
        i++;
      }
      if (textLines.length > 0) {
        segments.push({ start, end, text: textLines.join(' ') });
      }
    } else {
      i++;
    }
  }
  return segments;
}

// ── YT-DLP: TẢI VIDEO + TRÍCH KEYFRAME ──
ipcMain.handle('ytdlp-keyframes', async (event, { url }) => {
  return new Promise((resolve) => {
    const tmpDir = path.join(os.tmpdir(), `recap_frames_${Date.now()}`);
    fs.mkdirSync(tmpDir, { recursive: true });

    const ffmpegPath = getFFmpegPath();
    const videoPath  = path.join(tmpDir, 'video.mp4');

    event.sender.send('progress', { step: 'download', log: 'Đang tải video...' });

    // Bước 1: tải video chất lượng thấp để nhanh
    const dlProc = spawn('yt-dlp', [
      url,
      '-f', 'bestvideo[height<=480]+bestaudio/best[height<=480]/best',
      '-o', videoPath,
      '--no-playlist',
      '--merge-output-format', 'mp4'
    ]);

    dlProc.stderr.on('data', d => {
      event.sender.send('progress', { step: 'download', log: d.toString() });
    });

    dlProc.on('close', async (code) => {
      if (code !== 0 || !fs.existsSync(videoPath)) {
        try { fs.rmSync(tmpDir, { recursive: true }); } catch(e) {}
        return resolve({ ok: false, error: 'Tải video thất bại' });
      }

      event.sender.send('progress', { step: 'keyframe', log: 'Đang trích keyframe...' });

      // Bước 2: trích keyframe mỗi 30 giây
      const frameDir = path.join(tmpDir, 'frames');
      fs.mkdirSync(frameDir, { recursive: true });

      try {
        await new Promise((res, rej) => {
          const fp = spawn(ffmpegPath, [
            '-i', videoPath,
            '-vf', 'fps=1/30,scale=512:-1',
            '-q:v', '4',
            path.join(frameDir, 'frame_%04d.jpg'),
            '-y'
          ]);
          fp.on('close', c => c === 0 ? res() : rej(new Error('Keyframe failed')));
          fp.on('error', rej);
        });

        // Đọc frames → base64
        const frames = fs.readdirSync(frameDir)
          .filter(f => f.endsWith('.jpg'))
          .sort()
          .slice(0, 20)
          .map((f, i) => ({
            index: i,
            timestamp_sec: i * 30,
            timestamp: new Date(i * 30 * 1000).toISOString().substr(11, 8),
            b64: fs.readFileSync(path.join(frameDir, f)).toString('base64')
          }));

        // Lưu videoPath để dùng ở bước FFmpeg ghép
        resolve({ ok: true, frames, videoPath, tmpDir });

      } catch(e) {
        try { fs.rmSync(tmpDir, { recursive: true }); } catch(e2) {}
        resolve({ ok: false, error: e.message });
      }
    });

    dlProc.on('error', () => resolve({ ok: false, error: 'yt-dlp chưa cài. Hãy cài: pip install yt-dlp' }));
  });
});

// ── GEMINI API (ShopAIKey) ──
const SHOPAIKEY_BASE = 'https://direct.shopaikey.com';
const GEMINI_MODEL   = 'gemini-3.1-flash-lite';

ipcMain.handle('gemini-request', async (_e, { apiKey, model, contents, generationConfig }) => {
  try {
    const useModel = model || GEMINI_MODEL;
    const url  = `${SHOPAIKEY_BASE}/v1beta/models/${useModel}:generateContent?key=${apiKey}`;
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

// ── FFMPEG: CẮT CẢNH + TẮT AUDIO GỐC ──
ipcMain.handle('ffmpeg-cut', async (_e, { input, output, start, end }) => {
  try {
    await runFFmpeg([
      '-ss', String(start), '-to', String(end),
      '-i', input,
      '-an', // tắt audio gốc
      '-c:v', 'copy',
      '-y', output
    ]);
    return { ok: true };
  } catch(e) { return { ok: false, error: e.message }; }
});

// ── FFMPEG: BLUR VIOLATIONS ──
ipcMain.handle('ffmpeg-blur', async (_e, { input, output, violations }) => {
  try {
    if (!violations || violations.length === 0) {
      fs.copyFileSync(input, output);
      return { ok: true };
    }
    const filters = violations.map(v =>
      `boxblur=luma_radius=20:luma_power=5:x=${v.x}:y=${v.y}:w=${v.w}:h=${v.h}:enable='between(t,${v.t1},${v.t2})'`
    ).join(',');
    await runFFmpeg(['-i', input, '-vf', filters, '-c:a', 'copy', '-y', output]);
    return { ok: true };
  } catch(e) { return { ok: false, error: e.message }; }
});

// ── FFMPEG: MERGE VIDEO + AUDIO TTS ──
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

// ── FFMPEG: CONCAT TẤT CẢ CẢNH ──
ipcMain.handle('ffmpeg-concat', async (_e, { scenes, output }) => {
  try {
    const tmpList = path.join(os.tmpdir(), `recap_list_${Date.now()}.txt`);
    const listContent = scenes.map(s => `file '${s.replace(/\\/g,'\\\\').replace(/'/g,"\\'")}'`).join('\n');
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

// ── SAVE OUTPUT ──
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
