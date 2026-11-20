'use strict';
/**
 * 本机 PowerShell 脚本调用封装（core/native/ps.js）
 *
 * 用途：Windows 原生能力桥接（WinRT OCR / GDI 区域截图 / 前台窗口提权检测）。
 * 安全：使用 spawn + 参数数组，不拼接命令字符串，避免命令注入；
 *       不向脚本传递任何凭据，脚本仅处理项目内临时文件（FS-03）。
 */
const { spawn } = require('child_process');
const path = require('path');

const PS_EXE = process.platform === 'win32' ? 'powershell.exe' : null;

function scriptPath(name) {
  return path.join(__dirname, '..', '..', '..', 'scripts', name);
}

/**
 * @returns {Promise<{code:number, stdout:string, stderr:string, timedOut:boolean, ms:number}>}
 */
function runPowerShellFile(name, args = [], opts = {}) {
  const { timeoutMs = 20000, signal, cwd } = opts;
  if (!PS_EXE) {
    return Promise.resolve({
      code: -1, stdout: '', stderr: 'windows-only', timedOut: false, ms: 0,
    });
  }
  const file = scriptPath(name);
  const argv = ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file, ...args];
  const started = Date.now();

  return new Promise((resolve) => {
    let done = false;
    const child = spawn(PS_EXE, argv, {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd: cwd || undefined,
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      try { child.kill(); } catch { /* 已退出 */ }
    }, timeoutMs);

    const onAbort = () => { try { child.kill(); } catch { /* 已退出 */ } };
    if (signal) {
      if (signal.aborted) onAbort();
      else signal.addEventListener('abort', onAbort, { once: true });
    }

    child.stdout.on('data', (d) => { stdout += d.toString('utf8'); });
    child.stderr.on('data', (d) => { stderr += d.toString('utf8'); });
    child.on('error', (e) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve({ code: -1, stdout, stderr: stderr + String(e && e.message), timedOut, ms: Date.now() - started });
    });
    child.on('close', (code) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (signal) signal.removeEventListener('abort', onAbort);
      resolve({ code: code == null ? -1 : code, stdout, stderr, timedOut, ms: Date.now() - started });
    });
  });
}

module.exports = { runPowerShellFile, scriptPath, PS_EXE };
