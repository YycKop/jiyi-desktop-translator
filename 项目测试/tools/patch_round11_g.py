"""第十一轮补丁 G：「退出程序」按钮（锚点按真实 markup 修正）。"""
import io
import sys

H = r'D:\桌面翻译助手\项目代码\src\renderer\settings\index.html'
J = r'D:\桌面翻译助手\项目代码\src\renderer\settings\app.js'


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
        sys.exit(2)
    if t.count(old) > 1:
        print('AMBIGUOUS:', label, t.count(old))
        sys.exit(2)
    write(path, t.replace(old, new))
    print('ok:', label)


patch(
    H,
    '<button id="btn-selftest" class="ghost">引擎自检</button>',
    '<button id="btn-selftest" class="ghost">引擎自检</button>\n'
    '          <button id="btn-quit" class="ghost">退出程序</button>',
    'html: quit button',
)

patch(
    J,
    "  if ($('btn-input-translate')) $('btn-input-translate').addEventListener('click', translateInput);",
    "  if ($('btn-input-translate')) $('btn-input-translate').addEventListener('click', translateInput);\n"
    "  // 退出程序（第十一轮需求 2：任务栏驻留时的显式出口）\n"
    "  if ($('btn-quit')) {\n"
    "    $('btn-quit').addEventListener('click', async () => {\n"
    "      try { await api.quit(); } catch (e) { toast('退出失败：' + ((e && e.message) || '未知错误'), 'err'); }\n"
    "    });\n"
    "  }",
    'js: quit button handler',
)

print('patched g')
