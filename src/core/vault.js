const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { uniquePath } = require('./util');

/*
 * Vault design (v2)
 *  - One random 256-bit Data Key (DK) encrypts every file (AES-256-GCM).
 *  - DK is stored wrapped twice: once by a key derived from the user's passphrase, once by a key derived from a
 *    random Recovery Key (shown to the user exactly once). Either one opens the vault; neither is stored.
 *  - The passphrase hint is stored in plain text on purpose (it is a hint, never the passphrase).
 *  - Legacy (v1) entries used a separate passphrase per file; they still open with that passphrase.
 */

const MAGIC = Buffer.from('JTV1');
const MAGIC2 = Buffer.from('JTV2');
const SCRYPT = { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
const RK_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // 32 symbols, no 0/O/1/I

/* ---------- legacy v1 (per-file passphrase) ---------- */
function encryptBuffer(data, name, pass) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(pass, salt, 32);
  const nameBuf = Buffer.from(name, 'utf8');
  const head = Buffer.alloc(2); head.writeUInt16BE(nameBuf.length);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const enc = Buffer.concat([c.update(Buffer.concat([head, nameBuf, data])), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), enc]);
}

function decryptBuffer(buf, pass) {
  if (buf.length < 48 || !buf.subarray(0, 4).equals(MAGIC)) throw new Error('not a vault file');
  const salt = buf.subarray(4, 20), iv = buf.subarray(20, 32), tag = buf.subarray(32, 48);
  const key = crypto.scryptSync(pass, salt, 32);
  const d = crypto.createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 });
  d.setAuthTag(tag);
  let plain;
  try { plain = Buffer.concat([d.update(buf.subarray(48)), d.final()]); } catch { throw new Error('wrong passphrase'); }
  const n = plain.readUInt16BE(0);
  return { name: plain.subarray(2, 2 + n).toString('utf8'), data: plain.subarray(2 + n) };
}

/* ---------- v2 helpers ---------- */
const normRecovery = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function genRecoveryKey() {
  let s = '';
  for (let i = 0; i < 25; i++) s += RK_ALPHABET[crypto.randomInt(32)]; // 25 x 5 bits = 125 bits
  return s.match(/.{5}/g).join('-');
}

function wrapKey(dk, secret) {
  const salt = crypto.randomBytes(16), iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(secret, salt, 32, SCRYPT);
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([c.update(dk), c.final()]);
  return { salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), ct: ct.toString('base64') };
}

function unwrapKey(w, secret) {
  const key = crypto.scryptSync(secret, Buffer.from(w.salt, 'base64'), 32, SCRYPT);
  const tag = Buffer.from(w.tag, 'base64');
  if (tag.length !== 16) throw new Error('wrong passphrase'); // a shortened tag would be much easier to forge
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(w.iv, 'base64'), { authTagLength: 16 });
  d.setAuthTag(tag);
  try { return Buffer.concat([d.update(Buffer.from(w.ct, 'base64')), d.final()]); } catch { throw new Error('wrong passphrase'); }
}

function encryptWithKey(dk, name, data) {
  const iv = crypto.randomBytes(12);
  const nameBuf = Buffer.from(name, 'utf8');
  const head = Buffer.alloc(2); head.writeUInt16BE(nameBuf.length);
  const c = crypto.createCipheriv('aes-256-gcm', dk, iv);
  const enc = Buffer.concat([c.update(Buffer.concat([head, nameBuf, data])), c.final()]);
  return Buffer.concat([MAGIC2, iv, c.getAuthTag(), enc]);
}

function decryptWithKey(dk, buf) {
  if (buf.length < 32 || !buf.subarray(0, 4).equals(MAGIC2)) throw new Error('not a v2 vault file');
  const d = crypto.createDecipheriv('aes-256-gcm', dk, buf.subarray(4, 16), { authTagLength: 16 });
  d.setAuthTag(buf.subarray(16, 32));
  let plain;
  try { plain = Buffer.concat([d.update(buf.subarray(32)), d.final()]); } catch { throw new Error('vault file is damaged or the key is wrong'); }
  const n = plain.readUInt16BE(0);
  return { name: plain.subarray(2, 2 + n).toString('utf8'), data: plain.subarray(2 + n) };
}

class Vault {
  constructor(dir) {
    this.dir = dir;
    this.indexFile = path.join(dir, 'index.json');
    this.index = [];
    this.meta = null;
    try {
      const j = JSON.parse(fs.readFileSync(this.indexFile, 'utf8'));
      if (Array.isArray(j)) this.index = j; // legacy file: plain array of entries
      else { this.index = j.entries || []; this.meta = j.meta || null; }
    } catch { /* empty vault */ }
  }
  _save() {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(this.indexFile, JSON.stringify({ version: 2, meta: this.meta, entries: this.index }));
  }
  list() { return this.index; }
  isInitialized() { return !!(this.meta && this.meta.wrapPass); }
  hint() { return (this.meta && this.meta.hint) || ''; }

