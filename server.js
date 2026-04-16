require('dotenv').config();
const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const ffmpeg = require('fluent-ffmpeg');
const OpenAI = require('openai');

const app = express();
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, 'public')));

const ENV_PATH = path.join(__dirname, '.env');

// Mutable API clients — rebuilt when keys change
let openai = createOpenAIClient();
let xai = createXAIClient();
let groq = createGroqClient();
let fireworksV3 = createFireworksV3Client();
let fireworksV3Turbo = createFireworksV3TurboClient();

function createOpenAIClient() {
  return new OpenAI({ apiKey: process.env.OPENAI_API_KEY || 'missing' });
}
function createXAIClient() {
  return new OpenAI({ apiKey: process.env.XAI_API_KEY || 'missing', baseURL: 'https://api.x.ai/v1' });
}
function createGroqClient() {
  return new OpenAI({ apiKey: process.env.GROQ_API_KEY || 'missing', baseURL: 'https://api.groq.com/openai/v1' });
}
function createFireworksV3Client() {
  return new OpenAI({ apiKey: process.env.FIREWORKS_API_KEY || 'missing', baseURL: 'https://audio-prod.api.fireworks.ai/v1' });
}
function createFireworksV3TurboClient() {
  return new OpenAI({ apiKey: process.env.FIREWORKS_API_KEY || 'missing', baseURL: 'https://audio-turbo.api.fireworks.ai/v1' });
}
function reloadClients() {
  const envContent = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf-8') : '';
  for (const line of envContent.split('\n')) {
    const m = line.match(/^\s*([\w]+)\s*=\s*(.*)\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
  openai = createOpenAIClient();
  xai = createXAIClient();
  groq = createGroqClient();
  fireworksV3 = createFireworksV3Client();
  fireworksV3Turbo = createFireworksV3TurboClient();
}

// Mask key for display: show first 8 + last 4
function maskKey(key) {
  if (!key || key === 'missing') return '';
  if (key.length <= 16) return '****';
  return key.slice(0, 8) + '****' + key.slice(-4);
}

function settingsPayload() {
  return {
    openaiKey: maskKey(process.env.OPENAI_API_KEY),
    xaiKey: maskKey(process.env.XAI_API_KEY),
    groqKey: maskKey(process.env.GROQ_API_KEY),
    fireworksKey: maskKey(process.env.FIREWORKS_API_KEY),
    hasOpenai: !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY !== 'missing'),
    hasXai: !!(process.env.XAI_API_KEY && process.env.XAI_API_KEY !== 'missing'),
    hasGroq: !!(process.env.GROQ_API_KEY && process.env.GROQ_API_KEY !== 'missing'),
    hasFireworks: !!(process.env.FIREWORKS_API_KEY && process.env.FIREWORKS_API_KEY !== 'missing'),
  };
}

// API: Get current keys (masked)
app.get('/api/settings', (req, res) => res.json(settingsPayload()));

// API: Save keys
app.post('/api/settings', (req, res) => {
  const { openaiKey, xaiKey, groqKey, fireworksKey } = req.body;

  let envMap = {};
  if (fs.existsSync(ENV_PATH)) {
    for (const line of fs.readFileSync(ENV_PATH, 'utf-8').split('\n')) {
      const m = line.match(/^\s*([\w]+)\s*=\s*(.*)\s*$/);
      if (m) envMap[m[1]] = m[2];
    }
  }

  if (openaiKey && !openaiKey.includes('****')) envMap['OPENAI_API_KEY'] = openaiKey.trim();
  if (xaiKey && !xaiKey.includes('****')) envMap['XAI_API_KEY'] = xaiKey.trim();
  if (groqKey && !groqKey.includes('****')) envMap['GROQ_API_KEY'] = groqKey.trim();
  if (fireworksKey && !fireworksKey.includes('****')) envMap['FIREWORKS_API_KEY'] = fireworksKey.trim();

  const content = Object.entries(envMap).map(([k, v]) => `${k}=${v}`).join('\n') + '\n';
  fs.writeFileSync(ENV_PATH, content, 'utf-8');
  reloadClients();

  res.json({ ok: true, ...settingsPayload() });
});

const VIDEO_EXTS = new Set(['.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.ts', '.mts', '.mpg', '.mpeg']);
const SRT_EXT = '.srt';

// Available Whisper (transcription) models
const WHISPER_MODELS = [
  { id: 'whisper-1', name: 'Whisper-1 (large-v2)', provider: 'openai' },
  { id: 'whisper-large-v3', name: 'Whisper Large V3', provider: 'groq' },
  { id: 'whisper-large-v3-turbo', name: 'Whisper Large V3 Turbo', provider: 'groq' },
  { id: 'fireworks-whisper-v3', name: 'Fireworks Whisper V3', provider: 'fireworks' },
  { id: 'fireworks-whisper-v3-turbo', name: 'Fireworks Whisper V3 Turbo', provider: 'fireworks' },
];

// Available translation models
const TRANSLATION_MODELS = [
  { id: 'grok-3-mini', name: 'Grok 3 Mini ★推薦', provider: 'xai' },
  { id: 'grok-3', name: 'Grok 3', provider: 'xai' },
  { id: 'grok-4-fast-non-reasoning', name: 'Grok 4 Fast', provider: 'xai' },
  { id: 'grok-4-1-fast-non-reasoning', name: 'Grok 4.1 Fast', provider: 'xai' },
  { id: 'grok-4-0709', name: 'Grok 4 (貴)', provider: 'xai' },
  { id: 'grok-4.20-0309-non-reasoning', name: 'Grok 4.20 (最貴)', provider: 'xai' },
  { id: 'gpt-4.1-mini', name: 'GPT-4.1 Mini', provider: 'openai' },
  { id: 'gpt-4.1-nano', name: 'GPT-4.1 Nano', provider: 'openai' },
  { id: 'gpt-4.1', name: 'GPT-4.1', provider: 'openai' },
  { id: 'gpt-4o-mini', name: 'GPT-4o Mini', provider: 'openai' },
  { id: 'gpt-4o', name: 'GPT-4o', provider: 'openai' },
];

// SSE clients keyed by sessionId
const sseClients = new Map();

// Language code to Chinese label mapping
const LANG_MAP = {
  ja: '日語', en: '英語', ko: '韓語', zh: '中文', fr: '法語',
  de: '德語', es: '西班牙語', it: '義大利語', pt: '葡萄牙語',
  ru: '俄語', ar: '阿拉伯語', hi: '印地語', th: '泰語',
  vi: '越南語', id: '印尼語', ms: '馬來語', tl: '菲律賓語',
  nl: '荷蘭語', pl: '波蘭語', tr: '土耳其語', uk: '烏克蘭語',
  cs: '捷克語', sv: '瑞典語', da: '丹麥語', fi: '芬蘭語',
  el: '希臘語', he: '希伯來語', hu: '匈牙利語', no: '挪威語',
  ro: '羅馬尼亞語', sk: '斯洛伐克語', bg: '保加利亞語',
  hr: '克羅埃西亞語', lt: '立陶宛語', lv: '拉脫維亞語',
  et: '愛沙尼亞語', sl: '斯洛維尼亞語', mt: '馬耳他語',
};

function sendProgress(sessionId, fileIndex, data) {
  const clients = sseClients.get(sessionId);
  if (!clients) return;
  const msg = JSON.stringify({ fileIndex, ...data });
  clients.forEach(res => res.write(`data: ${msg}\n\n`));
}

function getAudioDuration(filePath) {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) return reject(err);
      resolve(metadata.format.duration);
    });
  });
}

