using System;
using System.Diagnostics;
using System.IO;
using System.Text;
using System.Threading;
using System.Windows.Forms;

namespace DesktopTranslator
{
    /// <summary>
    /// 即译（jiyi）启动器。
    ///
    /// 为什么需要它：Chromium 在部分 Windows 环境下（禁用/损坏的应用容器、受限的
    /// 进程创建策略、某些安全软件拦截）初始化沙箱时会直接崩溃（退出码 0x80000003
    /// 或 0xC0000005），进程甚至来不及执行应用自身的错误处理，用户看到的就是
    /// 「双击没反应」。这类降级开关（--no-sandbox / --disable-gpu）必须作为
    /// 真实命令行参数传入，Electron 内部 appendSwitch 再设置已经太晚。
    ///
    /// 因此本启动器负责：
    ///   1. 正常启动核心程序（app\jiyi-core.exe）；
    ///   2. 若核心程序在短时间内以崩溃码退出，自动改用兼容模式参数重试一次；
    ///   3. 仍失败则弹出对话框并写入 userdata\launcher.log，避免「静默打不开」。
    /// </summary>
    internal static class Launcher
    {
        private const int CrashBreakpoint = unchecked((int)0x80000003);
        private const int CrashAccessViolation = unchecked((int)0xC0000005);
        private const int CrashDllInitFailed = unchecked((int)0xC0000142);

        private static string _exeDir;
        private static string _dataDir;
        private static string _logFile;
        private static string _coreLogFile;
        private static readonly object CoreLogLock = new object();

        private static int Main(string[] args)
        {
            _exeDir = AppDomain.CurrentDomain.BaseDirectory;
            _dataDir = Path.Combine(_exeDir, "userdata");
            _logFile = Path.Combine(_dataDir, "launcher.log");
            _coreLogFile = Path.Combine(_dataDir, "core.log");

            string core = FindCore(_exeDir);
            if (core == null)
            {
                Fail("找不到主程序：app\\jiyi-core.exe\n请确认解压完整，或重新解压压缩包。");
                return 3;
            }

            try { Directory.CreateDirectory(_dataDir); }
            catch { /* 只读目录时不阻塞启动，日志写入会失败但不影响运行 */ }

            bool safeMode = File.Exists(Path.Combine(_dataDir, "safe-mode.flag"));
            if (safeMode) Log("已处于兼容模式（userdata\\safe-mode.flag）");

            long elapsedMs = 0;
            int code = RunCore(core, args, safeMode, ref elapsedMs);

            if (code == 0) return 0;

            if (!safeMode && IsCrash(code))
            {
                Log(string.Format("核心程序异常退出：0x{0:X8}（耗时 {1} ms），改用兼容模式重试", code, elapsedMs));
                TryWrite(Path.Combine(_dataDir, "safe-mode.flag"), "auto");
                code = RunCore(core, args, true, ref elapsedMs);
                if (code == 0) return 0;
                Log(string.Format("兼容模式仍然失败：0x{0:X8}", code));
            }

            Fail(string.Format(
                "即译启动失败（退出码 0x{0:X8}）。\n\n"
                + "已尝试兼容模式（--no-sandbox --disable-gpu）仍未成功。\n"
                + "排查信息：{1}\n\n"
                + "常见原因：安全软件拦截、Windows 版本过旧、解压不完整。",
                code, _logFile));
            return 1;
        }

        private static string FindCore(string dir)
        {
            string[] candidates = new string[]
            {
                Path.Combine(dir, "app", "jiyi-core.exe"),
                Path.Combine(dir, "app", "DesktopTranslator-core.exe"),
            };
            foreach (string path in candidates)
            {
                if (File.Exists(path)) return path;
            }
            return null;
        }

        private static bool IsCrash(int code)
        {
            return code == CrashBreakpoint || code == CrashAccessViolation || code == CrashDllInitFailed;
        }

