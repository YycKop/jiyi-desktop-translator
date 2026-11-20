'use strict';
/**
 * 测试环境隔离
 *
 * 所有测试都把用户数据目录指向 `项目测试/_runtime/home`，避免写入 %APPDATA%（限制书 FS-01/FS-02）。
 * 必须在 require 业务模块之前调用 prepare()（paths.js 惰性读取环境变量，但仍按此顺序更安全）。
 */
const fs = require('fs');
const path = require('path');

const TEST_ROOT = path.resolve(__dirname, '..');
const RUNTIME_HOME = path.join(TEST_ROOT, '_runtime', 'home');

function prepare() {
  process.env.TRANSLATOR_HOME = RUNTIME_HOME;
  process.env.TRANSLATOR_TEST = '1';
  fs.mkdirSync(RUNTIME_HOME, { recursive: true });
  return RUNTIME_HOME;
}

/** 每个用例独立的数据目录，避免相互污染 */
function freshHome(name) {
  const dir = path.join(TEST_ROOT, '_runtime', `home-${name}`);
  process.env.TRANSLATOR_HOME = dir;
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

module.exports = { TEST_ROOT, RUNTIME_HOME, prepare, freshHome };
