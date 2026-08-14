# 选题记录 · debtlens（Overlord 单项目深耕 · 2026-08-14）

## 决策背景
- `active-project.md` 本轮 `next_action=select`（testlite 已成熟上架）。
- core-memory 第140/142条裁定：「零依赖单文件 CLI」可落地切口已枯竭 → 转质量深化/组合叙事。
- family 现状（8 个）：safeguard / idiot-index / recall-cli / pagext / chaineye / licguard / devdoctor（依赖体检四维）/ testlite（测试卫生体检）。
- devdoctor + testlite 已拼成「代码健康 family」前两块（依赖干净 / 测试健康），本次取第三块：**技术债密度**。

## 五人格并行调研（主代理亲做，本环境 Agent 派发不可靠，按第9条降级）
- **PG**：做减法、给用户杠杆。技术债扫描让用户一键看清"代码里欠了多少债"，零依赖开箱即用，符合 small simple leverage tool。
- **张雪峰**：工程刚需、受众极大。任何带代码的项目都有 TODO/FIXME，技术债密度是 code review 与 CI 的刚需指标。
- **Naval**：特定知识（哪些标记算债务）× 技术杠杆（单文件分发）× 零边际成本（本地跑）。挑"巨头嫌小、OSS 嫌重"的缝隙——leasot 需装、配置重，我们零依赖开箱。
- **乔布斯**：体验优先、极简。一个命令 `debtlens ./` 出技术债报告 + 健康分，零配置，不折腾。
- **马斯克（终裁）四问硬门槛**：
  ① 受众量：任何代码仓库（大）✓
  ② 新机会实用性：零依赖开箱看技术债密度 + CI 门禁（高）✓
  ③ 比竞品更好或市场无：leasot 需 `npm install` + 偏"列出"不评分；我们零依赖单文件 + 加权健康分 + CI 门禁，差异化明确 ✓
  ④ 一个上午能否确定性交付：纯静态正则扫描，零依赖单文件，可确定性交付 ✓
  **终裁：采纳 → 命名 `debtlens`（技术债透镜）。**

## 差异化定位
- vs leasot：leasot 需装依赖、偏"枚举 TODO"；debtlens 零依赖单文件 + 加权健康分 + CI 门禁三件套同时成立，且纳入 family 组合叙事。
- 与 devdoctor/testlite 拼成「代码健康 trio」：依赖干净（devdoctor）+ 测试健康（testlite）+ 技术债清晰（debtlens）。

## 落选保留（本次无新落选，沿用 core-memory 现有萃取）
- nono / Book-to-Skill / formlite / Jay / SkillForge 仍偏离零依赖基线，留池待后续。

## 技术设计要点（首版）
- 注释锚定扫描：`(?:\\/\\/|#|<!--|\\/\\*)\\s*\\w*?\\s*(TAG)\\b` 锚定注释符，大幅降误报（排除 `const todo=1`、字符串内 `"TODO"`）。
- 标记集：TODO/FIXME/BUG→high（注：BUG 易误报，初版剔除，仅留高置信标记）/ XXX/HACK/OPTIMIZE/REFACTOR→medium / NOTE/DEPRECATED→low。
- 严重度加权债务：high=3, medium=2, low=1；加权密度 → 健康分 = 100 - min(100, weightedDensity*K)。
- 门禁：`--max-density / --max-weighted / --max-total / --fail-on-tags / --fail-on-issues`，阈值一律 Number.isFinite 校验（非整数 exit 2）。
- 安全：纯本地只读、不联网、无执行面；root statSync 先验；>5MB 跳过防 OOM。
