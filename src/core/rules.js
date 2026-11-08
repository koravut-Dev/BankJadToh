const path = require('path');

const IMG = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg', 'heic', 'tif', 'tiff', 'ico', 'avif'];
const VID = ['mp4', 'mkv', 'mov', 'avi', 'webm', 'wmv', 'flv', 'm4v', 'mpg', 'mpeg'];

const C = (id, th, en, exts, aliases, extra = {}) => ({ id, th, en, exts, aliases, ...extra });

const CATEGORIES = [
  C('captures', 'บันทึกหน้าจอ', 'Captures', [], ['captures', 'screenshots', 'screenshot', 'recordings', 'บันทึกหน้าจอ', 'แคปหน้าจอ'], {
    patterns: [/^(screenshot|screen[ _-]?shot|screen[ _-]?capture|screen[ _-]?recording|capture|snip|recording|record|แคปหน้าจอ|ภาพหน้าจอ)/i],
    patternExts: [...IMG, ...VID],
    monthly: true,
  }),
  C('images', 'รูปภาพ', 'Images', IMG, ['images', 'image', 'pictures', 'photos', 'รูป', 'รูปภาพ']),
  C('documents', 'เอกสาร', 'Documents', ['pdf', 'doc', 'docx', 'txt', 'rtf', 'odt', 'md', 'pages', 'epub', 'mobi'], ['documents', 'docs', 'document', 'เอกสาร']),
  C('spreadsheets', 'ตารางคำนวณ', 'Spreadsheets', ['xls', 'xlsx', 'xlsm', 'csv', 'ods', 'tsv'], ['spreadsheets', 'sheets', 'ตารางคำนวณ']),
  C('presentations', 'งานนำเสนอ', 'Presentations', ['ppt', 'pptx', 'key', 'odp'], ['presentations', 'slides', 'งานนำเสนอ']),
  C('videos', 'วิดีโอ', 'Videos', VID, ['videos', 'video', 'movies', 'วิดีโอ']),
  C('audio', 'เสียงและเพลง', 'Audio', ['mp3', 'wav', 'flac', 'aac', 'm4a', 'ogg', 'wma', 'opus'], ['audio', 'music', 'เพลง', 'เสียงและเพลง']),
  C('archives', 'ไฟล์บีบอัด', 'Archives', ['zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'iso'], ['archives', 'zips', 'compressed', 'ไฟล์บีบอัด']),
  C('installers', 'ตัวติดตั้งโปรแกรม', 'Installers', ['exe', 'msi', 'msix', 'appx', 'msixbundle'], ['installers', 'setup', 'ตัวติดตั้ง', 'ตัวติดตั้งโปรแกรม']),
  C('code', 'โค้ด', 'Code', ['js', 'ts', 'py', 'java', 'cs', 'cpp', 'c', 'h', 'go', 'rs', 'php', 'html', 'css', 'json', 'sql', 'sh', 'ps1', 'bat', 'ipynb', 'yml', 'yaml', 'xml', 'tsx', 'jsx'], ['code', 'src', 'scripts', 'โค้ด']),
  C('design', 'งานดีไซน์', 'Design', ['psd', 'ai', 'fig', 'sketch', 'xd', 'blend', 'afdesign', 'kra'], ['design', 'งานดีไซน์']),
  C('fonts', 'ฟอนต์', 'Fonts', ['ttf', 'otf', 'woff', 'woff2'], ['fonts', 'ฟอนต์']),
];

const byId = Object.fromEntries(CATEGORIES.map((c) => [c.id, c]));
const EXT_MAP = new Map();
for (const c of CATEGORIES) for (const e of c.exts) EXT_MAP.set(e, c);

const SKIP_EXT = new Set(['lnk', 'url', 'ini', 'tmp', 'crdownload', 'part', 'partial', 'download', 'db', 'sys', 'dat', 'opdownload']);

function shouldSkip(name) {
  if (name.startsWith('.') || name.startsWith('~$')) return true;
  const ext = path.extname(name).toLowerCase().slice(1);
  return SKIP_EXT.has(ext);
}

const classifyExt = (ext) => EXT_MAP.get(ext) || null;

function matchCapture(file) {
  const c = byId.captures;
  return c.patternExts.includes(file.ext) && c.patterns.some((p) => p.test(file.name));
}

function customMatch(rule, file, ageDays) {
  const hasPattern = rule.pattern && rule.pattern.trim();
  const hasExts = Array.isArray(rule.exts) && rule.exts.length;
  if (!hasPattern && !hasExts) return false;
  if (hasExts && !rule.exts.map((e) => e.toLowerCase().replace(/^\./, '')).includes(file.ext)) return false;
  if (hasPattern) {
    try {
      if (!new RegExp(rule.pattern, 'iu').test(file.name)) return false;
    } catch { return false; }
  }
  if (rule.minAgeDays && ageDays < rule.minAgeDays) return false;
  return true;
}

module.exports = { CATEGORIES, byId, classifyExt, matchCapture, customMatch, shouldSkip };
