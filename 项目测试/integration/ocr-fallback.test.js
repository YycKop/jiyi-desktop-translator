'use strict';
/**
 * OCR 脚本健壮性回归（第十轮）
 *
 * 用户反馈「浮窗显示 OCR 引擎不可用，请检查系统 OCR 语言包」是**间歇性**的：
 * 脚本本身能跑，问题出在 multi-pass 时两个 PowerShell 进程各编译一份内联 C#，
 * 偶发编译失败就直接抛错，被 OcrService 判定为"未安装语言包"。
 *
 * 这一组测试锁住三条底线：
 *   ① 缓存 DLL 存在时复用（不重复编译）；
 *   ② 编译不可用时自动退回纯 GDI+ 缩放，仍然能出文本（prepFallback=true）；
 *   ③ 两次调用的识别结果一致（不因缓存/回退路径不同而变差）。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { prepare } = require('../helpers/env');

prepare();

const { runPowerShellFile } = require('../../项目代码/src/core/native/ps');

const ROOT = path.join(__dirname, '..', '..');
const FIXTURE = path.join(ROOT, '项目测试', 'fixtures', 'ui-hint-14px.png');
const EXPECT = '「自动」= 深底浅字 / 浅底深字，点「跟随背景」可恢复';

function tmpJson(tag) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-fb-' + tag + '-'));
  return { dir, out: path.join(dir, 'out.json') };
}

async function runScript(extraArgs) {
  const { dir, out } = tmpJson('run');
  const args = [
    '-ImagePath', FIXTURE,
    '-OutPath', out,
    '-Lang', 'zh-Hans-CN',
    '-Scale', '2',
    '-Sharpen', '160',
    ...extraArgs,
  ];
  const r = await runPowerShellFile('winrt-ocr.ps1', args, { timeoutMs: 60000 });
  let json = null;
  try {
    json = JSON.parse(fs.readFileSync(out, 'utf8'));
  } catch {
    json = null;
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return { r, json };
}

const squash = (s) => String(s || '').replace(/\s+/g, '');

test('缓存目录可用时把预处理编译成 OcrPrep.dll 并复用', async () => {
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'ocr-cache-'));
  try {
    const first = await runScript(['-CacheDir', cache]);
    assert.ok(first.json, '脚本必须写出 JSON');
    assert.strictEqual(first.json.ok, true);
    assert.strictEqual(first.json.prepFallback, false, '第一遍应走 C# 预处理');
    assert.ok(fs.existsSync(path.join(cache, 'OcrPrep.dll')), '应生成缓存的 OcrPrep.dll');
    assert.ok(squash(first.json.text).includes('跟随背景'), '识别结果应包含关键词');

    // 第二遍应复用已编译的 DLL（不再重新编译）
    const second = await runScript(['-CacheDir', cache]);
    assert.strictEqual(second.json.ok, true);
    assert.strictEqual(second.json.prepFallback, false);
    assert.strictEqual(squash(second.json.text), squash(first.json.text), '两次结果应一致');
  } finally {
    fs.rmSync(cache, { recursive: true, force: true });
  }
});

test('预处理不可用时退回纯 GDI+ 缩放，仍然出文本（不再报引擎不可用）', async () => {
  const { json } = await runScript(['-NoPrep']);
  assert.ok(json, '脚本必须写出 JSON');
  assert.strictEqual(json.ok, true, '回退路径也必须成功');
  assert.strictEqual(json.prepFallback, true, '应标记 prepFallback');
  assert.strictEqual(json.sharpened, false, '回退路径不做锐化');
  assert.ok(squash(json.text).length > 8, '回退路径仍应识别出文本');
});

test('全部路径都失败时给出可读错误而不是"发生一个或多个错误"', async () => {
  const missing = path.join(os.tmpdir(), 'no-such-image-' + Date.now() + '.png');
  const { dir, out } = tmpJson('missing');
  try {
    const r = await runPowerShellFile('winrt-ocr.ps1', [
      '-ImagePath', missing,
      '-OutPath', out,
      '-Lang', 'zh-Hans-CN',
      '-Scale', '2',
    ], { timeoutMs: 60000 });
    // 脚本内部 try/catch 会把错误写进 JSON；也可能直接以非 0 退出
    let json = null;
    try { json = JSON.parse(fs.readFileSync(out, 'utf8')); } catch { json = null; }
    if (json) {
      assert.strictEqual(json.ok, false);
      assert.ok(String(json.error || '').length > 0, '错误信息不应为空');
      assert.ok(!/发生一个或多个错误/.test(String(json.error)), '错误信息应展开到根因');
    } else {
      assert.notStrictEqual(r.code, 0, '没有 JSON 时应以非 0 退出');
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
