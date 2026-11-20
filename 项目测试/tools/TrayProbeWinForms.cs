using System;
using System.Drawing;
using System.Windows.Forms;

// Minimal WinForms notification-area probe: does a plain NotifyIcon register in THIS session?
// Usage: TrayProbeWinForms.exe [iconPath] [seconds]
internal static class Program
{
    [STAThread]
    private static void Main(string[] args)
    {
        string iconPath = args.Length > 0 ? args[0] : "";
        int seconds = args.Length > 1 ? int.Parse(args[1]) : 20;

        Application.EnableVisualStyles();
        Application.SetCompatibleTextRenderingDefault(false);

        var tray = new NotifyIcon();
        Icon icon = null;
        if (iconPath.Length > 0 && System.IO.File.Exists(iconPath))
        {
            try { icon = new Icon(iconPath); } catch { icon = null; }
        }
        tray.Icon = icon != null ? icon : SystemIcons.Application;
        tray.Text = "JIYI tray probe";
        var menu = new ContextMenuStrip();
        menu.Items.Add("open");
        menu.Items.Add("exit");
        tray.ContextMenuStrip = menu;
        tray.Visible = true;

        var timer = new Timer();
        timer.Interval = seconds * 1000;
        timer.Tick += delegate
        {
            tray.Visible = false;
            tray.Dispose();
            Application.Exit();
        };
        timer.Start();

        Application.Run();
        Environment.Exit(0);
    }
}
