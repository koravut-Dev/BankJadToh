const R = (id, name, dest, extra) => ({ id, name, dest, enabled: true, exts: [], pattern: '', minAgeDays: 0, monthly: false, ...extra });

const PACKS = [
  {
    id: 'finance', th: 'การเงินและบัญชี', en: 'Finance & invoices',
    rules: [
      R('pk-fin-invoice', 'Invoices / ใบกำกับภาษี', 'การเงิน\\ใบกำกับภาษี', { pattern: 'invoice|tax[-_ ]?inv|ใบกำกับภาษี|ใบแจ้งหนี้', exts: ['pdf', 'png', 'jpg'] }),
      R('pk-fin-receipt', 'Receipts / ใบเสร็จ', 'การเงิน\\ใบเสร็จ', { pattern: 'receipt|ใบเสร็จ|slip|สลิป', exts: ['pdf', 'png', 'jpg', 'jpeg'], monthly: true }),
    ],
  },
  {
    id: 'developer', th: 'นักพัฒนา', en: 'Developer',
    rules: [
      R('pk-dev-db', 'Database dumps', 'Database', { exts: ['sql', 'bak', 'dump', 'sqlite', 'db3'] }),
      R('pk-dev-api', 'API collections', 'API', { exts: ['har', 'http'], pattern: '' }),
      R('pk-dev-postman', 'Postman / OpenAPI', 'API', { pattern: 'postman|openapi|swagger', exts: ['json', 'yaml', 'yml'] }),
      R('pk-dev-log', 'Logs', 'Logs', { exts: ['log'] }),
    ],
  },
  {
    id: 'student', th: 'นักเรียน/นักศึกษา', en: 'Student',
    rules: [
      R('pk-stu-lecture', 'Lecture notes', 'การเรียน\\สรุป', { pattern: 'lecture|สรุป|note|บทที่|chapter', exts: ['pdf', 'docx', 'pptx'] }),
      R('pk-stu-assign', 'Assignments', 'การเรียน\\งานส่ง', { pattern: 'assignment|homework|งาน|การบ้าน|report|รายงาน', exts: ['pdf', 'docx'] }),
    ],
  },
  {
    id: 'gamer', th: 'เกมเมอร์', en: 'Gamer',
    rules: [
      R('pk-game-saves', 'Game saves & replays', 'Game', { exts: ['sav', 'rofl', 'replay', 'dem'] }),
      R('pk-game-clips', 'Game clips', 'Game\\Clips', { pattern: 'valorant|league|fortnite|overwatch|apex|dota', exts: ['mp4', 'mkv', 'png', 'jpg'], monthly: true }),
    ],
  },
  {
    id: 'designer', th: 'ดีไซเนอร์', en: 'Designer',
    rules: [
      R('pk-des-src', 'Design sources', 'Design\\Source', { exts: ['psd', 'ai', 'fig', 'sketch', 'xd', 'afdesign', 'kra'] }),
      R('pk-des-3d', '3D models', 'Design\\3D', { exts: ['blend', 'fbx', 'obj', 'stl', 'glb', 'gltf'] }),
    ],
  },
];

module.exports = { PACKS };
