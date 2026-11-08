const fs = require('fs');
const path = require('path');
const { walk } = require('./util');

const NAME_PATTERNS = [
  [/credential/i, 'name:credential'], [/password|passwd|รหัสผ่าน|พาสเวิร์ด/i, 'name:password'], [/secret/i, 'name:secret'],
  [/(^|[._ -])env($|[._ -])|\.env/i, 'name:env'], [/id_(rsa|ed25519|dsa|ecdsa)/i, 'name:sshkey'],
  [/\.(pem|key|pfx|p12|ppk|kdbx|keystore|jks)$/i, 'name:keyfile'], [/token/i, 'name:token'],
  [/api[-_ ]?key|apikey/i, 'name:apikey'], [/private[-_ ]?key/i, 'name:privatekey'], [/seed[-_ ]?phrase|recovery[-_ ]?code|wallet/i, 'name:wallet'],
];

const CONTENT_PATTERNS = [
  ['privateKey', /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/],
  ['awsKey', /AKIA[0-9A-Z]{16}/],
  ['anthropicKey', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['openaiKey', /sk-[A-Za-z0-9]{32,}/],
  ['githubToken', /gh[pousr]_[A-Za-z0-9]{30,}/],
  ['slackToken', /xox[baprs]-[A-Za-z0-9-]{10,}/],
  ['googleKey', /AIza[0-9A-Za-z_-]{35}/],
  ['jwt', /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/],
  ['passwordAssign', /(password|passwd|pwd|secret|api[_-]?key|token|รหัสผ่าน)\s*[:=：]\s*\S{4,}/i],
  ['dbUrl', /(mongodb(\+srv)?|postgres(ql)?|mysql|redis):\/\/[^\s:]+:[^\s@]+@/i],
];

const TEXT_EXTS = new Set(['', 'txt', 'md', 'json', 'env', 'yml', 'yaml', 'ini', 'cfg', 'conf', 'log', 'csv', 'xml', 'js', 'ts', 'py', 'sh', 'ps1', 'properties', 'toml', 'bat', 'rtf']);
const MAX_TEXT = 512 * 1024;

/** Scans folders for files likely to hold secrets. Never returns the secret content itself. */
async function scanSecrets(dirs, { depth = 2 } = {}) {
  const findings = [];
  for (const dir of dirs) {
    await walk(dir, {
      depth,
      max: 8000,
      onFile: async (p, name) => {
        const reasons = [];
        let severity = null;
        for (const [re, label] of NAME_PATTERNS) if (re.test(name)) { reasons.push(label); severity = 'medium'; break; }
        const ext = path.extname(name).toLowerCase().slice(1);
        if (TEXT_EXTS.has(ext)) {
          try {
            const st = await fs.promises.stat(p);
            if (st.size > 0 && st.size <= MAX_TEXT) {
              const text = await fs.promises.readFile(p, 'utf8');
              for (const [label, re] of CONTENT_PATTERNS) if (re.test(text)) { reasons.push('content:' + label); severity = 'high'; }
            }
          } catch { /* unreadable */ }
        }
        if (severity) findings.push({ path: p, name, severity, reasons });
      },
    });
  }
  findings.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'high' ? -1 : 1));
  return findings;
}

module.exports = { scanSecrets };
