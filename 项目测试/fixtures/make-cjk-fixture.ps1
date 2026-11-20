# 合成中文标点测试图（SCR-02：纯白底 + 系统字体渲染文字，不含任何真实桌面内容）
# 说明：gen-cjk-fixture.ps1 是纯 ASCII 脚本，中文只能作为参数传入，所以用这个
# 带 BOM 的启动脚本包装一次，保证「怎么生成的」可复现。
$ErrorActionPreference = 'Stop'
$ErrorActionPreference = 'Continue'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$ps = 'powershell.exe'
& $ps -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'gen-cjk-fixture.ps1') `
    -Out (Join-Path $here 'cjk-punct-640x200.png') `
    -Line1 '请点击保存按钮，然后继续。' `
    -Line2 '提示：请勿关闭窗口！' `
    -FontSize 26
