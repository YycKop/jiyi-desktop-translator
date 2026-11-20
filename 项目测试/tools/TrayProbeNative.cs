using System;
using System.ComponentModel;
using System.Drawing;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;

// Reports whether Shell_NotifyIcon(NIM_ADD) actually succeeds in this session,
// together with the Win32 error code and the integrity level of this process.
internal static class Program
{
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct NOTIFYICONDATA
    {
        public int cbSize;
        public IntPtr hWnd;
        public uint uID;
        public uint uFlags;
        public uint uCallbackMessage;
        public IntPtr hIcon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string szTip;
        public uint dwState;
        public uint dwStateMask;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string szInfo;
        public uint uVersion;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string szInfoTitle;
        public uint dwInfoFlags;
        public Guid guidItem;
        public IntPtr hBalloonIcon;
    }

    [DllImport("shell32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    private static extern bool Shell_NotifyIcon(uint message, ref NOTIFYICONDATA data);

    [DllImport("user32.dll", SetLastError = true)]
    private static extern IntPtr CreateWindowEx(uint exStyle, string cls, string name, uint style,
        int x, int y, int w, int h, IntPtr parent, IntPtr menu, IntPtr inst, IntPtr param);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(IntPtr token, int cls, out int info, int len, out int ret);

    private const uint NIM_ADD = 0;
    private const uint NIM_DELETE = 2;
    private const uint NIF_MESSAGE = 0x01;
    private const uint NIF_ICON = 0x02;
    private const uint NIF_TIP = 0x04;
    private const uint NIF_SHOWTIP = 0x80;
    private const uint TOKEN_QUERY = 0x0008;
    private const int TokenIntegrityLevel = 25;

    private static string Integrity()
    {
        IntPtr token;
        if (!OpenProcessToken(System.Diagnostics.Process.GetCurrentProcess().Handle, TOKEN_QUERY, out token))
            return "unknown(OpenProcessToken failed " + Marshal.GetLastWin32Error() + ")";
        int size;
        GetTokenInformation(token, TokenIntegrityLevel, out size, 4, out size);
        return "sidLen=" + size;
    }

    [STAThread]
    private static void Main(string[] args)
    {
        var log = new StringBuilder();
        log.AppendLine("session=" + System.Diagnostics.Process.GetCurrentProcess().SessionId);
        log.AppendLine("elevated=" + (new System.Security.Principal.WindowsPrincipal(
            System.Security.Principal.WindowsIdentity.GetCurrent()))
            .IsInRole(System.Security.Principal.WindowsBuiltInRole.Administrator));
        log.AppendLine("integrity=" + Integrity());

        IntPtr hwnd = CreateWindowEx(0, "STATIC", "jiyi-tray-probe", 0, 0, 0, 0, 0,
            IntPtr.Zero, IntPtr.Zero, IntPtr.Zero, IntPtr.Zero);
        log.AppendLine("hwnd=0x" + hwnd.ToInt64().ToString("X") + " err=" + Marshal.GetLastWin32Error());

        var data = new NOTIFYICONDATA();
        data.cbSize = Marshal.SizeOf(typeof(NOTIFYICONDATA));
        data.hWnd = hwnd;
        data.uID = 1;
        data.uFlags = NIF_MESSAGE | NIF_ICON | NIF_TIP;
        data.uCallbackMessage = 0x0400 + 100;
        data.szTip = "jiyi tray probe";
        data.hIcon = SystemIcons.Application.Handle;

        // 1) Try the classic per-window icon, then read back the error code.
        bool added = Shell_NotifyIcon(NIM_ADD, ref data);
        int addError = Marshal.GetLastWin32Error();
        log.AppendLine("NIM_ADD ok=" + added + " GetLastError=" + addError + " (" + new Win32Exception(addError).Message + ")");

        // 2) Try again with a GUID identity (the shell keeps GUID icons per-app, not per-window).
        if (!added)
        {
            data.guidItem = new Guid("9E6A1C1B-2A2E-4A32-9C4B-9F00A11B2233");
            data.uFlags |= NIF_SHOWTIP;
            bool added2 = Shell_NotifyIcon(NIM_ADD, ref data);
            int err2 = Marshal.GetLastWin32Error();
            log.AppendLine("NIM_ADD(guid) ok=" + added2 + " GetLastError=" + err2 + " (" + new Win32Exception(err2).Message + ")");
            if (added2) { added = true; }
        }

        log.AppendLine("final added=" + added);

        string outPath = args.Length > 0 ? args[0] : "tray-native-probe.log";
        System.IO.File.WriteAllText(outPath, log.ToString());

        if (added)
        {
            Application.EnableVisualStyles();
            var timer = new Timer();
            timer.Interval = (args.Length > 1 ? int.Parse(args[1]) : 20) * 1000;
            timer.Tick += delegate { Shell_NotifyIcon(NIM_DELETE, ref data); Application.Exit(); };
            timer.Start();
            var host = new Form { Text = "probe", ShowInTaskbar = false, Opacity = 0, Width = 1, Height = 1 };
            Application.Run(host);
        }
    }
}