function extractAudio(videoPath, outputPath, sessionId, fileIndex) {
  return new Promise((resolve, reject) => {
    sendProgress(sessionId, fileIndex, { stage: '拆解聲音中', percent: 5 });
    const { spawn } = require('child_process');
    const args = [
      '-i', videoPath,
      '-vn', '-ac', '1', '-ar', '16000', '-ab', '64k',
      '-f', 'mp3', '-y', outputPath,
    ];
    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'pipe', 'pipe'] });

    let stderr = '';
    proc.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      // Parse duration/time for progress
      const durMatch = stderr.match(/Duration:\s*(\d+):(\d+):(\d+)/);
      const timeMatch = stderr.match(/time=(\d+):(\d+):(\d+)/g);
      if (durMatch && timeMatch) {
        const durSec = +durMatch[1] * 3600 + +durMatch[2] * 60 + +durMatch[3];
        const last = timeMatch[timeMatch.length - 1];
        const tm = last.match(/time=(\d+):(\d+):(\d+)/);
        if (tm && durSec > 0) {
          const curSec = +tm[1] * 3600 + +tm[2] * 60 + +tm[3];
          const pct = Math.min(Math.round((curSec / durSec) * 18) + 2, 20);
          sendProgress(sessionId, fileIndex, { stage: '拆解聲音中', percent: pct });
        }
      }
    });

    proc.on('close', (code) => {
      // Check if the output file was actually created and has content
      if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 0) {
        sendProgress(sessionId, fileIndex, { stage: '拆解聲音中', percent: 20 });
        resolve();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr.slice(-500)}`));
      }
    });

    proc.on('error', (err) => reject(new Error(`ffmpeg spawn error: ${err.message}`)));
  });
}

async function splitAudio(audioPath, tempDir) {
  const stat = fs.statSync(audioPath);
  const fileSizeMB = stat.size / (1024 * 1024);

  if (fileSizeMB <= 24) {
    return [{ path: audioPath, startTime: 0 }];
  }

  const duration = await getAudioDuration(audioPath);
  const numChunks = Math.ceil(fileSizeMB / 24);
  const chunkDuration = duration / numChunks;
  const chunks = [];

  for (let i = 0; i < numChunks; i++) {
    const startTime = i * chunkDuration;
    const chunkPath = path.join(tempDir, `chunk_${i}.mp3`);
    await new Promise((resolve, reject) => {
      const { spawn } = require('child_process');
      const proc = spawn('ffmpeg', [
        '-i', audioPath, '-ss', String(startTime), '-t', String(chunkDuration),
        '-y', chunkPath,
      ], { stdio: ['ignore', 'ignore', 'pipe'] });
      let stderr = '';
      proc.stderr.on('data', d => stderr += d);
      proc.on('close', () => {
        if (fs.existsSync(chunkPath) && fs.statSync(chunkPath).size > 0) resolve();
        else reject(new Error(`chunk split failed: ${stderr.slice(-300)}`));
      });
      proc.on('error', e => reject(e));
    });
    chunks.push({ path: chunkPath, startTime });
  }

  return chunks;
}

// Re-group word-level timestamps into sentence segments at punctuation boundaries
function regroupWordsToSegments(words, maxDuration = 8) {
  if (!words || words.length === 0) return [];
  const segments = [];
  let cur = [];

  for (const w of words) {
    cur.push(w);
    const wordText = (w.word || w.text || '').trim();
    const duration = cur[cur.length - 1].end - cur[0].start;
    const endsWithPunct = /[。！？!?.]$/.test(wordText);
    if (endsWithPunct || duration >= maxDuration) {
      segments.push({
        start: cur[0].start,
        end: cur[cur.length - 1].end,
        text: cur.map(x => x.word || x.text || '').join('').trim(),
      });
      cur = [];
    }
  }
  if (cur.length > 0) {
    segments.push({
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      text: cur.map(x => x.word || x.text || '').join('').trim(),
    });
  }
  return segments;
}

async function transcribeChunk(chunkPath, whisperModel, sourceLanguage) {
  const modelDef = WHISPER_MODELS.find(m => m.id === whisperModel);

  // Fireworks: use verbose_json + word-level timestamps for accurate per-sentence segmentation
  if (modelDef && modelDef.provider === 'fireworks') {
    const client = (whisperModel === 'fireworks-whisper-v3-turbo') ? fireworksV3Turbo : fireworksV3;
    const fileStream = fs.createReadStream(chunkPath);
    const params = {
      file: fileStream,
      model: 'whisper-v3',
      response_format: 'verbose_json',
      timestamp_granularities: ['word'],
      vad_model: 'silero',
    };
    if (sourceLanguage && sourceLanguage !== 'auto') params.language = sourceLanguage;
    const response = await client.audio.transcriptions.create(params);
    const words = response.words || response.segments?.flatMap(s => s.words || []) || [];
    return {
      segments: regroupWordsToSegments(words),
      language: response.language || (sourceLanguage !== 'auto' ? sourceLanguage : null),
    };
  }

  // OpenAI / Groq
  const client = (modelDef && modelDef.provider === 'groq') ? groq : openai;
  const apiModelName = whisperModel || 'whisper-1';
  const fileStream = fs.createReadStream(chunkPath);
  const params = {
    file: fileStream,
    model: apiModelName,
    response_format: 'verbose_json',
    timestamp_granularities: ['segment'],
  };
  if (sourceLanguage && sourceLanguage !== 'auto') params.language = sourceLanguage;
  return await client.audio.transcriptions.create(params);
}

// Whisper tokenizer inserts spaces between every CJK token — remove them
function normalizeWhisperText(text) {
  // Collapse multiple spaces to one
  text = text.replace(/\s+/g, ' ').trim();
  // Remove spaces between CJK characters (covers も、な、で、す etc.)
  let prev;
  do {
    prev = text;
    text = text.replace(/([\u3000-\u9FFF\uFF00-\uFFEF])\s+([\u3000-\u9FFF\uFF00-\uFFEF])/g, '$1$2');
  } while (text !== prev);
  // Remove space before/after ASCII punctuation when surrounded by CJK
  text = text.replace(/([\u3000-\u9FFF\uFF00-\uFFEF])\s+([.!?,;:])/g, '$1$2');
  text = text.replace(/([.!?,;:])\s+([\u3000-\u9FFF\uFF00-\uFFEF])/g, '$1$2');
  return text;
}

// Split long segments (e.g. 30-second Fireworks blocks) at sentence boundaries.
// Timestamps are distributed proportionally by character count.
function splitLongSegments(segments, maxDuration = 7) {
  const result = [];
  for (const seg of segments) {
    const duration = seg.end - seg.start;
    const text = normalizeWhisperText(seg.text);

    if (duration <= maxDuration) {
      result.push({ ...seg, text });
      continue;
    }

    // Split at Japanese / ASCII sentence-ending punctuation
    const sentences = [];
    let cur = '';
    for (let i = 0; i < text.length; i++) {
      cur += text[i];
      if ('。！？!?.'.includes(text[i]) && cur.trim().length > 1) {
        // Skip trailing spaces after punctuation
        while (i + 1 < text.length && text[i + 1] === ' ') i++;
        sentences.push(cur.trim());
        cur = '';
      }
    }
    if (cur.trim()) sentences.push(cur.trim());

    if (sentences.length <= 1) {
      result.push({ ...seg, text });
      continue;
    }

    // Distribute time proportionally by character count
    const totalChars = sentences.reduce((sum, s) => sum + s.length, 0);
    let start = seg.start;
    for (const sentence of sentences) {
      const proportion = sentence.length / totalChars;
      const end = Math.min(start + duration * proportion, seg.end);
      result.push({ start, end, text: sentence });
      start = end;
    }
  }
  return result;
}

function formatSrtTime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms).padStart(3, '0')}`;
}

