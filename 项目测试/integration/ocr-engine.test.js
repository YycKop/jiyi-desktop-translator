'use strict';
/**
 * 识别引擎集成测试：
 *  - ONNX(rapid) 引擎对全部合成图达标（比 WinRT 高，是新的默认引擎）
 *  - OcrService 能按配置切换引擎，切换后清缓存重新选择
 *  - 配置里的非法值回落到 auto
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { OcrService, AUTO_ORDER, VALID_PREFERRED } = require('../../项目代码/src/core/ocr');
const fixtures = require('../helpers/fixtures');
const { similarity } = require('../helpers/text-similarity');

const TEST_ROOT = path.join(__dirname, '..');
const FIXTURE_DIR = path.join(TEST_ROOT, 'fixtures');

/** 日/韩模型是可选下载项，缺了就跳过相关用例（不让别人 clone 后跑挂） */
function hasJpKrModels() {
  const dir = path.join(TEST_ROOT, '..', '项目代码', 'runtime', 'ocr-rapid', 'models');
  return (
    fs.existsSync(path.join(dir, 'japan_PP-OCRv4_rec_mobile.onnx')) &&
    fs.existsSync(path.join(dir, 'korean_PP-OCRv4_rec_mobile.onnx'))
  );
}

test('AUTO_ORDER 优先使用 ONNX 引擎', () => {
  assert.equal(AUTO_ORDER[0], 'rapid');
  assert.ok(AUTO_ORDER.includes('winrt'));
  assert.deepEqual(VALID_PREFERRED, ['auto', 'rapid', 'winrt', 'tesseract']);
});

test('setPreferred 只接受白名单值并重置已选引擎', async () => {
  const svc = new OcrService({});
  assert.equal(svc.setPreferred('rapid'), 'rapid');
  assert.equal(svc.preferred, 'rapid');
  // 非法值回落 auto
  assert.equal(svc.setPreferred('nope'), 'auto');
  // 同一值重复设置不发脾气
  assert.equal(svc.setPreferred('auto'), 'auto');
  assert.equal(svc.status().preferred, 'auto');
});

test('固定 rapid 引擎时 pick 直接选中它', async () => {
  const svc = new OcrService({ engine: 'rapid' });
  const engine = await svc.pick();
  assert.equal(engine.name, 'rapid');
  const status = svc.status();
  assert.equal(status.picked, 'rapid');
  assert.ok(fs.existsSync(status.rapidModels), `模型目录不存在：${status.rapidModels}`);
});

test('ONNX 引擎对全部合成图达到期望相似度', async () => {
  const svc = new OcrService({ engine: 'rapid' });
  const failures = [];
  const entries = Object.entries(fixtures.FIXTURES || {});
  assert.ok(entries.length >= 16, `合成图数量异常：${entries.length}`);
  for (const [file, meta] of entries) {
    const full = path.join(FIXTURE_DIR, file);
    if (!fs.existsSync(full)) continue; // eslint-disable-line no-continue
    // eslint-disable-next-line no-await-in-loop
    const r = await svc.recognize({ buffer: fs.readFileSync(full) });
    const sim = similarity(meta.expected, r.text);
    if (sim < (meta.minSimilarity || 0.95)) {
      failures.push(`${file} sim=${sim.toFixed(4)}`);
    }
  }
  assert.deepEqual(failures, [], `以下图片未达标：${failures.join(', ')}`);
});

test('ONNX 引擎在照片背景图上保持高精度', async () => {
  const svc = new OcrService({ engine: 'rapid' });
  const expected = [
    '请点击保存按钮，然后继续。',
    '如果没有响应，请稍后再试；也可以联系客服！',
    '小提示：快捷键 Ctrl+Shift+T 可以重新框选区域。',
  ].join('\n');
  for (const file of ['bg-white-20px.png', 'bg-panel-20px.png', 'bg-gray-20px.png', 'bg-gray-15px.png']) {
    const full = path.join(FIXTURE_DIR, file);
    if (!fs.existsSync(full)) continue; // eslint-disable-line no-continue
    // eslint-disable-next-line no-await-in-loop
    const r = await svc.recognize({ buffer: fs.readFileSync(full) });
    const sim = similarity(expected, r.text);
    assert.ok(sim >= 0.95, `${file} 相似度过低：${sim.toFixed(4)}\n${r.text}`);
  }
});

test('切换引擎后 status 反映新的选择', async () => {
  const svc = new OcrService({ engine: 'rapid' });
  await svc.pick();
  assert.equal(svc.status().picked, 'rapid');
  svc.setPreferred('winrt');
  assert.equal(svc.status().picked, null, '切换后应清掉已选引擎');
  const engine = await svc.pick();
  // WinRT 在正常机器上一定可用；若确实不可用则退化为「已给出失败原因」
  assert.ok(['winrt', 'rapid', 'tesseract'].includes(engine.name));
});

test('日文与韩文截图自动识别（auto 模式选对模型）', async () => {
  if (!hasJpKrModels()) {
    // 没下载日韩模型的环境跳过，不让别人 clone 后跑挂
    assert.ok(true, '未安装日韩模型，跳过');
    return;
  }
  const svc = new OcrService({ engine: 'rapid' });
  const cases = [
    { file: 'jp-hiragana-640x200.png', lang: '日文', expect: ['こんにちは', 'カタカナ'] },
    { file: 'jp-mixed-640x200.png', lang: '日文', expect: ['日本語', 'カタカナ'] },
    { file: 'ko-hangul-640x200.png', lang: '韩文', expect: ['안녕하세요', '한국어'] },
    { file: 'ko-sentence-640x200.png', lang: '韩文', expect: ['한국어로', '자막'] },
  ];
  for (const c of cases) {
    const full = path.join(FIXTURE_DIR, c.file);
    if (!fs.existsSync(full)) continue; // eslint-disable-line no-continue
    // eslint-disable-next-line no-await-in-loop
    const r = await svc.recognize({ buffer: fs.readFileSync(full) });
    assert.equal(r.lang, c.lang, `${c.file} 应判为${c.lang}，实际 ${r.lang}`);
    for (const word of c.expect) {
      assert.ok(r.text.includes(word), `${c.file} 缺少「${word}」：${r.text}`);
    }
  }
});

test('识别语言可固定，乱配得到低分而不是乱认', async () => {
  if (!hasJpKrModels()) {
    assert.ok(true, '未安装日韩模型，跳过');
    return;
  }
  const svc = new OcrService({ engine: 'rapid' });
  svc.setLang('korean');
  const kr = await svc.recognize({ buffer: fs.readFileSync(path.join(FIXTURE_DIR, 'ko-hangul-640x200.png')) });
  assert.equal(kr.lang, '韩文');
  assert.ok(kr.text.includes('안녕하세요'));

  // 用韩文模型读日文：应当认不出，而不是硬凑出"像日文"的字
  const jpAsKo = await svc.recognize({ buffer: fs.readFileSync(path.join(FIXTURE_DIR, 'jp-hiragana-640x200.png')) });
  assert.ok(!/[ぁ-んァ-ヶ]/.test(jpAsKo.text), `韩文模型不该吐出假名：${jpAsKo.text}`);
});
