// One door to many AI providers. A "connection" is { id, provider, label, model, baseUrl, keyEnc }.
// Three wire formats cover everything: Anthropic Messages, OpenAI-style chat completions (OpenAI, OpenRouter, DeepSeek, Groq,
// Ollama, LM Studio, any compatible server) and Google Gemini. No SDKs; plain fetch so the audit can list every address.

const PRESETS = [
  { id: 'anthropic', name: 'Anthropic Claude', kind: 'anthropic', baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-5-5', keyHint: 'sk-ant-…' },
  { id: 'openai', name: 'OpenAI', kind: 'openai', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', keyHint: 'sk-…' },
  { id: 'gemini', name: 'Google Gemini', kind: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com', model: 'gemini-2.0-flash', keyHint: 'AIza…' },
  { id: 'openrouter', name: 'OpenRouter', kind: 'openai', baseUrl: 'https://openrouter.ai/api/v1', model: 'openrouter/auto', keyHint: 'sk-or-…' },
  { id: 'deepseek', name: 'DeepSeek', kind: 'openai', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', keyHint: 'sk-…' },
  { id: 'groq', name: 'Groq', kind: 'openai', baseUrl: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile', keyHint: 'gsk_…' },
  { id: 'ollama', name: 'Ollama', kind: 'openai', baseUrl: 'http://localhost:11434/v1', model: 'llama3.2', local: true },
  { id: 'lmstudio', name: 'LM Studio', kind: 'openai', baseUrl: 'http://localhost:1234/v1', model: 'local-model', local: true },
  { id: 'custom', name: 'Custom (OpenAI-compatible)', kind: 'openai', baseUrl: '', model: '', keyHint: 'key', custom: true },
];
const byId = new Map(PRESETS.map((p) => [p.id, p]));
const presetOf = (id) => byId.get(id) || byId.get('custom');

const isPrivateHost = (h) => /^(localhost|127\.\d+\.\d+\.\d+|\[?::1\]?|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|[^.]+\.local)$/i.test(h);

/** Only https, or plain http to this machine / the home network (so a key never crosses the internet unencrypted). */
function validateBase(url) {
  let u;
  try { u = new URL(String(url || '').trim()); } catch { throw new Error('bad address'); }
  if (u.protocol === 'https:') { /* ok */ } else if (u.protocol === 'http:' && isPrivateHost(u.hostname)) { /* ok */ } else throw new Error('address must be https (http only for this PC or your home network)');
  if (u.username || u.password) throw new Error('no credentials inside the address');
  return u.origin + u.pathname.replace(/\/+$/, '');
}

/** Where a connection sends data: host + whether that stays on this machine / LAN. */
function describe(conn) {
  const p = presetOf(conn.provider);
  let host = '', local = false;
  try { const u = new URL(conn.baseUrl || p.baseUrl); host = u.host; local = isPrivateHost(u.hostname); } catch { /* unusable address */ }
  return { host, local, needsKey: !p.local && !(local && p.custom) };
}

async function postJson(url, headers, body, f, ms) {
  const res = await f(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(ms) });
  let data = null;
  try { data = await res.json(); } catch { /* not json */ }
  if (!res.ok) {
    const msg = (data && (data.error?.message || data.error || data.message)) || '';
    const e = new Error(`${res.status} ${typeof msg === 'string' ? msg : JSON.stringify(msg)}`.trim());
    e.status = res.status; e.body = String(msg);
    throw e;
  }
  return data;
}

/** Send one system+user prompt, get plain text back. `key` is the decrypted API key ('' for local servers). */
async function complete({ conn, key, system, user, maxTokens = 1500, fetchImpl = fetch }) {
  const p = presetOf(conn.provider);
  const base = validateBase(conn.baseUrl || p.baseUrl);
  const model = String(conn.model || p.model || '').trim();
  if (!model) throw new Error('no model name');
  const ms = describe(conn).local ? 180000 : 60000; // local models can be slow on a laptop
  try {
    if (p.kind === 'anthropic') {
      const d = await postJson(base + '/v1/messages', { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, { model, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }, fetchImpl, ms);
      return (d.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('');
    }
    if (p.kind === 'gemini') {
      const d = await postJson(`${base}/v1beta/models/${encodeURIComponent(model)}:generateContent`, { 'x-goog-api-key': key },
        { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { maxOutputTokens: maxTokens } }, fetchImpl, ms);
      return ((d.candidates || [])[0]?.content?.parts || []).map((x) => x.text || '').join('');
    }
    const headers = key ? { authorization: 'Bearer ' + key } : {};
    const msgs = [{ role: 'system', content: system }, { role: 'user', content: user }];
    const send = (tokField) => postJson(base + '/chat/completions', headers, { model, messages: msgs, [tokField]: maxTokens }, fetchImpl, ms);
    let d;
    try { d = await send('max_tokens'); } catch (e) { // newer OpenAI models want another field name
      if (e.status === 400 && /max_completion_tokens/.test(e.body)) d = await send('max_completion_tokens'); else throw e;
    }
    const c = (d.choices || [])[0]?.message?.content;
    return Array.isArray(c) ? c.map((x) => x.text || '').join('') : String(c || '');
  } catch (e) {
    const clean = String(e.message || e).split(key || '\u0000').join('***');
    throw new Error(`${p.name}: ${clean}`);
  }
}

/** Old single-key settings -> a connections list (the key stays encrypted exactly as it was). */
function migrate(cfg) {
  if (Array.isArray(cfg.aiConns)) return false;
  cfg.aiConns = [];
  if (cfg.aiKeyEnc) { cfg.aiConns.push({ id: 'c-legacy', provider: 'anthropic', label: 'Anthropic Claude', model: byId.get('anthropic').model, baseUrl: '', keyEnc: cfg.aiKeyEnc }); cfg.aiActive = 'c-legacy'; }
  delete cfg.aiKeyEnc;
  return true;
}

module.exports = { PRESETS, presetOf, validateBase, describe, complete, migrate, isPrivateHost };
