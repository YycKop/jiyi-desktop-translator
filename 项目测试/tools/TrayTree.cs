using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;

// TrayTree: 打印 Shell_TrayWnd / NotifyIconOverflowWindow 的窗口树（类名 + 标题 + 可见性），
// 用于判断当前 shell 到底是传统 Toolbar 通知区，还是 XAML 渲染的新式通知区。
internal static class TrayTree
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindow(string cls, string name);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder buf, int max);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder buf, int max);

    [DllImport("user32.dll")]
    private static extern bool IsWindowVisible(IntPtr hWnd);

    [DllImport("user32.dll")]
    private static extern IntPtr GetParent(IntPtr hWnd);

    private delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    private static string Describe(IntPtr h)
    {
        var cls = new StringBuilder(256);
        GetClassName(h, cls, cls.Capacity);
        var title = new StringBuilder(256);
        GetWindowText(h, title, title.Capacity);
        var parent = GetParent(h);
        return "  " + h.ToInt64() + " parent=" + parent.ToInt64()
            + " visible=" + (IsWindowVisible(h) ? "True" : "False")
            + " class=" + cls + (title.Length > 0 ? " title=" + title : "");
    }

    private static void Dump(string label)
    {
        var root = FindWindow(label, null);
        Console.WriteLine(label + " = " + root.ToInt64());
        if (root == IntPtr.Zero) return;
        Console.WriteLine(Describe(root));
        var idx = 0;
        EnumChildWindows(root, (h, l) =>
        {
            idx++;
            if (idx <= 60) Console.WriteLine(Describe(h));
            return true;
        }, IntPtr.Zero);
        Console.WriteLine("  children total: " + idx);
    }

    public static int Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        Dump("Shell_TrayWnd");
        Dump("NotifyIconOverflowWindow");
        return 0;
    }
}
