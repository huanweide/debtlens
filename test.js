#!/usr/bin/env node
'use strict';

/*
 * debtlens 自包含单测（零依赖，仅用 node:assert + node:child_process）
 * 运行：node test.js   —— 全绿 exit 0，任一失败 exit 1
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const D = require('./index.js');
const CLI = path.join(__dirname, 'index.js');

let pass = 0;
function ok(name) { pass++; console.log('  [OK] ' + name); }

function makeProject(structure) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-'));
  for (const [rel, content] of Object.entries(structure)) {
    const full = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content);
  }
  return tmp;
}

// 1. scanFile 注释锚定降误报 ------------------------------------------------
(function checkScanFile() {
  function scanLine(content) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'dl-s-'));
    const f = path.join(tmp, 'x.js');
    fs.writeFileSync(f, content);
    const res = D.scanFile(f);
    return res ? res.hits : [];
  }
  assert.deepStrictEqual(scanLine('// TODO: fix'), ['TODO']);
  assert.deepStrictEqual(scanLine('const todo = 1;'), []);               // 前面无注释符，不命中
  assert.deepStrictEqual(scanLine('const msg = "TODO: fake";'), []);     // 字符串被剥离，不命中
  assert.deepStrictEqual(scanLine('some(); // FIXME later'), ['FIXME']);
  assert.deepStrictEqual(scanLine('/* HACK */'), ['HACK']);
  assert.deepStrictEqual(scanLine('# NOTE: x'), ['NOTE']);               // python 注释
  assert.deepStrictEqual(scanLine('<!-- DEPRECATED -->'), ['DEPRECATED']);
  assert.deepStrictEqual(scanLine('const FIXME_LIST = []'), []);         // 前面是 _，不命中
  const two = scanLine('// TODO: a\n// OPTIMIZE: b');
  assert.ok(two.includes('TODO') && two.includes('OPTIMIZE'));
  ok('scanFile 注释锚定降误报（排除 const todo=1 / 字符串伪标记 / FIXME_LIST）');
})();

// 2. analyze 真实项目 ------------------------------------------------------
(function checkAnalyze() {
  const tmp = makeProject({
    'src/a.js': 'const x=1;\n// TODO: fix a\nconst y=2; // FIXME: bug here\n',
    'src/b.py': '# NOTE: refactor\nprint(1)\n',
    'src/c.js': 'const msg = "TODO: fake";\nconst t=1;\n',
    'test/d.js': 'module.exports=1;\n'
  });
  const a = D.analyze(tmp);
  assert.strictEqual(a.totalTags, 3, '应检出 TODO+FIXME+NOTE=3，实际 ' + a.totalTags);
  assert.strictEqual(a.byTag.TODO, 1);
  assert.strictEqual(a.byTag.FIXME, 1);
  assert.strictEqual(a.byTag.NOTE, 1);
  assert.strictEqual(a.bySeverity.high, 2);
  assert.strictEqual(a.bySeverity.low, 1);
  assert.strictEqual(a.taggedFiles, 2, 'a.js 与 b.py 含债，实际 ' + a.taggedFiles);
  assert.ok(a.srcLines > 0);
  assert.strictEqual(a.totalWeighted, 7, '加权 3+3+1=7，实际 ' + a.totalWeighted);
  assert.ok(a.healthScore >= 0 && a.healthScore <= 100);
  ok('analyze 真实项目计数（标记/严重度/文件/加权/行数）正确');
})();

// 3. computeScore 边界 -----------------------------------------------------
(function checkScore() {
  assert.deepStrictEqual(D.computeScore(0), { score: 100, verdict: '健康' });
  assert.deepStrictEqual(D.computeScore(1), { score: 100, verdict: '健康' });  // 等于 FREE 不扣
  assert.deepStrictEqual(D.computeScore(2), { score: 75, verdict: '基本健康' }); // over=1*25
  assert.deepStrictEqual(D.computeScore(5), { score: 0, verdict: '债务沉重' });  // over=4*25=100
  ok('computeScore 边界（0/等于FREE/中间/归零）正确');
})();

