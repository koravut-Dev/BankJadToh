// Read / move desktop icons by talking to Explorer's desktop ListView (SysListView32) with Win32 messages.
// Runs in a short-lived PowerShell process (no native modules to compile or ship).
// Notes: Explorer owns the ListView, so item text/positions are read through its memory
// (VirtualAllocEx + ReadProcessMemory), which works for a normal user because it is the same user's process.

const { execFile } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
Add-Type -TypeDefinition @"
using System; using System.Runtime.InteropServices; using System.Text;
public static class DI {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr FindWindow(string c, string w);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern IntPtr FindWindowEx(IntPtr p, IntPtr a, string c, string w);
  [DllImport("user32.dll")] static extern IntPtr SendMessage(IntPtr h, int m, IntPtr w, IntPtr l);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr h, out RECT r);
  [DllImport("user32.dll", EntryPoint="GetWindowLongPtrW")] static extern IntPtr GetWindowLongPtr(IntPtr h, int i);
  delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumProc cb, IntPtr l);
  [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint a, bool i, uint pid);
  [DllImport("kernel32.dll")] static extern IntPtr VirtualAllocEx(IntPtr p, IntPtr a, UIntPtr s, uint t, uint pr);
  [DllImport("kernel32.dll")] static extern bool VirtualFreeEx(IntPtr p, IntPtr a, UIntPtr s, uint t);
  [DllImport("kernel32.dll")] static extern bool ReadProcessMemory(IntPtr p, IntPtr a, byte[] b, int s, out IntPtr r);
  [DllImport("kernel32.dll")] static extern bool WriteProcessMemory(IntPtr p, IntPtr a, byte[] b, int s, out IntPtr w);
  [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr h);

  public static IntPtr ListView;
  static IntPtr proc, remote;

  public static bool Open() {
    if (IntPtr.Size != 8) throw new Exception("64-bit PowerShell required");
    IntPtr prog = FindWindow("Progman", null);
    IntPtr def = FindWindowEx(prog, IntPtr.Zero, "SHELLDLL_DefView", null);
    if (def == IntPtr.Zero) {
      IntPtr found = IntPtr.Zero;
      EnumWindows(delegate(IntPtr h, IntPtr l) { IntPtr d = FindWindowEx(h, IntPtr.Zero, "SHELLDLL_DefView", null); if (d != IntPtr.Zero) { found = d; return false; } return true; }, IntPtr.Zero);
      def = found;
    }
    ListView = FindWindowEx(def, IntPtr.Zero, "SysListView32", null);
    if (ListView == IntPtr.Zero) return false;
    uint pid; GetWindowThreadProcessId(ListView, out pid);
    proc = OpenProcess(0x0008 | 0x0010 | 0x0020 | 0x0400, false, pid); // VM_OPERATION | VM_READ | VM_WRITE | QUERY_INFORMATION
    if (proc == IntPtr.Zero) throw new Exception("cannot open Explorer process");
    remote = VirtualAllocEx(proc, IntPtr.Zero, (UIntPtr)4096, 0x3000, 0x04);
    return remote != IntPtr.Zero;
  }
  public static void Close() { if (proc != IntPtr.Zero) { VirtualFreeEx(proc, remote, UIntPtr.Zero, 0x8000); CloseHandle(proc); proc = IntPtr.Zero; } }
  public static int Count() { return (int)SendMessage(ListView, 0x1004, IntPtr.Zero, IntPtr.Zero); }
  public static int Style() { return (int)GetWindowLongPtr(ListView, -16); }
  public static int ExStyle() { return (int)SendMessage(ListView, 0x1037, IntPtr.Zero, IntPtr.Zero); }
  public static int[] Spacing() { int v = (int)SendMessage(ListView, 0x1033, IntPtr.Zero, IntPtr.Zero); return new int[] { v & 0xFFFF, (v >> 16) & 0xFFFF }; }
  public static int[] Area() { RECT r; GetClientRect(ListView, out r); return new int[] { r.R - r.L, r.B - r.T }; }
  public static string Text(int i) {
    byte[] lvi = new byte[88];
    BitConverter.GetBytes(1).CopyTo(lvi, 0);                       // LVIF_TEXT
    BitConverter.GetBytes(i).CopyTo(lvi, 4);                       // iItem
    BitConverter.GetBytes((long)remote + 256).CopyTo(lvi, 24);     // pszText
    BitConverter.GetBytes(260).CopyTo(lvi, 32);                    // cchTextMax
    IntPtr n; WriteProcessMemory(proc, remote, lvi, lvi.Length, out n);
    SendMessage(ListView, 0x1073, (IntPtr)i, remote);              // LVM_GETITEMTEXTW
    byte[] buf = new byte[520]; ReadProcessMemory(proc, (IntPtr)((long)remote + 256), buf, buf.Length, out n);
    string s = Encoding.Unicode.GetString(buf); int z = s.IndexOf('\0'); return z >= 0 ? s.Substring(0, z) : s;
  }
  public static int[] Pos(int i) {
    SendMessage(ListView, 0x1010, (IntPtr)i, (IntPtr)((long)remote + 512)); // LVM_GETITEMPOSITION
    byte[] b = new byte[8]; IntPtr n; ReadProcessMemory(proc, (IntPtr)((long)remote + 512), b, 8, out n);
    return new int[] { BitConverter.ToInt32(b, 0), BitConverter.ToInt32(b, 4) };
  }
  public static void SetPos(int i, int x, int y) { // LVM_SETITEMPOSITION, lParam = MAKELPARAM(x, y)
    uint lp = ((uint)(y & 0xFFFF) << 16) | (uint)(x & 0xFFFF);
    SendMessage(ListView, 0x100F, (IntPtr)i, (IntPtr)(long)lp);
  }
}
"@