        private static int RunCore(string core, string[] args, bool safeMode, ref long elapsedMs)
        {
            StringBuilder argv = new StringBuilder();
            argv.Append("--user-data-dir=\"").Append(Path.Combine(_dataDir, "electron-userdata")).Append("\"");
            if (safeMode) argv.Append(" --no-sandbox --disable-gpu");

            foreach (string a in args)
            {
                if (a.StartsWith("--user-data-dir=", StringComparison.OrdinalIgnoreCase)) continue;
                if (a == "--no-sandbox" || a == "--disable-gpu") continue;
                argv.Append(' ').Append(a.IndexOf(' ') >= 0 ? "\"" + a + "\"" : a);
            }

            ProcessStartInfo psi = new ProcessStartInfo(core, argv.ToString());
            psi.UseShellExecute = false;
            psi.WorkingDirectory = Path.Combine(_exeDir, "app");
            // 把核心程序的标准输出/错误重定向到文件：
            // 1) 避免核心程序的日志把父进程（终端/CI 的管道）写满而卡死；
            // 2) 用户反馈问题时可以直接看 userdata\core.log。
            psi.RedirectStandardOutput = true;
            psi.RedirectStandardError = true;
            psi.CreateNoWindow = true;
            // 明确告诉应用数据目录应放在启动器所在目录下，避免核心程序按自身 exe 位置推导到 app\userdata
            try { psi.EnvironmentVariables["DT_DATA_DIR"] = _dataDir; } catch { }
            // 关键：若父进程（CI、某些终端、调试环境）设置了 ELECTRON_RUN_AS_NODE，
            // Electron 会退化成纯 Node 运行并报 "bad option"，必须剔除
            try
            {
                psi.EnvironmentVariables.Remove("ELECTRON_RUN_AS_NODE");
                psi.EnvironmentVariables.Remove("ELECTRON_NO_ATTACH_CONSOLE");
            }
            catch { }

            Stopwatch watch = Stopwatch.StartNew();
            Process p = Process.Start(psi);
            if (p == null)
            {
                elapsedMs = 0;
                return CrashDllInitFailed;
            }
            p.OutputDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) CoreLog(e.Data); };
            p.ErrorDataReceived += delegate(object s, DataReceivedEventArgs e) { if (e.Data != null) CoreLog(e.Data); };
            try
            {
                p.BeginOutputReadLine();
                p.BeginErrorReadLine();
            }
            catch { /* 读流失败不影响启动 */ }
            p.WaitForExit();
            watch.Stop();
            elapsedMs = watch.ElapsedMilliseconds;
            Log(string.Format("核心程序退出 code=0x{0:X8} 耗时 {1} ms 参数：{2}", p.ExitCode, elapsedMs, argv));
            return p.ExitCode;
        }

        private static void Log(string message)
        {
            try
            {
                File.AppendAllText(_logFile, DateTime.Now.ToString("yyyy-MM-dd HH:mm:ss") + " " + message + Environment.NewLine, Encoding.UTF8);
            }
            catch { /* 日志失败不影响主流程 */ }
        }

        /// <summary>核心程序的 stdout/stderr 落盘（userdata\core.log），便于用户反馈问题</summary>
        private static void CoreLog(string line)
        {
            try
            {
                lock (CoreLogLock)
                {
                    File.AppendAllText(_coreLogFile, line + Environment.NewLine, Encoding.UTF8);
                }
            }
            catch { /* 日志失败不影响主流程 */ }
        }

        private static void TryWrite(string path, string content)
        {
            try { File.WriteAllText(path, content, Encoding.UTF8); } catch { }
        }

        private static void Fail(string message)
        {
            Log("失败：" + message.Replace(Environment.NewLine, " | "));
            try { MessageBox.Show(message, "即译", MessageBoxButtons.OK, MessageBoxIcon.Error); }
            catch { }
        }
    }
}
