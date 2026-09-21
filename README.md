# debtlens

> 零依赖单文件 Node CLI · 技术债密度扫描器

一眼看清你的代码里「欠了多少债」。注释锚定扫描 `TODO / FIXME / XXX / HACK / OPTIMIZE / REFACTOR / NOTE / DEPRECATED` 等技术债标记，按严重度加权统计密度，给出 **0–100 健康分** 和可直接进 CI 的**门禁**。

零依赖、零配置、离线、单文件，开箱即跑。

```
debtlens · 技术债密度扫描 · root=/path/to/repo
  扫描源码文件 : 42
  源码总行数   : 3120
  含债文件数   : 11
  技术债标记   : 27 (加权 58)
  严重度分布   : high=9 medium=12 low=6
  密度         : 8.65 标记/千行
  加权密度     : 18.59 加权/千行
  标记明细     : TODO=9 FIXME=0 XXX=3 HACK=2 OPTIMIZE=4 REFACTOR=3 NOTE=5 DEPRECATED=1
  健康分       : 53 / 100  [债务偏高]
  警告:
    [警告] high-density: 技术债密度偏高 (8.65 标记/千行，软阈值 8)
    [警告] has-high-severity: 存在阻塞级标记 (TODO/FIXME) 共 9 个
  门禁: 通过
```

## 为什么

任何带代码的项目都堆着 TODO/FIXME，但它们散落各处、无人衡量。团队想知道「技术债多到什么程度」时，要么靠人肉 code review 凭感觉，要么装一个重配置的工具。

`debtlens` 把这件事压成一个命令：零依赖、零配置、一个文件，跑完直接给你密度和健康分，还能卡 CI 门禁。

## 特性

- **零依赖单文件**：只有一个 `index.js`，`node index.js ./` 即可，无需 `npm install`。
- **注释锚定降误报**：标记必须跟在 `// # <!-- /*` 注释符之后，且扫描前先剥离字符串字面量，排除 `const todo = 1`、`"TODO: msg"` 这类伪标记。
- **严重度加权**：`TODO/FIXME`(高, ×3) · `XXX/HACK/OPTIMIZE/REFACTOR`(中, ×2) · `NOTE/DEPRECATED`(低, ×1)，加权密度比纯计数更贴近真实风险。
- **健康分 + 门禁**：0–100 健康分（每千行允许加权债务 1 不扣分，超出按系数 25 扣）；CI 门禁阈值一律 `Number.isFinite` 校验，非整数直接 `exit 2`，绝不静默放行。
- **安全**：纯本地只读、不联网、无执行面；扫描前 `statSync` 校验 root；>5MB 文件跳过防 OOM；自动跳过 `node_modules/.git` 等目录。

## 安装

```bash
# 全局
npm i -g debtlens
# 或直接用单文件（无需安装）
node /path/to/debtlens/index.js ./your-repo
```

## 用法

```bash
# 默认扫描当前目录
debtlens

# 扫描指定目录，输出 JSON（便于流水线解析）
debtlens --root ./src --json

# CI 门禁：标记总数超过 50 直接失败
debtlens --root . --max-total 50

# 密度门禁：每千行标记数超过 10 失败
debtlens --root . --max-density 10

# 加权密度门禁
debtlens --root . --max-weighted 20

# 禁止出现任何 FIXME（出现即失败）
debtlens --root . --fail-on-tags FIXME

# 任何警告都当作不合格
debtlens --root . --fail-on-issues
```

### 门禁参数

| 参数 | 含义 | 失败条件 |
| --- | --- | --- |
| `--max-density <n>` | 标记密度（标记/千行） | 超过 `n` |
| `--max-weighted <n>` | 加权密度（加权/千行） | 超过 `n` |
| `--max-total <n>` | 总标记数 | 超过 `n` |
| `--fail-on-tags <csv>` | 禁止出现的标记（逗号分隔） | 出现任一 |
| `--fail-on-issues` | 存在任何警告即失败 | 有警告 |

> 所有阈值非整数一律 `exit 2`（防呆），不会悄悄放行。

## CI 集成示例

```yaml
# .github/workflows/debt.yml
- name: 技术债门禁
  run: npx -y debtlens --root . --max-density 10 --fail-on-tags FIXME
```

## 与 leasot 的区别

[leasot](https://github.com/codefin/leasot) 也能提取 TODO，但它是依赖包、偏「枚举列出」，不带健康分与 CI 门禁。`debtlens` 零依赖单文件、开箱即跑，且把「密度 → 健康分 → 门禁」做成闭环，更适合塞进 CI。

## 与 family 的关系

`debtlens` 是「代码健康 family」的第三块：

- **devdoctor** — 依赖体检（胖瘦 / 许可证 / 循环依赖 / 明文密钥）
- **testlite** — 测试卫生体检（框架 / 密度 / 覆盖率）
- **debtlens** — 技术债密度体检（TODO/FIXME 等标记密度 + 健康分）← 你在这

三者都是零依赖单文件、同一套工程准则，可单独用，也可组合成项目体检流水线。

## 局限

- 标记识别基于「注释锚定 + 字符串剥离」的启发式，对非常规写法（如块注释折行内的标记）可能漏检；统计为**估算**，重度场景请结合人工 review。
- 严重度权重为通用默认值，可按团队习惯在 `index.js` 的 `TAGS` 调整。

## 许可

MIT © huanweide

---

## 作者

由 **ReTr · 樊斯瑞** 维护 · [GitHub 主页](https://github.com/huanweide)

## CI 门禁用法

开箱即可接入 CI：在流水线中运行本工具，它会输出健康分与严重度；若存在不达标项会以非 0 退出码结束，从而拦下问题提交（具体参数见上方「快速开始」）。

## 赞助支持

如果这个项目帮到了你，欢迎 [点 Star](https://github.com/huanweide/debtlens) 支持；也可微信扫码自愿赞助（收款码见 `sponsor/wechat-qr.png`，作者本人带 Tri 水印的码，纯静态图片、不含任何密钥）。

## 许可证

详见 [LICENSE](LICENSE)。
