# ⚡ AI ERA Recap

Tự động tạo video recap anime cho TikTok bằng AI — Whisper + Gemini + Edge TTS + FFmpeg.

---

## 🚀 Hướng dẫn deploy lên GitHub (3 bước)

### Bước 1 — Tạo repo trên GitHub
Vào [github.com/new](https://github.com/new) → tạo repo mới tên `ai-era-recap` → **không** tick README.

### Bước 2 — Push code lên GitHub (chạy trong Git Bash)

```bash
cd /đường/dẫn/đến/folder/ai-era-recap

git init
git add .
git commit -m "Initial release v1.0.0"
git branch -M main
git remote add origin https://github.com/TEN_BAN_CUA_BAN/ai-era-recap.git
git push -u origin main
```

### Bước 3 — Build file .exe tự động

```bash
git tag v1.0.0
git push origin v1.0.0
```

> Sau khi push tag, vào tab **Actions** trên GitHub để xem build (~5–10 phút).
> Khi xong, vào tab **Releases** để tải file `.exe` về cài đặt.

---

## 💻 Chạy thử trên máy (không cần build)

```bash
# Cài Node.js 18+ trước, sau đó:
npm install
npm start
```

---

## 📋 Yêu cầu hệ thống

- Windows 10/11 x64
- RAM: 8GB+ (16GB để chạy Whisper medium)
- GPU NVIDIA: không bắt buộc nhưng giúp Whisper nhanh hơn nhiều

---

## 🔧 Cài đặt lần đầu

1. Cài app từ file `.exe`
2. Mở app → click ⚙️ góc trên phải
3. Nhập **Gemini API key** (lấy miễn phí tại [aistudio.google.com](https://aistudio.google.com))
4. Cài **Whisper** (nếu muốn dùng STT):
   ```bash
   pip install openai-whisper
   ```
5. Bấm **Lưu cài đặt** → bắt đầu dùng!

---

## ⚡ Pipeline tự động

| Bước | Công cụ | Chi phí |
|------|---------|---------|
| Speech to Text | Whisper (local) | Miễn phí |
| Phân tích cảnh | Gemini 2.0 Flash | Miễn phí |
| Viết script | Gemini 2.0 Flash | Miễn phí |
| Kiểm duyệt TikTok | Gemini Vision | Miễn phí |
| Text to Speech | Edge TTS | Miễn phí |
| Ghép video | FFmpeg | Miễn phí |

---

## 📁 Cấu trúc project

```
ai-era-recap/
├── main.js          # Electron main process
├── preload.js       # IPC bridge
├── edge-tts.js      # Microsoft Edge TTS module
├── package.json     # Cấu hình build
├── src/
│   └── index.html   # Toàn bộ UI
├── assets/
│   ├── icon.png
│   └── icon.ico
└── .github/
    └── workflows/
        └── build.yml
```
