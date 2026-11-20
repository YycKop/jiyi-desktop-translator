// 读取自检报告并打印关键断言（避免 PowerShell 引号转义问题）
const fs = require('fs');
const file = process.argv[2];
const r = JSON.parse(fs.readFileSync(file, 'utf8'));
const keys = ['inputPane', 'inputCountSync', 'quitButton', 'settingsCloseMinimizes', 'jumpList', 'trayCreated', 'settingsToggle', 'hudResize', 'hudReadableApplied', 'settingsCloseHides', 'trayMenuItems'];
const out = { ok: r.ok, errs: (r.rendererErrors || []).length, shots: (r.shots || []).length };
for (const k of keys) out[k] = r.checks ? r.checks[k] : undefined;
if (r.hudResizeDelta) out.resizeDelta = r.hudResizeDelta;
console.log(JSON.stringify(out, null, 2));
