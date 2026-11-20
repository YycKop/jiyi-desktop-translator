param(
    [int]$X = 1492,
    [int]$Y = 1046,
    [string]$Out = "D:\桌面翻译助手\项目测试\reports\tray-flyout.png",
    [int]$CapX = 1100,
    [int]$CapY = 620,
    [int]$CapW = 620,
    [int]$CapH = 440
)
# ASCII only: click a screen point, wait for the flyout, then capture a rectangle.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class Mouse {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    [DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
    public const uint LEFTDOWN = 0x0002;
    public const uint LEFTUP = 0x0004;
    public static void Click(int x, int y) {
        SetCursorPos(x, y);
        System.Threading.Thread.Sleep(120);
        mouse_event(LEFTDOWN, 0, 0, 0, UIntPtr.Zero);
        System.Threading.Thread.Sleep(60);
        mouse_event(LEFTUP, 0, 0, 0, UIntPtr.Zero);
    }
}
"@ -ReferencedAssemblies System.Drawing
[Mouse]::Click($X, $Y)
Start-Sleep -Milliseconds 900
$bmp = New-Object System.Drawing.Bitmap $CapW, $CapH
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.CopyFromScreen($CapX, $CapY, 0, 0, (New-Object System.Drawing.Size $CapW, $CapH))
$gfx.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
# press ESC to close the flyout
[Mouse]::keybd_event(0x1B, 0, 0, [UIntPtr]::Zero)
[Mouse]::keybd_event(0x1B, 0, 2, [UIntPtr]::Zero)
Write-Output ("clicked " + $X + "," + $Y + " saved " + $Out)
