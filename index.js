#!/usr/bin/env node
'use strict';

/*
 * debtlens — 零依赖单文件 Node CLI · 技术债密度扫描器
 *
 *   doctor  静态扫描（默认）：注释锚定识别各类技术债标记（完整清单见下方 TAGS 常量），
 *           按严重度加权统计密度，给出健康分 + CI 门禁。
 *
 * 设计铁律（继承 family 方法沉淀）：
 *   - 纯本地、零依赖、离线、单文件，跨平台（Windows posix 路径）。
 *   - 注释锚定扫描：标记必须跟在注释符(// # <!-- /*)之后，且扫描前先剥离
 *     字符串字面量，双重降误报（排除变量名与字符串内的伪标记）。
 *   - 门禁阈值一律 Number.isFinite 校验，非整数直接 exit 2，绝不静默放行。
 *   - root 必须 statSync 先验存在且为目录，错误路径不谎报"通过"。
 *   - 大文件（>5MB）跳过，避免 OOM。
 */

const fs = require('fs');
const path = require('path');

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5MB 上限，跳过防 OOM
const SOFT_DENSITY = 8;                  // 每千行标记数软阈值（超过给警告）
const SCORE_FREE = 1;                    // 每千行允许加权债务（不扣分）
const SCORE_K = 25;                      // 超出部分扣分系数

// 技术债标记定义：tag / 严重度 / 权重
const TAGS = [
  { tag: 'TODO',       severity: 'high',   weight: 3 },
  { tag: 'FIXME',      severity: 'high',   weight: 3 },
  { tag: 'XXX',        severity: 'medium', weight: 2 },
  { tag: 'HACK',       severity: 'medium', weight: 2 },
  { tag: 'OPTIMIZE',   severity: 'medium', weight: 2 },
  { tag: 'REFACTOR',   severity: 'medium', weight: 2 },
  { tag: 'NOTE',       severity: 'low',    weight: 1 },
  { tag: 'DEPRECATED', severity: 'low',    weight: 1 }
];

// 注释锚定：标记前必须跟注释符（// # <!-- /*），中间允许少量空白/词。
// 例：注释锚定能识别各类标记，具体清单见下方 TAGS 常量定义。
const COMMENT_ANCHOR = /(?:\/\/|#|<!--|\/\*)\s*\w*?\s*(TODO|FIXME|XXX|HACK|OPTIMIZE|REFACTOR|NOTE|DEPRECATED)\b/ig;
// 剥离字符串字面量（'...' "..." `...`），降低字符串内伪标记误报
const STRIP_STRINGS = /(["'`])(?:\\.|(?!\1).)*\1/g;

const SKIP_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out',
  'coverage', '.nyc_output', '.next', '.nuxt', '.svelte-kit', '.cache',
  '.tmp', 'tmp', 'vendor', 'bower_components', '.idea', '.vscode'
]);

const SRC_EXT = new Set([
  '.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx',
  '.py', '.rb', '.go', '.java', '.c', '.h', '.cpp', '.cc', '.hpp',
  '.cs', '.php', '.rs', '.swift', '.kt', '.scala', '.sh', '.bash',
  '.yml', '.yaml', '.toml', '.json', '.md', '.vue', '.svelte'
]);

// ---------------------------------------------------------------------------
// 通用工具
// ---------------------------------------------------------------------------

function readJsonSafe(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch (_) { return null; }
}

function isDir(p) {
  try { return fs.statSync(p).isDirectory(); } catch (_) { return false; }
}

function isFile(p) {
  try { return fs.statSync(p).isFile(); } catch (_) { return false; }
}

function fileSize(p) {
  try { return fs.statSync(p).size; } catch (_) { return 0; }
}

function countLines(text) {
  if (!text) return 0;
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text[i] === '\n') n++;
  return n;
}

// ---------------------------------------------------------------------------
// 扫描
// ---------------------------------------------------------------------------

function scanFile(full) {
  let text;
  try { text = fs.readFileSync(full, 'utf8'); } catch (_) { return null; }
  const stripped = text.replace(STRIP_STRINGS, '""'); // 字符串变空串，保留长度
  const lines = stripped.split('\n');
  const hits = [];
  COMMENT_ANCHOR.lastIndex = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    let m;
    while ((m = COMMENT_ANCHOR.exec(line)) !== null) {
      const tag = m[1].toUpperCase();
      if (TAGS.some(t => t.tag === tag)) hits.push(tag);
    }
  }
  return { hits, lineCount: lines.length };
}

function scanRoot(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const cur = stack.pop();
    let entries;
    try { entries = fs.readdirSync(cur, { withFileTypes: true }); }
    catch (_) { continue; }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name)) stack.push(full);
        continue;
      }
      if (!e.isFile()) continue;
      const ext = path.extname(e.name).toLowerCase();
      if (!SRC_EXT.has(ext)) continue;
      if (fileSize(full) > MAX_FILE_BYTES) continue;
      files.push(full);
    }
  }
  return files;
}

