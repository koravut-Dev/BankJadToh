const fs = require('fs');
const path = require('path');

const HIDDEN_DIR = '.jadtoh-hidden';

const GROUPS = {
  games: ['league', 'valorant', 'riot', 'steam', 'epic games', 'tactics', 'spire', 'simulator', 'minecraft', 'roblox', 'genshin', 'fortnite', 'battle.net', 'dota', 'game', 'garena', 'overwatch', 'roguelike', 'citybuilder', 'escape', 'slay', 'hearthstone', 'ubisoft', 'rockstar', 'pubg', 'apex', 'warframe', 'counter-strike', 'gog galaxy', 'ea app'],
  dev: ['cursor', 'antigravity', 'kiro', 'dbeaver', 'dbgate', 'bruno', 'xampp', 'zap', 'visual studio', 'vscode', 'github', 'docker', 'postman', 'android studio', 'intellij', 'pycharm', 'webstorm', 'terminal', 'putty', 'filezilla', 'git', 'node', 'sourcetree', 'insomnia', 'sublime', 'notepad++'],
  comms: ['line', 'zoom', 'teams', 'slack', 'discord', 'telegram', 'whatsapp', 'skype', 'meet', 'webex', 'messenger'],
  office: ['word', 'excel', 'powerpoint', 'libreoffice', 'sumatra', 'acrobat', 'notion', 'obsidian', 'onenote', 'outlook', 'calc', 'writer', 'translate', 'wps', 'evernote'],
  creative: ['blender', 'photoshop', 'illustrator', 'figma', 'obs', 'davinci', 'premiere', 'after effects', 'sharex', 'canva', 'krita', 'gimp', 'audacity'],
  system: ['cpuid', 'hwmonitor', 'cpu-z', 'g hub', 'anydesk', 'vpn', 'teamviewer', 'msi afterburner', 'ccleaner', 'zap'],
};

// Folder names (and aliases that reuse an existing folder) when shortcuts are filed by group.
const GROUP_LABELS = {
  games: { th: 'เกม', en: 'Games', aliases: ['games', 'game', 'เกม'] },
  dev: { th: 'เครื่องมือ Dev', en: 'Dev tools', aliases: ['dev', 'devtools', 'dev tools', 'development'] },
  comms: { th: 'แชทและประชุม', en: 'Chat & meetings', aliases: ['chat', 'comms', 'communication', 'แชท'] },
  office: { th: 'ออฟฟิศและโน้ต', en: 'Office & notes', aliases: ['office', 'notes', 'ออฟฟิศ'] },
  creative: { th: 'งานสร้างสรรค์', en: 'Creative', aliases: ['creative', 'design'] },
  system: { th: 'ระบบและฮาร์ดแวร์', en: 'System & hardware', aliases: ['system', 'tools', 'utilities', 'ระบบ'] },
};

const MODES = {
  work: { show: ['dev', 'comms', 'office', 'creative', 'system'] },
  game: { show: ['games', 'comms', 'system'] },
  meeting: { show: ['comms', 'office'] },
  all: { show: Object.keys(GROUPS) },
};

function classifyShortcut(fileName) {
  const base = path.basename(fileName, path.extname(fileName)).toLowerCase();
  const words = base.split(/[^a-z0-9+#.฀-๿]+/).filter(Boolean);
  for (const [group, kws] of Object.entries(GROUPS)) {
    for (const k of kws) {
      if (k.length <= 4 ? words.includes(k) : base.includes(k)) return group;
    }
  }
  return null;
}

/**
 * Builds the move list to switch to a mode. Only shortcuts that clearly belong to another group are hidden
 * (moved to a hidden folder); unknown shortcuts always stay visible. Hidden ones are brought back when they fit.
 */
function planMode(desktopDir, modeId, extraDirs = []) {
  const mode = MODES[modeId];
  if (!mode) throw new Error('unknown mode');
  const hiddenDir = path.join(desktopDir, HIDDEN_DIR);
  const items = [];
  const list = (d) => { try { return fs.readdirSync(d, { withFileTypes: true }); } catch { return []; } };
  // Windows shows the user's Desktop and the shared "Public Desktop" together; many installers (games, drivers) use the latter.
  for (const dir of [desktopDir, ...extraDirs]) {
    for (const e of list(dir)) {
      if (!e.isFile() || !/\.(lnk|url)$/i.test(e.name)) continue;
      const g = classifyShortcut(e.name);
      if (g && !mode.show.includes(g)) {
        items.push({ id: path.join(dir, e.name), src: path.join(dir, e.name), name: e.name, dest: hiddenDir, action: 'hide', group: g, category: 'mode', shared: dir !== desktopDir });
      }
    }
  }
  for (const e of list(hiddenDir)) {
    if (!e.isFile()) continue;
    const g = classifyShortcut(e.name);
    if (modeId === 'all' || !g || mode.show.includes(g)) {
      items.push({ id: e.name, src: path.join(hiddenDir, e.name), name: e.name, dest: desktopDir, action: 'show', group: g || '-', category: 'mode' });
    }
  }
  return { items, hiddenDir };
}

module.exports = { MODES, GROUPS, GROUP_LABELS, HIDDEN_DIR, classifyShortcut, planMode };