  /** First-time setup: returns { dk, recoveryKey }. The recovery key is NOT stored; show it once. */
  setup(pass, hint = '') {
    if (this.isInitialized()) throw new Error('already set up');
    if (!pass || pass.length < 8) throw new Error('passphrase too short');
    const dk = crypto.randomBytes(32);
    const recoveryKey = genRecoveryKey();
    this.meta = { wrapPass: wrapKey(dk, pass), wrapRec: wrapKey(dk, normRecovery(recoveryKey)), hint: String(hint || '').slice(0, 160), created: Date.now() };
    this._save();
    return { dk, recoveryKey };
  }

  /** mode: 'pass' | 'recovery'. Throws Error('wrong passphrase') on failure. */
  unlock(secret, mode = 'pass') {
    if (!this.isInitialized()) throw new Error('not set up');
    return mode === 'recovery' ? unwrapKey(this.meta.wrapRec, normRecovery(secret)) : unwrapKey(this.meta.wrapPass, String(secret || ''));
  }

  setHint(hint) { this.meta.hint = String(hint || '').slice(0, 160); this._save(); }

  /** Change the passphrase (needs the unlocked DK). The recovery key keeps working. */
  rewrap(dk, newPass) {
    if (!newPass || newPass.length < 8) throw new Error('passphrase too short');
    this.meta.wrapPass = wrapKey(dk, newPass);
    this._save();
  }

  /** Encrypt a file with the DK and verify it decrypts to identical bytes. Caller removes the original. */
  addFile(srcPath, dk) {
    const data = fs.readFileSync(srcPath);
    const name = path.basename(srcPath);
    const enc = encryptWithKey(dk, name, data);
    if (!decryptWithKey(dk, enc).data.equals(data)) throw new Error('verification failed');
    const id = crypto.randomBytes(8).toString('hex');
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, id + '.jtv'), enc);
    const entry = { id, name, size: data.length, added: Date.now(), v: 2, origin: path.resolve(srcPath) };
    this.index.push(entry);
    this._save();
    return entry;
  }

  _read(id, dk) {
    const e = this.index.find((x) => x.id === id);
    if (!e || e.v !== 2) throw new Error('not found');
    return { e, ...decryptWithKey(dk, fs.readFileSync(path.join(this.dir, id + '.jtv'))) };
  }

  /** Put the file back where it came from (or in fallbackDir) and take it OUT of the vault: no duplicate copies. */
  restore(id, dk, fallbackDir) {
    const { e, name, data } = this._read(id, dk);
    let dir = e.origin ? path.dirname(e.origin) : fallbackDir;
    if (!dir || !fs.existsSync(dir)) dir = fallbackDir;
    fs.mkdirSync(dir, { recursive: true });
    const out = uniquePath(path.join(dir, name));
    fs.writeFileSync(out, data);
    this.remove(id);
    return out;
  }

  /** Decrypt into a fresh temp folder for viewing. The caller must delete `dir` afterwards. */
  viewTemp(id, dk) {
    const { name, data } = this._read(id, dk);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jadtoh-view-'));
    const out = path.join(dir, name);
    fs.writeFileSync(out, data);
    return { path: out, dir };
  }

  /** Upgrade a legacy per-file-passphrase entry to the master key. */
  migrate(id, oldPass, dk) {
    const e = this.index.find((x) => x.id === id);
    if (!e || e.v === 2) throw new Error('not a legacy entry');
    const { name, data } = decryptBuffer(fs.readFileSync(path.join(this.dir, id + '.jtv')), oldPass);
    const enc = encryptWithKey(dk, name, data);
    if (!decryptWithKey(dk, enc).data.equals(data)) throw new Error('verification failed');
    fs.writeFileSync(path.join(this.dir, id + '.jtv'), enc);
    e.v = 2; e.origin = e.origin || null;
    this._save();
    return e;
  }

  /* ----- legacy v1 API (kept: old entries still need it) ----- */
  add(srcPath, pass) {
    if (!pass || pass.length < 8) throw new Error('passphrase too short');
    const data = fs.readFileSync(srcPath);
    const name = path.basename(srcPath);
    const enc = encryptBuffer(data, name, pass);
    const check = decryptBuffer(enc, pass);
    if (!check.data.equals(data)) throw new Error('verification failed');
    const id = crypto.randomBytes(8).toString('hex');
    fs.mkdirSync(this.dir, { recursive: true });
    fs.writeFileSync(path.join(this.dir, id + '.jtv'), enc);
    const entry = { id, name, size: data.length, added: Date.now() };
    this.index.push(entry);
    this._save();
    return entry;
  }

  extract(id, pass, destDir) {
    const e = this.index.find((x) => x.id === id);
    if (!e) throw new Error('not found');
    const { name, data } = decryptBuffer(fs.readFileSync(path.join(this.dir, id + '.jtv')), pass);
    fs.mkdirSync(destDir, { recursive: true });
    const out = uniquePath(path.join(destDir, name));
    fs.writeFileSync(out, data);
    return out;
  }

  /** Legacy entry: decrypt with its own passphrase, write out, and remove it from the vault (no leftover copy). */
  legacyRestore(id, pass, destDir) {
    const out = this.extract(id, pass, destDir);
    this.remove(id);
    return out;
  }

  remove(id) {
    this.index = this.index.filter((x) => x.id !== id);
    try { fs.unlinkSync(path.join(this.dir, id + '.jtv')); } catch { /* gone */ }
    this._save();
  }
}

module.exports = { Vault, encryptBuffer, decryptBuffer, genRecoveryKey };