function topN(map, n) {
  return Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([p, c]) => ({ path: p, count: c }));
}

function analyze(root) {
  const files = scanRoot(root);
  const byTag = {};
  const bySeverity = { high: 0, medium: 0, low: 0 };
  const byFile = {};
  let totalTags = 0;
  let totalWeighted = 0;
  let srcLines = 0;
  let taggedFiles = 0;
  for (const t of TAGS) byTag[t.tag] = 0;

  for (const full of files) {
    const res = scanFile(full);
    if (!res) continue;
    if (res.hits.length) {
      byFile[full] = (byFile[full] || 0) + res.hits.length;
      taggedFiles++;
    }
    for (const tag of res.hits) {
      byTag[tag]++;
      const def = TAGS.find(t => t.tag === tag);
      bySeverity[def.severity]++;
      totalWeighted += def.weight;
      totalTags++;
    }
    srcLines += res.lineCount;
  }

  const density = srcLines > 0 ? totalTags / (srcLines / 1000) : 0;
  const weightedDensity = srcLines > 0 ? totalWeighted / (srcLines / 1000) : 0;
  const score = computeScore(weightedDensity);

  return {
    root, files: files.length, srcLines, taggedFiles,
    totalTags, totalWeighted, byTag, bySeverity,
    density: Number(density.toFixed(2)),
    weightedDensity: Number(weightedDensity.toFixed(2)),
    healthScore: score.score,
    verdict: score.verdict,
    topFiles: topN(byFile, 10)
  };
}

// ---------------------------------------------------------------------------
// 健康分
// ---------------------------------------------------------------------------

function computeScore(weightedDensity) {
  const over = Math.max(0, weightedDensity - SCORE_FREE);
  const penalty = Math.min(100, over * SCORE_K);
  const score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  let verdict = '健康';
  if (score < 40) verdict = '债务沉重';
  else if (score < 70) verdict = '债务偏高';
  else if (score < 90) verdict = '基本健康';
  return { score, verdict };
}

// ---------------------------------------------------------------------------
// 警告 + 门禁
// ---------------------------------------------------------------------------

function buildWarnings(a) {
  const warnings = [];
  if (a.files === 0) warnings.push('no-source: 未扫描到任何源码文件');
  if (a.density > SOFT_DENSITY) {
    warnings.push('high-density: 技术债密度偏高 (' + a.density + ' 标记/千行，软阈值 ' + SOFT_DENSITY + ')');
  }
  if (a.bySeverity.high > 0) {
    warnings.push('has-high-severity: 存在阻塞级标记 (TODO/FIXME) 共 ' + a.bySeverity.high + ' 个');
  }
  return warnings;
}

function applyGate(a, args, warnings) {
  const gate = [];
  if (args.maxDensity !== undefined) {
    if (!Number.isFinite(args.maxDensity)) { console.error('[debtlens] 错误：--max-density 必须为数字'); return { code: 2, gate: null }; }
    if (a.density > args.maxDensity) gate.push('密度 ' + a.density + ' > --max-density ' + args.maxDensity);
  }
  if (args.maxWeighted !== undefined) {
    if (!Number.isFinite(args.maxWeighted)) { console.error('[debtlens] 错误：--max-weighted 必须为数字'); return { code: 2, gate: null }; }
    if (a.weightedDensity > args.maxWeighted) gate.push('加权密度 ' + a.weightedDensity + ' > --max-weighted ' + args.maxWeighted);
  }
  if (args.maxTotal !== undefined) {
    if (!Number.isFinite(args.maxTotal)) { console.error('[debtlens] 错误：--max-total 必须为整数'); return { code: 2, gate: null }; }
    if (a.totalTags > args.maxTotal) gate.push('总标记数 ' + a.totalTags + ' > --max-total ' + args.maxTotal);
  }
  if (args.failOnTags) {
    const want = String(args.failOnTags).split(',').map(s => s.trim().toUpperCase()).filter(Boolean);
    for (const w of want) {
      if ((a.byTag[w] || 0) > 0) gate.push('出现禁止标记 ' + w + ' (' + a.byTag[w] + ' 个)');
    }
  }
  if (args.failOnIssues && warnings.length > 0) {
    gate.push('存在 ' + warnings.length + ' 条警告');
  }
  return { code: gate.length ? 2 : 0, gate };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { _: [], root: process.cwd(), json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === 'doctor' || a === 'scan') args._.push(a);
    else if (a === '--root') args.root = argv[++i];
    else if (a === '--json') args.json = true;
    else if (a === '--max-density') args.maxDensity = parseFloat(argv[++i]);
    else if (a === '--max-weighted') args.maxWeighted = parseFloat(argv[++i]);
    else if (a === '--max-total') args.maxTotal = parseInt(argv[++i], 10);
    else if (a === '--fail-on-tags') args.failOnTags = argv[++i];
    else if (a === '--fail-on-issues') args.failOnIssues = true;
    else if (a === '--version' || a === '-V') args.version = true;
    else if (a === '--help' || a === '-h') args.help = true;
  }
  return args;
}

