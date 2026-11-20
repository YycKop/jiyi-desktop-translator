param(
    [int]$X = 1855,
    [int]$Y = 825,
    [string]$Out = "",
    [int]$CapX = 1450,
    [int]$CapY = 600,
    [int]$CapW = 470,
    [int]$CapH = 380
)
# ASCII only. Right-click a screen point and capture the popup menu area.
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public class RClick {
    [DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
    [DllImport("user32.dll")] public static extern void mouse_event(uint flags, uint dx, uint dy, uint data, UIntPtr extra);
    public const uint RIGHTDOWN = 0x0008;
    public const uint RIGHTUP = 0x0010;
    public static void Do(int x, int y) {
        SetCursorPos(x, y);
        System.Threading.Thread.Sleep(150);
        mouse_event(RIGHTDOWN, 0, 0, 0, UIntPtr.Zero);
        System.Threading.Thread.Sleep(70);
        mouse_event(RIGHTUP, 0, 0, 0, UIntPtr.Zero);
    }
}
"@
[RClick]::Do($X, $Y)
Start-Sleep -Milliseconds 1200
$bmp = New-Object System.Drawing.Bitmap $CapW, $CapH
$gfx = [System.Drawing.Graphics]::FromImage($bmp)
$gfx.CopyFromScreen($CapX, $CapY, 0, 0, (New-Object System.Drawing.Size $CapW, $CapH))
$gfx.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()
Write-Output ("right-clicked " + $X + "," + $Y + " -> " + $Out)
