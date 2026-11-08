const crypto = require('crypto');
const { execFile } = require('child_process');

/*
 * Windows Hello bridge (Windows 10/11 only, no native addon).
 *
 * A Hello "key credential" is an RSA key that lives in the TPM and can only sign after the user passes the Windows
 * prompt (face / fingerprint / PIN). We ask it to sign a fixed random challenge; RSA PKCS#1 v1.5 is deterministic, so
 * the same signature comes back every time, and SHA-256 of it is the key that wraps the vault's data key. The key
 * therefore never exists on disk or in memory until the user passes Windows Hello. If the signature ever turned out
 * not to be repeatable, enrolment signs twice and refuses, so the user is never left with a broken shortcut.
 *
 * Everything is a thin PowerShell call; the passphrase and recovery key stay the root of trust.
 */

const CRED_NAME = 'BankJadToh.Vault';
const TIMEOUT_MS = 120000;

const PS_HEAD = `
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$asTask=([System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1'})[0]
function Await($op,$type){$t=$asTask.MakeGenericMethod($type).Invoke($null,@($op));$t.Wait(-1)|Out-Null;$t.Result}
[void][Windows.Security.Credentials.KeyCredentialManager,Windows.Security.Credentials,ContentType=WindowsRuntime]
[void][Windows.Security.Credentials.KeyCredentialRetrievalResult,Windows.Security.Credentials,ContentType=WindowsRuntime]
[void][Windows.Security.Cryptography.CryptographicBuffer,Windows.Security.Cryptography,ContentType=WindowsRuntime]
function Fail($code){[Console]::Out.Write('ERR:'+$code);exit 3}
$name='${CRED_NAME}'
`;

const PS_AVAILABLE = PS_HEAD + `
$ok=Await ([Windows.Security.Credentials.KeyCredentialManager]::IsSupportedAsync()) ([bool])
[Console]::Out.Write($(if($ok){'OK:1'}else{'OK:0'}))
`;

// Signs the challenge (base64 in $env:JT_CHALLENGE). mode=enroll creates a fresh credential and signs twice to prove repeatability.
const PS_SIGN = PS_HEAD + `
$mode=$env:JT_MODE
$chal=[Convert]::FromBase64String($env:JT_CHALLENGE)
function Sign($cred){
  $buf=[Windows.Security.Cryptography.CryptographicBuffer]::CreateFromByteArray($chal)
  $r=Await ($cred.RequestSignAsync($buf)) ([Windows.Security.Credentials.KeyCredentialOperationResult])
  if($r.Status -ne 'Success'){Fail ([string]$r.Status)}
  $b=$null;[Windows.Security.Cryptography.CryptographicBuffer]::CopyToByteArray($r.Result,[ref]$b);[Convert]::ToBase64String($b)
}
if($mode -eq 'enroll'){
  $c=Await ([Windows.Security.Credentials.KeyCredentialManager]::RequestCreateAsync($name,[Windows.Security.Credentials.KeyCredentialCreationOption]::ReplaceExisting)) ([Windows.Security.Credentials.KeyCredentialRetrievalResult])
  if($c.Status -ne 'Success'){Fail ([string]$c.Status)}
  $s1=Sign $c.Credential
  $s2=Sign $c.Credential
  if($s1 -ne $s2){Fail 'NotRepeatable'}
  [Console]::Out.Write('SIG:'+$s1)
}elseif($mode -eq 'unlock'){
  $c=Await ([Windows.Security.Credentials.KeyCredentialManager]::OpenAsync($name)) ([Windows.Security.Credentials.KeyCredentialRetrievalResult])
  if($c.Status -ne 'Success'){Fail ([string]$c.Status)}
  [Console]::Out.Write('SIG:'+(Sign $c.Credential))
}elseif($mode -eq 'delete'){
  $asAct=([System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object{$_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction'})[0]
  $asAct.Invoke($null,@([Windows.Security.Credentials.KeyCredentialManager]::DeleteAsync($name))).Wait(-1)|Out-Null
  [Console]::Out.Write('OK:1')
}
`;

const encode = (s) => Buffer.from(s, 'utf16le').toString('base64');

/** Default runner: PowerShell. Resolves with the script's stdout; rejects with Error(message = reason code). */
function psRunner(script, env = {}) {
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('unsupported'));
    const ps = process.env.SystemRoot ? `${process.env.SystemRoot}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe` : 'powershell.exe';
    execFile(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encode(script)],
      { env: { ...process.env, ...env }, windowsHide: true, timeout: TIMEOUT_MS, maxBuffer: 1024 * 1024 },
      (err, stdout) => {
        const out = String(stdout || '').trim();
        if (/^ERR:/.test(out)) return reject(new Error(out.slice(4)));
        if (err) return reject(new Error(err.killed ? 'timeout' : 'failed'));
        resolve(out);
      });
  });
}

class Hello {
  constructor(runner = psRunner) { this.run = runner; }

  /** True when this PC has Windows Hello (or a PIN) set up and usable. Never prompts. */
  async available() {
    try { return (await this.run(PS_AVAILABLE)) === 'OK:1'; } catch { return false; }
  }

  newChallenge() { return crypto.randomBytes(32).toString('base64'); }

  async _sign(mode, challenge) {
    const out = await this.run(PS_SIGN, { JT_MODE: mode, JT_CHALLENGE: challenge });
    if (!out.startsWith('SIG:')) throw new Error('failed');
    return crypto.createHash('sha256').update(Buffer.from(out.slice(4), 'base64')).digest('hex');
  }

  /** Creates the Hello credential (one or two Windows prompts) and returns the secret that wraps the data key. */
  enroll(challenge) { return this._sign('enroll', challenge); }
  /** One Windows prompt; returns the same secret as enroll did. */
  secret(challenge) { return this._sign('unlock', challenge); }
  async remove() { try { await this.run(PS_SIGN, { JT_MODE: 'delete', JT_CHALLENGE: this.newChallenge() }); } catch { /* already gone */ } }
}

module.exports = { Hello, CRED_NAME };
