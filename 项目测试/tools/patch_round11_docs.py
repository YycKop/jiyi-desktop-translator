"""第十一轮文档补丁：AGENTS.md / README.md / 项目测试/README.md。

只做定点插入与数字替换，全部带断言。
"""
import io
import os
import sys

ROOT = r'D:\桌面翻译助手'
AGENTS = os.path.join(ROOT, '项目代码', 'AGENTS.md')
README = os.path.join(ROOT, '项目代码', 'README.md')
TREADME = os.path.join(ROOT, '项目测试', 'README.md')


def read(p):
    with io.open(p, 'r', encoding='utf-8') as f:
        return f.read()


def write(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write(s)


def patch(path, old, new, label):
    t = read(path)
    if old not in t:
        print('MISS:', label)
        return False
    write(path, t.replace(old, new, 1))
    print('ok:', label)
    return True


# ── AGENTS.md 第 5 节：用例数与截图数 ──────────────────────────────────────
a = read(AGENTS)
a = a.replace(
    '# 1) 单元 + 集成 + OCR 精度（21 个文件 / 179 个用例：单元 128 + 集成 37 + OCR 14，零第三方依赖）',
    '# 1) 单元 + 集成 + OCR 精度（21 个文件 / 179 个用例：单元 128 + 集成 37 + OCR 14，零第三方依赖）\n'
    '#    第十一轮新增：输入翻译面板（界面/字数联动/IPC 通道就绪）、交互图标、设置页关闭＝最小化；\n'
    '#    自检断言新增 inputPane / inputCountSync / quitButton / settingsCloseMinimizes。',
    1,
)
write(AGENTS, a)
print('ok: agents 第5节')

# ── AGENTS.md 第 6 节：追加第十一轮陷阱 ───────────────────────────────────
TRAPS = '''
### 第十一轮（二次元图标 + 任务栏驻留 + 输入翻译）

- **窗口图标与 exe 图标是两套东西**：窗口图标走 `BrowserWindow({ icon: assets/app.png })`（窗口工厂里统一加），
  exe 图标走 csc 的 `/win32icon:assets/app.ico`；只改一个会出现「任务栏好看、资源管理器难看」。
- **`app.setUserTasks` 需要 AUMID 在 ready 前注册**，且真实生效要求快捷方式带 AUMID；
  开发者态（electron.exe）恒返回 false，属预期，不要据此判定功能坏掉。
- **关闭设置窗口不能 close**：浮窗 `skipTaskbar`、托盘在部分环境注册不上，`win.close()` 会让用户彻底失去入口。
  现在统一 `close → preventDefault + minimize`，退出走 `wm.prepareQuit()` 放行（`AppController.quit()` 里调用）。
- **`app.on('ready')` 钩子别用类方法做锚点**：`app.on('window-all-closed', ...)` 在类里也有一份同名注册，
  打在方法体内的 ready 钩子既不会执行、还会让模块作用域的函数不可见（本轮踩过：`setupJumpList is not defined`）。
- **输入翻译不要另起链路**：直接复用 `engine.translateText`（联网主备 → 离线降级），
  否则配额/降级行为会和浮窗不一致；目标语言统一读 `general.targetLang`，不要复制一份状态。
'''
patch(
    AGENTS,
    '## 7. 已记录的技术偏离（需在文档中保持一致）',
    TRAPS + '\n## 7. 已记录的技术偏离（需在文档中保持一致）',
    'agents 第6节第十一轮',
)

# ── AGENTS.md 第 7 节：偏离表补一条 ───────────────────────────────────────
patch(
    AGENTS,
    '- **双击入口 = C# 启动器 + `app\\` 运行时目录**',
    '- **任务栏驻留 = 「设置窗口常驻任务栏」+「关闭即最小化」**：本机托盘注册不稳定、`setUserTasks` 恒 false，\n'
    '  因此把「后台入口」放在任务栏按钮上，退出只留显式入口（关于页「退出程序」/ 托盘退出 / `--quit`）。\n'
    '- **双击入口 = C# 启动器 + `app\\` 运行时目录**',
    'agents 第7节偏离',
)

# ── README：功能表 + 依赖说明 ─────────────────────────────────────────────
patch(
    README,
    '| 外观自定义 |',
    '| 输入翻译 | 设置页「输入翻译」页签：粘贴/输入文字 → Ctrl+Enter 或按钮翻译，与浮窗共用同一套 API 与离线模型，可直接复制译文 |\n'
    '| 任务栏驻留 | 关闭设置窗口只最小化到任务栏（图标即入口），退出请用「关于 → 退出程序」、托盘「退出」或 `--quit` |\n'
    '| 外观自定义 |',
    'readme 功能表',
)

# ── 项目测试/README：口径 ─────────────────────────────────────────────────
t = read(TREADME)
t = t.replace('21 个文件 / 179 个用例', '21 个文件 / 179 个用例（第十一轮起自检断言含输入翻译面板与关闭最小化）', 1)
write(TREADME, t)
print('ok: 测试 README')

print('docs patched')
