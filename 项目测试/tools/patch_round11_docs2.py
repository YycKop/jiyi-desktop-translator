"""第十一轮文档收尾：偏离表补「任务栏驻留」行 + 修正第 5 节截图数。"""
import io

AGENTS = r'D:\桌面翻译助手\项目代码\AGENTS.md'


def read(p):
    with io.open(p, 'r', encoding='utf-8') as f:
        return f.read()


def write(p, s):
    with io.open(p, 'w', encoding='utf-8', newline='\n') as f:
        f.write(s)


t = read(AGENTS)

# 1) 截图数 12 → 13（第十一轮新增 13-settings-input.png）
old_shot = '`ok=true 渲染错误=0 截图=12 托盘=true`'
if old_shot in t:
    t = t.replace(old_shot, '`ok=true 渲染错误=0 截图=13 托盘=true`', 1)
    print('ok: 截图数 13')
else:
    print('skip: 截图数锚点未命中')

# 2) 偏离表补一行
row = ('| 后台入口 | 托盘图标常驻（F-02） | **任务栏常驻 + 关闭即最小化 + 显式退出**：'
       '设置窗口 `skipTaskbar: false`，`close` 改为最小化；退出只走关于页「退出程序」/ 托盘退出 / `--quit` / JumpList | '
       '本机托盘注册不稳定、`app.setUserTasks` 在 portable 形态返回 false，若只依赖托盘，用户关掉窗口后就没有入口 |\n')
anchor = '| 双击入口 | 直接运行'
if anchor in t and '后台入口 |' not in t:
    t = t.replace(anchor, row + anchor, 1)
    print('ok: 偏离表后置入口行')
elif '后台入口 |' in t:
    print('skip: 已存在')
else:
    print('MISS: 偏离表锚点')

write(AGENTS, t)
print('docs done')