function buildSrt(segments) {
  let srt = '';
  segments.forEach((seg, i) => {
    srt += `${i + 1}\n`;
    srt += `${formatSrtTime(seg.start)} --> ${formatSrtTime(seg.end)}\n`;
    srt += `${normalizeWhisperText(seg.text)}\n\n`;
  });
  return srt;
}

// Get the right API client for a model
function getClientForModel(modelId) {
  const modelDef = TRANSLATION_MODELS.find(m => m.id === modelId);
  return (modelDef && modelDef.provider === 'openai') ? openai : xai;
}

// Target language config
const TARGET_LANG_CONFIG = {
  'zh-TW': { name: '繁體中文', fileSuffix: '中文(繁體)', prompt: '繁體中文' },
  'zh-CN': { name: '简体中文', fileSuffix: '中文(简体)', prompt: '简体中文' },
  en:       { name: 'English', fileSuffix: 'English', prompt: 'English' },
  ja:       { name: '日本語', fileSuffix: '日語', prompt: '日本語' },
  ko:       { name: '한국어', fileSuffix: '韓語', prompt: '한국어 (Korean)' },
};

// Translate SRT content — auto split into parallel batches for large files
async function translateSrt(srtContent, model, targetLang, sessionId, fileIndex, percentStart, percentEnd) {
  const client = getClientForModel(model);
  const tlConf = TARGET_LANG_CONFIG[targetLang] || TARGET_LANG_CONFIG['zh-TW'];
  const SYSTEM_MSG = `你是一個專業的字幕翻譯員。請將以下 SRT 字幕內容翻譯成${tlConf.prompt}。保持 SRT 格式不變（序號、時間軸不要改動），只翻譯文字部分。直接輸出翻譯後的 SRT 內容，不要加任何解釋。`;
  const TIMEOUT = { timeout: 5 * 60 * 1000 };

  // Split SRT into entry blocks (each block = index + time + text)
  const entries = srtContent.trim().split(/\n\n+/);
  const totalEntries = entries.length;

  // Decide batch size: <=100 entries → 1 batch, otherwise ~100 per batch
  const batchSize = 100;

  if (totalEntries <= batchSize) {
    // Single batch
    const stageLabel = `翻譯成${tlConf.name}中`;
    sendProgress(sessionId, fileIndex, { stage: stageLabel, percent: percentStart });
    const response = await client.chat.completions.create({
      model, messages: [{ role: 'system', content: SYSTEM_MSG }, { role: 'user', content: srtContent }],
      temperature: 0.3,
    }, TIMEOUT);
    sendProgress(sessionId, fileIndex, { stage: stageLabel, percent: percentEnd });
    return response.choices[0].message.content.trim();
  }

  // Multiple batches — send all in parallel
  const batches = [];
  for (let i = 0; i < totalEntries; i += batchSize) {
    batches.push(entries.slice(i, i + batchSize).join('\n\n'));
  }

  const stageLabel = `翻譯成${tlConf.name}中`;
  sendProgress(sessionId, fileIndex, {
    stage: `${stageLabel} (${batches.length} 批並行)`, percent: percentStart,
  });

  let completed = 0;
  const results = await Promise.all(batches.map(async (batch, i) => {
    const response = await client.chat.completions.create({
      model, messages: [{ role: 'system', content: SYSTEM_MSG }, { role: 'user', content: batch }],
      temperature: 0.3,
    }, TIMEOUT);
    completed++;
    const pct = percentStart + Math.round((completed / batches.length) * (percentEnd - percentStart));
    sendProgress(sessionId, fileIndex, {
      stage: `${stageLabel} (${completed}/${batches.length})`, percent: pct,
    });
    return response.choices[0].message.content.trim();
  }));

  return results.join('\n\n');
}

