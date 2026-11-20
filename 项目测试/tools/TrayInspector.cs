using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;

// TrayInspector: 枚举通知区域工具栏按钮并读取每个图标的 tooltip 文本。
// 用途：判断「我们的托盘图标到底有没有进通知区域」——只看按钮数会被 Win10 的隐藏图标机制误导，
// 但 tooltip 文本（TB_GETBUTTONTEXT）能直接告诉我们某个程序名在不在里面。
internal static class TrayInspector
{
    private const uint TB_BUTTONCOUNT = 0x0418;
    private const uint TB_GETBUTTON = 0x0417;
    private const uint TB_GETBUTTONTEXTW = 0x044B;
    private const uint PROCESS_VM_OPERATION = 0x0008;
    private const uint PROCESS_VM_READ = 0x0010;
    private const uint PROCESS_VM_WRITE = 0x0020;
    private const uint PROCESS_QUERY_INFORMATION = 0x0400;
    private const uint MEM_COMMIT = 0x1000;
    private const uint MEM_RELEASE = 0x8000;
    private const uint PAGE_READWRITE = 0x04;

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindow(string cls, string name);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr FindWindowEx(IntPtr parent, IntPtr after, string cls, string name);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, IntPtr lParam);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern IntPtr SendMessage(IntPtr hWnd, uint msg, IntPtr wParam, StringBuilder lParam);

    [DllImport("user32.dll")]
    private static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint pid);

    [DllImport("kernel32.dll")]
    private static extern IntPtr OpenProcess(uint access, bool inherit, uint pid);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    [DllImport("kernel32.dll")]
    private static extern IntPtr VirtualAllocEx(IntPtr proc, IntPtr addr, IntPtr size, uint type, uint protect);

    [DllImport("kernel32.dll")]
    private static extern bool VirtualFreeEx(IntPtr proc, IntPtr addr, IntPtr size, uint type);

    [DllImport("kernel32.dll")]
    private static extern bool ReadProcessMemory(IntPtr proc, IntPtr addr, byte[] buffer, IntPtr size, out IntPtr read);

    [DllImport("user32.dll")]
    private static extern bool EnumChildWindows(IntPtr parent, EnumProc callback, IntPtr lParam);

    private delegate bool EnumProc(IntPtr hWnd, IntPtr lParam);

    private static List<IntPtr> Children(IntPtr parent)
    {
        var list = new List<IntPtr>();
        EnumChildWindows(parent, (h, l) => { list.Add(h); return true; }, IntPtr.Zero);
        return list;
    }

    private static IntPtr FindToolbar(IntPtr root)
    {
        var cls = new StringBuilder(256);
        foreach (var child in Children(root))
        {
            cls.Clear();
            GetClassName(child, cls, cls.Capacity);
            if (cls.ToString() == "ToolbarWindow32") return child;
        }
        return IntPtr.Zero;
    }

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetClassName(IntPtr hWnd, StringBuilder buf, int max);

    [DllImport("user32.dll", CharSet = CharSet.Unicode)]
    private static extern int GetWindowText(IntPtr hWnd, StringBuilder buf, int max);

    private static int Count(IntPtr toolbar)
    {
        if (toolbar == IntPtr.Zero) return -1;
        return (int)SendMessage(toolbar, TB_BUTTONCOUNT, IntPtr.Zero, IntPtr.Zero);
    }

    private static List<string> Tooltips(IntPtr toolbar, int count)
    {
        var result = new List<string>();
        if (toolbar == IntPtr.Zero || count <= 0) return result;

        uint pid;
        GetWindowThreadProcessId(toolbar, out pid);
        var proc = OpenProcess(PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_VM_WRITE | PROCESS_QUERY_INFORMATION, false, pid);
        if (proc == IntPtr.Zero) return result;

        const int bufSize = 512;
        var remote = VirtualAllocEx(proc, IntPtr.Zero, (IntPtr)bufSize, MEM_COMMIT, PAGE_READWRITE);
        try
        {
            if (remote == IntPtr.Zero) return result;
            for (var i = 0; i < count; i++)
            {
                var ok = SendMessage(toolbar, TB_GETBUTTONTEXTW, (IntPtr)i, remote);
                if (ok == IntPtr.Zero) continue;
                var buffer = new byte[bufSize * 2];
                IntPtr read;
                if (!ReadProcessMemory(proc, remote, buffer, (IntPtr)buffer.Length, out read)) continue;
                var text = Encoding.Unicode.GetString(buffer).TrimEnd('\0');
                if (text.Length > 0) result.Add(i + ": " + text);
            }
        }
        finally
        {
            if (remote != IntPtr.Zero) VirtualFreeEx(proc, remote, IntPtr.Zero, MEM_RELEASE);
            CloseHandle(proc);
        }
        return result;
    }

    private static void Dump(string label, IntPtr root)
    {
        if (root == IntPtr.Zero) { Console.WriteLine(label + ": (window not found)"); return; }
        // 通知区里有多个 ToolbarWindow32（搜索框、系统升级提示区、用户提示区…），
        // 必须逐个统计，取第一个会读到"搜索框"那个假通知区（实测 buttons=0）。
        var found = 0;
        foreach (var child in Children(root))
        {
            var cls = new StringBuilder(256);
            GetClassName(child, cls, cls.Capacity);
            if (cls.ToString() != "ToolbarWindow32") continue;
            found++;
            var title = new StringBuilder(256);
            GetWindowText(child, title, title.Capacity);
            var count = Count(child);
            Console.WriteLine(label + " toolbar=" + child.ToInt64() + " title=" + title + " buttons=" + count);
            foreach (var t in Tooltips(child, count)) Console.WriteLine("    " + t);
        }
        if (found == 0) Console.WriteLine(label + ": no ToolbarWindow32 child");
    }

    public static int Main(string[] args)
    {
        Console.OutputEncoding = Encoding.UTF8;
        var main = FindWindow("Shell_TrayWnd", null);
        Dump("Shell_TrayWnd", main);
        var overflow = FindWindow("NotifyIconOverflowWindow", null);
        Dump("NotifyIconOverflowWindow", overflow);
        return 0;
    }
}