try {
  if (-not [DI]::Open()) { @{ error = 'no-listview' } | ConvertTo-Json -Compress; exit 0 }
  $style = [DI]::Style(); $ex = [DI]::ExStyle()
  $count = [DI]::Count()
  if ($env:JT_ACTION -eq 'list') {
    $items = @(); for ($i = 0; $i -lt $count; $i++) { $p = [DI]::Pos($i); $items += [pscustomobject]@{ i = $i; name = [DI]::Text($i); x = $p[0]; y = $p[1] } }
    $sp = [DI]::Spacing(); $ar = [DI]::Area()
    [pscustomobject]@{ count = $count; autoArrange = [bool]($style -band 0x100); snapToGrid = [bool]($ex -band 0x80000); cellW = $sp[0]; cellH = $sp[1]; areaW = $ar[0]; areaH = $ar[1]; items = $items } | ConvertTo-Json -Compress -Depth 4
  }
  elseif ($env:JT_ACTION -eq 'set') {
    if ($style -band 0x100) { @{ error = 'autoarrange' } | ConvertTo-Json -Compress; exit 0 }
    $want = Get-Content -Raw -Encoding UTF8 $env:JT_FILE | ConvertFrom-Json
    $names = @{}; for ($i = 0; $i -lt $count; $i++) { $n = [DI]::Text($i); if (-not $names.ContainsKey($n)) { $names[$n] = New-Object System.Collections.ArrayList }; [void]$names[$n].Add($i) }
    $moved = 0; $missing = 0
    foreach ($w in @($want)) {
      if ($names.ContainsKey($w.name) -and $names[$w.name].Count -gt 0) { $idx = $names[$w.name][0]; $names[$w.name].RemoveAt(0); [DI]::SetPos([int]$idx, [int]$w.x, [int]$w.y); $moved++ } else { $missing++ }
    }
    @{ moved = $moved; missing = $missing } | ConvertTo-Json -Compress
  }
} finally { [DI]::Close() }
`;

const encoded = Buffer.from(SCRIPT, 'utf16le').toString('base64');

function run(action, payload) {
  return new Promise((resolve, reject) => {
    let file = '';
    const env = { ...process.env, JT_ACTION: action };
    if (payload) {
      file = path.join(os.tmpdir(), `jadtoh-icons-${process.pid}-${Date.now()}.json`);
      fs.writeFileSync(file, JSON.stringify(payload), 'utf8');
      env.JT_FILE = file;
    }
    execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-EncodedCommand', encoded],
      { env, windowsHide: true, timeout: 30000, maxBuffer: 16e6 }, (err, stdout, stderr) => {
        if (file) { try { fs.unlinkSync(file); } catch { /* ignore */ } }
        if (err) return reject(new Error((stderr || err.message).toString().slice(0, 400)));
        try { resolve(JSON.parse(stdout.trim())); } catch { reject(new Error('unexpected output: ' + stdout.slice(0, 200))); }
      });
  });
}

module.exports = {
  listIcons: () => run('list'),
  setIcons: (positions) => run('set', positions),
};