// 4. buildWarnings ---------------------------------------------------------
(function checkWarnings() {
  const empty = { files: 0, density: 0, bySeverity: { high: 0, medium: 0, low: 0 } };
  const w0 = D.buildWarnings(empty);
  assert.ok(w0.some(w => w.startsWith('no-source')));

  const hot = { files: 10, density: 20, bySeverity: { high: 3, medium: 0, low: 0 } };
  const w1 = D.buildWarnings(hot);
  assert.ok(w1.some(w => w.startsWith('high-density')));
  assert.ok(w1.some(w => w.startsWith('has-high-severity')));
  ok('buildWarnings 无源码/高密度/高危标记警告正确');
})();

// 5. applyGate 阈值校验 ----------------------------------------------------
(function checkGate() {
  const a = { density: 5, weightedDensity: 5, totalTags: 10, byTag: { FIXME: 2, TODO: 0 } };
  const bad = D.applyGate(a, { maxDensity: NaN }, []);
  assert.strictEqual(bad.code, 2);
  assert.strictEqual(bad.gate, null);

  const g1 = D.applyGate(a, { maxDensity: 3 }, []);
  assert.strictEqual(g1.code, 2);
  assert.ok(g1.gate.some(x => x.includes('max-density')));

  const g2 = D.applyGate(a, { failOnTags: 'FIXME,TODO' }, []);
  assert.strictEqual(g2.code, 2);
  assert.ok(g2.gate.some(x => x.includes('FIXME')));

  const g3 = D.applyGate({ density: 5, weightedDensity: 5, totalTags: 10, byTag: { FIXME: 0 } }, { maxTotal: 20, failOnTags: 'FIXME' }, []);
  assert.strictEqual(g3.code, 0);
  ok('applyGate 阈值非法 exit2 / 密度门禁 / failOnTags / 通过 正确');
})();

// 6. CLI 端到端 ------------------------------------------------------------
(function checkCLI() {
  const clean = makeProject({
    'src/a.js': 'const x=1;\nmodule.exports=x;\n',
    'test/a.test.js': "const assert=require('assert');\ntest('x',()=>assert.ok(true));\n"
  });
  let s0 = 0;
  try { execFileSync(process.execPath, [CLI, '--root', clean], { stdio: 'pipe' }); }
  catch (e) { s0 = e.status; }
  assert.strictEqual(s0, 0, '零债务项目应 exit 0');

  const dirty = makeProject({
    'src/a.js': '// TODO: a\n// FIXME: b\n// TODO: c\nconst x=1;\n'
  });
  let s2 = -1;
  try { execFileSync(process.execPath, [CLI, '--root', dirty, '--max-total', '1'], { stdio: 'pipe' }); }
  catch (e) { s2 = e.status; }
  assert.strictEqual(s2, 2, '总标记 3 > --max-total 1 应 exit 2');

  let sBad = -1;
  try { execFileSync(process.execPath, [CLI, '--root', '/no/such/dir/xyz'], { stdio: 'pipe' }); }
  catch (e) { sBad = e.status; }
  assert.strictEqual(sBad, 2, '无效 root 应 exit 2');

  let sNa = -1;
  try { execFileSync(process.execPath, [CLI, '--root', dirty, '--max-density', 'abc'], { stdio: 'pipe' }); }
  catch (e) { sNa = e.status; }
  assert.strictEqual(sNa, 2, '--max-density 非数字应 exit 2');

  let sTag = -1;
  try { execFileSync(process.execPath, [CLI, '--root', dirty, '--fail-on-tags', 'FIXME'], { stdio: 'pipe' }); }
  catch (e) { sTag = e.status; }
  assert.strictEqual(sTag, 2, '--fail-on-tags FIXME 应 exit 2');

  ok('CLI 端到端（零债务/门禁/无效root/非整数阈值/failOnTags）退出码正确');
})();

// 7. --version -------------------------------------------------------------
(function checkVersion() {
  let out = '';
  let s = 0;
  try { out = execFileSync(process.execPath, [CLI, '--version'], { stdio: 'pipe' }).toString(); }
  catch (e) { s = e.status; out = ((e.stdout || '').toString()); }
  assert.strictEqual(s, 0, '--version 应 exit 0');
  assert.ok(/debtlens\s+\d+\.\d+\.\d+/.test(out.trim()), '应输出版本号，实际: ' + out.trim());
  ok('CLI --version 输出版本号并 exit 0');
})();

console.log('\ndebtlens 单测：' + pass + ' 项全绿');
