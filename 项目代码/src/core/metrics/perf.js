'use strict';
/**
 * 内存与性能实测（core/metrics/perf.js）
 *
 * 依据 REV-001 N-02-R1：
 *  - 分别采集 llama.cpp RSS + DSH RSS + 宿主壳 RSS
 *  - 一次翻译后待稳定 30s 再取值
 *  - 结果写入 $PROJECT_ROOT/perf/（项目内，可复核）
 *
 * 说明：采样本身通过 PowerShell 只读查询进程工作集，不涉及任何用户数据。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { runPowerShellFile } = require('../native/ps');
const paths = require('../paths');

function currentProcessUsage() {
  const m = process.memoryUsage();
  return {
    rssMB: +(m.rss / 1048576).toFixed(1),
    heapUsedMB: +(m.heapUsed / 1048576).toFixed(1),
    externalMB: +(m.external / 1048576).toFixed(1),
  };
}

/** 采样一组 PID 的工作集（MB） */
async function samplePids(pids = []) {
  const clean = pids.filter((p) => Number.isInteger(p) && p > 0);
  if (!clean.length) return { ts: new Date().toISOString(), total: 0, items: [] };
  paths.ensure.tmp();
  const out = path.join(paths.tmpDir(), `mem-${crypto.randomBytes(4).toString('hex')}.json`);
  try {
    await runPowerShellFile('mem-sample.ps1', ['-Pids', clean.join(','), '-OutPath', out], { timeoutMs: 15000 });
    const raw = fs.readFileSync(out, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { ts: new Date().toISOString(), total: 0, items: [], error: 'SAMPLE_FAILED' };
  } finally {
    try { fs.unlinkSync(out); } catch { /* 已删除 */ }
  }
}

/**
 * 连续采样：用于「一次翻译后稳定 30s 取值」的验收流程。
 * @returns {Promise<{samples:Array, avgTotalMB:number, maxTotalMB:number, byName:object}>}
 */
async function measureMemory({ pids = [], durationMs = 30000, intervalMs = 5000 } = {}) {
  const samples = [];
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    const s = await samplePids(pids);
    samples.push(s);
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, intervalMs));
  }
  const totals = samples.map((s) => s.total || 0);
  const avg = totals.length ? +(totals.reduce((a, b) => a + b, 0) / totals.length).toFixed(1) : 0;
  const max = totals.length ? Math.max(...totals) : 0;
  const byName = {};
  for (const s of samples) {
    for (const it of s.items || []) {
      const key = String(it.name || 'unknown').toLowerCase();
      byName[key] = Math.max(byName[key] || 0, it.wsMB || 0);
    }
  }
  return {
    samples, avgTotalMB: avg, maxTotalMB: max, byName,
  };
}

function writeReport(name, data) {
  paths.ensure.perf();
  const file = path.join(paths.perfDir(), `${name}.json`);
  const payload = {
    name,
    at: new Date().toISOString(),
    platform: process.platform,
    release: process.version,
    ...data,
  };
  fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
  return file;
}

module.exports = {
  currentProcessUsage, samplePids, measureMemory, writeReport,
};