// Process a single video file (full pipeline)
async function processVideoFile(filePath, model, targetLang, whisperModel, sessionId, fileIndex, sourceLanguage) {
  const tempDir = path.join(__dirname, 'temp', uuidv4());
  fs.mkdirSync(tempDir, { recursive: true });

  const baseName = path.basename(filePath, path.extname(filePath));
  const outputDir = path.dirname(filePath);

  try {
    // Step 1: Extract audio
    const audioPath = path.join(tempDir, 'audio.mp3');
    await extractAudio(filePath, audioPath, sessionId, fileIndex);

    // Step 2: Split audio
    sendProgress(sessionId, fileIndex, { stage: '拆解聲音中', percent: 22 });
    const chunks = await splitAudio(audioPath, tempDir);

    // Step 3: Transcribe in parallel
    sendProgress(sessionId, fileIndex, { stage: '聽寫語音中', percent: 25 });
    const totalChunks = chunks.length;
    let completedChunks = 0;

    const transcriptionPromises = chunks.map(async (chunk) => {
      const result = await transcribeChunk(chunk.path, whisperModel, sourceLanguage);
      completedChunks++;
      const pct = 25 + Math.round((completedChunks / totalChunks) * 45);
      sendProgress(sessionId, fileIndex, { stage: '聽寫語音中', percent: pct });
      return { ...result, offsetTime: chunk.startTime };
    });

    const transcriptions = await Promise.all(transcriptionPromises);

    // Step 4: Merge segments
    let allSegments = [];
    let detectedLang = 'en';
    for (const trans of transcriptions) {
      if (trans.language) detectedLang = trans.language;
      if (trans.segments) {
        for (const seg of trans.segments) {
          allSegments.push({
            start: seg.start + trans.offsetTime,
            end: seg.end + trans.offsetTime,
            text: seg.text,
          });
        }
      }
    }

    // Step 4.5: Re-segment long blocks at sentence boundaries
    allSegments = splitLongSegments(allSegments);

    // Step 5: Save original SRT
    const srtContent = buildSrt(allSegments);
    const langLabel = LANG_MAP[detectedLang] || detectedLang;
    const originalSrtPath = path.join(outputDir, `${baseName}-${langLabel}.srt`);
    fs.writeFileSync(originalSrtPath, srtContent, 'utf-8');
    sendProgress(sessionId, fileIndex, { stage: '聽寫語音中', percent: 78, detectedLang: langLabel });

    // Step 6: Translate
    const tlConf = TARGET_LANG_CONFIG[targetLang] || TARGET_LANG_CONFIG['zh-TW'];
    sendProgress(sessionId, fileIndex, { stage: `翻譯成${tlConf.name}中`, percent: 80 });
    const translatedSrt = await translateSrt(srtContent, model, targetLang, sessionId, fileIndex, 80, 95);
    const translatedSrtPath = path.join(outputDir, `${baseName}-${tlConf.fileSuffix}.srt`);
    fs.writeFileSync(translatedSrtPath, translatedSrt, 'utf-8');

    sendProgress(sessionId, fileIndex, {
      stage: '完成',
      percent: 100,
      savedFiles: [originalSrtPath, translatedSrtPath],
    });
  } catch (err) {
    console.error(`Error processing ${filePath}:`, err);
    sendProgress(sessionId, fileIndex, { stage: `錯誤: ${err.message}`, percent: -1 });
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

// Translate an existing SRT file only
async function translateSrtFile(srtPath, model, targetLang, sessionId, fileIndex) {
  const baseName = path.basename(srtPath, '.srt');
  // Strip existing language suffix if present (e.g. "video-日語" -> "video")
  const cleanBase = baseName.replace(/-[^-]+$/, '');
  const outputDir = path.dirname(srtPath);

  try {
    sendProgress(sessionId, fileIndex, { stage: '讀取 SRT 中', percent: 5 });
    const srtContent = fs.readFileSync(srtPath, 'utf-8');

    const tlConf = TARGET_LANG_CONFIG[targetLang] || TARGET_LANG_CONFIG['zh-TW'];
    sendProgress(sessionId, fileIndex, { stage: `翻譯成${tlConf.name}中`, percent: 10 });
    const translatedSrt = await translateSrt(srtContent, model, targetLang, sessionId, fileIndex, 10, 95);

    const translatedSrtPath = path.join(outputDir, `${cleanBase}-${tlConf.fileSuffix}.srt`);
    fs.writeFileSync(translatedSrtPath, translatedSrt, 'utf-8');

    sendProgress(sessionId, fileIndex, {
      stage: '完成',
      percent: 100,
      savedFiles: [translatedSrtPath],
    });
  } catch (err) {
    console.error(`Error translating ${srtPath}:`, err);
    sendProgress(sessionId, fileIndex, { stage: `錯誤: ${err.message}`, percent: -1 });
  }
}

// API: Native OS directory picker
app.post('/api/pick-directory', async (req, res) => {
  const { execFile } = require('child_process');
  const platform = process.platform;

  if (platform === 'darwin') {
    // macOS: use osascript to open Finder folder picker
    const script = 'set theFolder to POSIX path of (choose folder with prompt "選擇影片目錄")\nreturn theFolder';
    execFile('osascript', ['-e', script], { timeout: 120000 }, (err, stdout) => {
      if (err) return res.json({ cancelled: true });
      const dir = stdout.trim().replace(/\/$/, '');
      res.json({ dirPath: dir });
    });
  } else if (platform === 'win32') {
    // Windows: use PowerShell folder picker
    const ps = `Add-Type -AssemblyName System.Windows.Forms; $f = New-Object System.Windows.Forms.FolderBrowserDialog; $f.Description = 'Select video directory'; if ($f.ShowDialog() -eq 'OK') { $f.SelectedPath } else { '' }`;
    execFile('powershell', ['-Command', ps], { timeout: 120000 }, (err, stdout) => {
      if (err || !stdout.trim()) return res.json({ cancelled: true });
      res.json({ dirPath: stdout.trim() });
    });
  } else {
    // Linux: try zenity
    execFile('zenity', ['--file-selection', '--directory', '--title=Select video directory'], { timeout: 120000 }, (err, stdout) => {
      if (err || !stdout.trim()) return res.json({ cancelled: true });
      res.json({ dirPath: stdout.trim() });
    });
  }
});

// API: Get available translation models
app.get('/api/models', (req, res) => {
  res.json({ models: TRANSLATION_MODELS, whisperModels: WHISPER_MODELS });
});

// API: Scan directory for video + SRT files
app.post('/api/scan', (req, res) => {
  const { dirPath } = req.body;
  if (!dirPath) return res.status(400).json({ error: '未提供目錄路徑' });

  const resolved = path.resolve(dirPath);
  if (!fs.existsSync(resolved)) return res.status(400).json({ error: '目錄不存在' });
  const stat = fs.statSync(resolved);
  if (!stat.isDirectory()) return res.status(400).json({ error: '路徑不是目錄' });

  const allFiles = fs.readdirSync(resolved);

  const videoNames = allFiles.filter(f => VIDEO_EXTS.has(path.extname(f).toLowerCase()));
  const srtNames = allFiles.filter(f => path.extname(f).toLowerCase() === SRT_EXT);

  // Build a Set of SRT basenames for quick lookup
  const srtSet = new Set(srtNames.map(f => f));

  // Group: each video with its matching SRTs
  const groups = videoNames.map(vName => {
    const base = path.basename(vName, path.extname(vName));
    const matchedSrts = srtNames.filter(s => {
      const srtBase = path.basename(s, '.srt');
      return srtBase === base || srtBase.startsWith(base + '-') || srtBase.startsWith(base + '.');
    });
    return {
      video: {
        name: vName,
        path: path.join(resolved, vName),
        size: fs.statSync(path.join(resolved, vName)).size,
      },
      srts: matchedSrts.map(s => ({
        name: s,
        path: path.join(resolved, s),
        size: fs.statSync(path.join(resolved, s)).size,
      })),
    };
  });

  // Orphan SRTs (not matching any video)
  const matchedSrtNames = new Set(groups.flatMap(g => g.srts.map(s => s.name)));
  const orphanSrts = srtNames
    .filter(s => !matchedSrtNames.has(s))
    .map(s => ({
      name: s,
      path: path.join(resolved, s),
      size: fs.statSync(path.join(resolved, s)).size,
    }));

  res.json({ dirPath: resolved, groups, orphanSrts });
});

// API: Start processing (video full pipeline or SRT translate-only)
app.post('/api/process', async (req, res) => {
  const { tasks, model, targetLang, whisperModel, sourceLanguage } = req.body;
  if (!tasks || !tasks.length) return res.status(400).json({ error: 'No tasks provided' });

  const translationModel = model || 'grok-3-fast-latest';
  const tLang = targetLang || 'zh-TW';
  const wModel = whisperModel || 'whisper-1';
  const srcLang = sourceLanguage || 'auto';
  const sessionId = uuidv4();
  sseClients.set(sessionId, []);
  res.json({ sessionId, taskCount: tasks.length });

  const concurrency = 3;
  const queue = [...tasks];
  const workers = [];

  for (let w = 0; w < Math.min(concurrency, queue.length); w++) {
    workers.push((async () => {
      while (queue.length > 0) {
        const task = queue.shift();
        if (!task) break;
        if (task.type === 'video') {
          await processVideoFile(task.filePath, translationModel, tLang, wModel, sessionId, task.index, srcLang);
        } else if (task.type === 'srt') {
          await translateSrtFile(task.filePath, translationModel, tLang, sessionId, task.index);
        }
      }
    })());
  }

  Promise.all(workers).then(() => {
    const clients = sseClients.get(sessionId);
    if (clients) {
      const msg = JSON.stringify({ done: true });
      clients.forEach(r => r.write(`data: ${msg}\n\n`));
    }
    setTimeout(() => sseClients.delete(sessionId), 60000);
  });
});

// SSE: Progress stream with heartbeat
app.get('/api/progress/:sessionId', (req, res) => {
  const { sessionId } = req.params;
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  if (!sseClients.has(sessionId)) sseClients.set(sessionId, []);
  sseClients.get(sessionId).push(res);

  // Send heartbeat every 15s to keep connection alive
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  req.on('close', () => {
    clearInterval(heartbeat);
    const clients = sseClients.get(sessionId);
    if (clients) {
      const idx = clients.indexOf(res);
      if (idx >= 0) clients.splice(idx, 1);
    }
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running at http://localhost:${PORT}`);
});
