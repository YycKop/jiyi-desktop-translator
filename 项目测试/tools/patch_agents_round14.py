# -*- coding: utf-8 -*-
"""把第十四轮（OCR 标点与背景图）经验追加到 AGENTS.md 第 6 节末尾。"""
import io
import os

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
AGENTS = os.path.join(ROOT, '项目代码', 'AGENTS.md')

BULLETS = [
    '- **OCR 标点事故的修法**：重复标点（`，，`）、行首标点（`，然后`）、被空格拆开的运算符'
    '（`Ctrl + Shift + T`）都会进 `scoreText()` 的黑名单（`dup-punct` / `lead-punct` / `ascii-space`），'
    '同时由 `repairCjkPunctuation()` 收敛。运算符收紧只在「两端都是字母」时生效，'
    '否则 `1 + 1 = 2` 会被连成 `1+1=2`。',
    '- **低对比度文字（照片/半透明浮层）必须有一遍对比度拉伸**：`DEFAULT_PASSES` 里除 2x/3x 不锐化、'
    '2x 锐化外，额外跑 2x + `contrast=30`；实测 `bg-gray-20px` 的 `CtrI`→`Ctrl`、'
    '漏掉的「重」也能补回来。**只加对比度、不要锐化**——照片底上锐化会把笔画撕开（`按钮`→`扌安钮`）。',
    '- **多遍合并要先投票再比长度**：同一行被两遍以上认成同一个串就以它为准（投票），'
    '票数相同时才用「子序列/更长」规则补漏字。短文本（≤60 字符）关掉投票、按锐化优先的顺序取首遍，'
    '否则提示行反而会选到别的遍的近似结果。',
]


def main():
    with io.open(AGENTS, 'r', encoding='utf-8') as f:
        text = f.read()
    anchor = '## 7. '
    idx = text.find(anchor)
    if idx < 0:
        raise SystemExit('找不到第 7 节锚点')
    head, tail = text[:idx], text[idx:]
    # 去掉第 6 节末尾多余空行，保持 Markdown 整洁
    head = head.rstrip('\n') + '\n'
    block = '\n'.join(BULLETS) + '\n\n'
    if 'dup-punct' in text:
        print('已包含第十四轮条目，跳过')
        return
    with io.open(AGENTS, 'w', encoding='utf-8', newline='\n') as f:
        f.write(head + block + tail)
    print('AGENTS.md updated ->', len(head + block + tail), 'chars')


if __name__ == '__main__':
    main()