function printHelp() {
  console.log([
    'debtlens — 零依赖单文件技术债密度扫描 CLI',
    '',
    '用法:',
    '  debtlens [doctor] [--root <dir>] [--json] [--max-density <n>] [--max-weighted <n>]',
    '                       [--max-total <n>] [--fail-on-tags <csv>] [--fail-on-issues]',
    '',
    '  doctor  静态扫描（默认）：注释锚定识别各类技术债标记，按严重度加权统计密度，',
    '         给健康分 + CI 门禁（完整标记清单见源码 TAGS 常量）',
    '',
    '门禁（非整数阈值直接 exit 2）：',
    '  --max-density <n>   标记密度(标记/千行) 超过则失败',
    '  --max-weighted <n>  加权密度(加权/千行) 超过则失败',
    '  --max-total <n>     总标记数超过则失败',
    '  --fail-on-tags <csv> 出现任一指定标记(逗号分隔)则失败，如 FIXME,TODO',
    '  --fail-on-issues    存在任何警告则失败',
    '',
    '其他：',
    '  --version, -V       打印版本号',
    '  --help, -h          打印本帮助',
    '',
    '健康分：每千行允许加权债务 ' + SCORE_FREE + ' 不扣分，超出按系数 ' + SCORE_K + ' 扣，0-100。'
  ].join('\n'));
}

function printReport(a, warnings, gate) {
  console.log('debtlens · 技术债密度扫描 · root=' + a.root);
  console.log('  扫描源码文件 : ' + a.files);
  console.log('  源码总行数   : ' + a.srcLines);
  console.log('  含债文件数   : ' + a.taggedFiles);
  console.log('  技术债标记   : ' + a.totalTags + ' (加权 ' + a.totalWeighted + ')');
  console.log('  严重度分布   : high=' + a.bySeverity.high + ' medium=' + a.bySeverity.medium + ' low=' + a.bySeverity.low);
  console.log('  密度         : ' + a.density + ' 标记/千行');
  console.log('  加权密度     : ' + a.weightedDensity + ' 加权/千行');
  const tagLine = TAGS.filter(t => a.byTag[t.tag] > 0).map(t => t.tag + '=' + a.byTag[t.tag]).join('  ');
  if (tagLine) console.log('  标记明细     : ' + tagLine);
  if (a.topFiles.length) {
    console.log('  债务 Top 文件:');
    for (const f of a.topFiles) console.log('    - ' + f.path + ' (' + f.count + ')');
  }
  console.log('  健康分       : ' + a.healthScore + ' / 100  [' + a.verdict + ']');
  if (a.elapsed !== undefined) console.log('  耗时         : ' + a.elapsed + ' ms');
  if (warnings.length) {
    console.log('  警告:');
    for (const w of warnings) console.log('    [警告] ' + w);
  } else {
    console.log('  警告: 无');
  }
  if (gate) {
    if (gate.length) {
      console.log('  门禁: 失败');
      for (const g of gate) console.log('    [失败] ' + g);
    } else {
      console.log('  门禁: 通过');
    }
  }
}

function main(argv) {
  const args = parseArgs(argv);
  if (args.help) { printHelp(); return 0; }
  if (args.version) {
    const pkg = readJsonSafe(path.join(__dirname, 'package.json'));
    console.log('debtlens ' + (pkg && pkg.version ? pkg.version : '1.0.0'));
    return 0;
  }

  const root = path.resolve(args.root);
  if (!isDir(root)) {
    console.error('[debtlens] 错误：root 不是有效目录 -> ' + root);
    return 2;
  }

  const t0 = Date.now();
  const a = analyze(root);
  a.elapsed = Date.now() - t0;
  const warnings = buildWarnings(a);
  const gateRes = applyGate(a, args, warnings);
  if (gateRes.gate === null) return gateRes.code; // 阈值非法已报错

  if (args.json) {
    const report = {
      mode: 'doctor', root, files: a.files, srcLines: a.srcLines,
      taggedFiles: a.taggedFiles, totalTags: a.totalTags, totalWeighted: a.totalWeighted,
      byTag: a.byTag, bySeverity: a.bySeverity, density: a.density,
      weightedDensity: a.weightedDensity, healthScore: a.healthScore, verdict: a.verdict,
      topFiles: a.topFiles, elapsed: a.elapsed, warnings,
      gate: { passed: gateRes.gate.length === 0, failures: gateRes.gate }
    };
    console.log(JSON.stringify(report, null, 2));
  } else {
    printReport(a, warnings, gateRes.gate);
  }
  return gateRes.code;
}

module.exports = {
  TAGS, SRC_EXT, SKIP_DIRS, MAX_FILE_BYTES, SOFT_DENSITY, SCORE_FREE, SCORE_K,
  readJsonSafe, isDir, isFile, fileSize, countLines,
  scanFile, scanRoot, analyze, computeScore, buildWarnings, applyGate, parseArgs
};

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (e) {
    console.error('[debtlens] 运行异常: ' + (e && e.message));
    process.exit(1);
  }
}
