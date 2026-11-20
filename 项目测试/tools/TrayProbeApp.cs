// 探针程序：真实 WinForms 消息循环 + NotifyIcon，验证通知区域能否接受新图标。
// 编译：csc /target:winexe /out:TrayProbeApp.exe TrayProbeApp.cs /r:System.Windows.Forms.dll /r:System.Drawing.dll
using System;
using System.Drawing;
using System.IO;
using System.Runtime.InteropServices;
using System.Windows.Forms;

public class TrayProbeApp
{
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    static extern IntPtr FindWindow(string cls, string win);
    [DllImport("user32.dll", CharSet = CharSet.Auto)]
    static extern IntPtr FindWindowEx(IntPtr p, IntPtr a, string cls, string win);
    [DllImport("user32.dll")]
    static extern IntPtr SendMessage(IntPtr h, int msg, IntPtr w, IntPtr l);
    const int TB_BUTTONCOUNT = 0x0418;

    static string LogPath;
    static NotifyIcon Icon;

    static void Log(string s)
    {
        try { File.AppendAllText(LogPath, DateTime.Now.ToString("HH:mm:ss.fff") + " " + s + Environment.NewLine); }
        catch { }
    }

    static int CountTray()
    {
        IntPtr tray = FindWindow("Shell_TrayWnd", null);
        IntPtr notify = FindWindowEx(tray, IntPtr.Zero, "TrayNotifyWnd", null);
        IntPtr pager = FindWindowEx(notify, IntPtr.Zero, "SysPager", null);
        IntPtr tb = FindWindowEx(pager, IntPtr.Zero, "ToolbarWindow32", null);
        return tb == IntPtr.Zero ? -1 : (int)SendMessage(tb, TB_BUTTONCOUNT, IntPtr.Zero, IntPtr.Zero);
    }

    static int CountOverflow()
    {
        IntPtr ov = FindWindow("NotifyIconOverflowWindow", null);
        if (ov == IntPtr.Zero) return -1;
        IntPtr tb = FindWindowEx(ov, IntPtr.Zero, "ToolbarWindow32", null);
        return tb == IntPtr.Zero ? -1 : (int)SendMessage(tb, TB_BUTTONCOUNT, IntPtr.Zero, IntPtr.Zero);
    }

    [STAThread]
    public static void Main(string[] args)
    {
        LogPath = args.Length > 0 ? args[0] : "tray-probe.log";
        string ico = args.Length > 1 ? args[1] : null;
        int seconds = args.Length > 2 ? int.Parse(args[2]) : 8;

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        var ctx = new ApplicationContext();
        Icon = new NotifyIcon();
        if (!string.IsNullOrEmpty(ico) && File.Exists(ico)) Icon.Icon = new Icon(ico, 32, 32);
        else Icon.Icon = SystemIcons.Application;
        Icon.Text = "TrayProbeApp";
        Icon.Visible = true;
        Log("Visible=true tray=" + CountTray() + " overflow=" + CountOverflow());

        var timer = new Timer();
        timer.Interval = 2000;
        int ticks = 0;
        timer.Tick += (s, e) =>
        {
            ticks++;
            Log("tick " + ticks + " tray=" + CountTray() + " overflow=" + CountOverflow());
            if (ticks >= seconds / 2)
            {
                Icon.Visible = false;
                timer.Stop();
                Log("hidden tray=" + CountTray() + " overflow=" + CountOverflow());
                Log("exit");
                ctx.ExitThread();
            }
        };
        timer.Start();

        Log("enter message loop");
        Application.Run(ctx);
        Icon.Dispose();
    }
}
