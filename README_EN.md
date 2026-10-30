**中文** · [README.md](./README.md)

> [!WARNING]
> **⚠️ This tool has been merged into the [doctors](https://github.com/huanweide/doctors) monorepo and is no longer maintained here.**
>
> The source now lives at [`doctors/packages/debtlens/`](https://github.com/huanweide/doctors/tree/main/packages/debtlens). Inside doctors it runs as the `doctors debt` subcommand (or `node packages/debtlens/index.js`). This repository no longer accepts changes — please use <https://github.com/huanweide/doctors>.

<!-- badges -->
[![License](https://img.shields.io/github/license/huanweide/debtlens)](LICENSE)
[![Stars](https://img.shields.io/github/stars/huanweide/debtlens)](https://github.com/huanweide/debtlens/stargazers)
[![zero-dep checkup CLI](https://img.shields.io/badge/zero--dep%20checkup%20CLI-18%20tools-22c55e)](https://github.com/huanweide/family-showcase)
<!-- /badges -->

**🔧 Part of the [huanweide zero-dependency CLI family](https://github.com/huanweide/family-showcase) (18 single-file tools). Use it standalone, as a subcommand inside the [doctors](https://github.com/huanweide/doctors) monorepo, or run everything together via [enghealth](https://github.com/huanweide/enghealth).**

# debtlens

> Zero-dependency, single-file Node CLI · tech-debt density scanner

See at a glance how much "debt" your code is carrying. `debtlens` scans for tech-debt markers (`TODO / FIXME / XXX / HACK / OPTIMIZE / REFACTOR / NOTE / DEPRECATED`) anchored to comments, weights them by severity into a density, and gives you a **0–100 health score** and a CI-ready **gate**.

Zero dependencies. Zero config. Offline. Single file. Runs out of the box.

## Who should use this

- Teams that want a numeric, CI-enforceable tech-debt density metric instead of "gut feeling" reviews.
- Projects accumulating TODO/FIXME across many files with no one measuring the pile.
- Anyone who wants a deterministic, dependency-free checkup.

## Who should not use this

- If you already run a heavy maintainability platform (SonarQube, etc.) and its TODO tracking is enough.
- Note: this repo is deprecated — prefer `doctors debt` for new setups.

## Why

Every real codebase accumulates TODO/FIXME, but they're scattered everywhere and nobody measures them. When a team asks "how much tech debt is too much", the answer is either manual code review by feel, or a heavily-configured tool.

`debtlens` collapses that into one command: zero dependencies, zero config, one file — run it and you get density and a health score, and you can gate CI on it.

## Features

- **Zero-dependency single file**: just one `index.js`, run with `node index.js ./` — no `npm install`.
- **Comment-anchored, low false positives**: markers must follow a comment token (`// # <!-- /*`), and string literals are stripped first, so `const todo = 1` or `"TODO: msg"` won't be counted as fake markers.
- **Severity weighting**: `TODO/FIXME` (high, ×3) · `XXX/HACK/OPTIMIZE/REFACTOR` (medium, ×2) · `NOTE/DEPRECATED` (low, ×1). Weighted density reflects real risk better than a raw count.
- **Health score + gate**: 0–100 score (1 weighted debt per 1k lines is free; beyond that it deducts by factor 25). Every gate threshold is strictly validated — non-number / non-integer / negative / empty / missing / unknown marker name all exit `2`, never silently pass.
- **Three-state gate, never a fake green**: exit code `0 = pass` (gate configured and all met), `2 = fail` (unmet item / invalid param), `3 = inconclusive` (**no gate threshold configured, or scan input empty — conclusion untrustworthy, not a pass**). See "Exit code contract" below.
- **The health score is a dangerous metric — no scan, no score**: when 0 files are scanned the health score is `null` (`verdict: cannot evaluate`), not a deceptive `100`. JSON's `basisComplete: false` tells you whether the conclusion can be trusted.
- **Safe**: pure local read-only, no network, no execution surface; `statSync` validates the root before scanning; files >5MB skipped to avoid OOM; `node_modules/.git` and similar auto-skipped.

## Install and run

This project is **not published on npm**. The npm `debtlens` is an unrelated project ([ColumbusLabs/DebtLens](https://github.com/ColumbusLabs/DebtLens), a TypeScript/JavaScript maintainability scanner); `npm i -g debtlens` installs that one instead and hijacks the `debtlens` command name. Use the source directly:

```bash
git clone https://github.com/huanweide/debtlens.git
node debtlens/index.js --root ./your-repo
```

Or copy it as a single file into your own repo (it only depends on Node built-ins, no `npm install`).

> Requires Node 18+.

## Usage

```bash
# Scan the current directory by default
debtlens

# Scan a specific directory, output JSON (for pipelines)
debtlens --root ./src --json

# CI gate: fail if total markers exceed 50
debtlens --root . --max-total 50

# Density gate: fail if markers per 1k lines exceed 10
debtlens --root . --max-density 10

# Weighted-density gate
debtlens --root . --max-weighted 20

# Forbid any FIXME (fail on appearance)
debtlens --root . --fail-on-tags FIXME

# Treat any warning as a failure
debtlens --root . --fail-on-issues
```

### Gate parameters

| Parameter | Meaning | Value rule | Fails when |
| --- | --- | --- | --- |
| `--max-density <n>` | marker density (markers / 1k lines) | non-negative decimal | exceeds `n` |
| `--max-weighted <n>` | weighted density (weighted / 1k lines) | non-negative decimal | exceeds `n` |
| `--max-total <n>` | total marker count | non-negative integer | exceeds `n` |
| `--fail-on-tags <csv>` | forbidden markers (comma-separated) | must be known marker names | any appears |
| `--fail-on-issues` | fail on any warning | switch | any warning present |

Available marker names (from the source `TAGS` constant): `TODO` `FIXME` `XXX` `HACK` `OPTIMIZE` `REFACTOR` `NOTE` `DEPRECATED`

### Exit code contract

| Exit code | State | Meaning |
| --- | --- | --- |
| `0` | `pass` | gate thresholds configured, and all met |
| `2` | `fail` | gate thresholds configured and an item is unmet; **or** a parameter is invalid (bad threshold, unknown option, invalid root) |
| `3` | `inconclusive` | **no gate threshold configured, or scan input is empty — conclusion untrustworthy, not a pass** |
| `1` | internal error | only for unexpected runtime exceptions; the gate itself never returns 1 |

> **Why `3` exists**: the worst failure mode for a scanning gate is "scanned 0 objects but reported pass" — a green light on CI that never goes out. So whenever the input is untrustworthy or the gate isn't configured, it explicitly returns 3 to tell you "this run proved nothing".
>
> The decision order is fixed: ① is a threshold configured? → ② is the input trustworthy? → ③ is anything unmet? An empty input makes `--fail-on-issues` return `3` rather than `2`, because that "warning" is itself a product of the empty scan and proves nothing.
>
> A wrong parameter = no gate. All of the following exit `2`, never silently pass: threshold missing its value / empty string / trailing junk (`5abc`) / decimal where an integer is expected / negative / hex / `Infinity`; a misspelled marker name in `--fail-on-tags`; `--root` missing its value or swallowing the next flag; any unknown option.

## CI integration

```yaml
# .github/workflows/debt.yml
- name: Tech-debt gate
  run: node .github/debtlens/index.js --root . --max-density 10 --fail-on-tags FIXME
```

> If you clone this repo into CI, write an explicit `node <path>/index.js` — don't use `npx -y debtlens`; the npm name belongs to someone else's package.
>
> In CI, **pass a gate threshold explicitly**. With no threshold configured the exit code is `3` (inconclusive), which will immediately turn the pipeline red — deliberately: the gate must be defined by the user, the tool shouldn't guess for you.

## How it differs from leasot

[leasot](https://github.com/codefin/leasot) can also extract TODOs, but it's a dependency package oriented toward "enumerating and listing", without a health score or CI gate. `debtlens` is zero-dependency, single-file, runs out of the box, and closes the loop "density → health score → gate", which fits CI better.

## In the same family

`debtlens` is the "tech-debt density" member of the huanweide zero-dependency CLI family:

- **devdoctor** — dependency checkup (bloat / licenses / circular deps / plaintext secrets)
- **testlite** — test-hygiene checkup (framework / density / coverage)
- **debtlens** — tech-debt density checkup (TODO/FIXME marker density + health score) ← you are here

All three are zero-dependency single files sharing the same engineering rules; use them alone or combine them into a project checkup pipeline.

## Limitations

- Marker recognition is a "comment-anchored + string-stripped" heuristic; unusual forms (e.g. a marker folded across a block-comment line break) may be missed. The numbers are **estimates** — pair with manual review in heavy cases.
- The severity weights are sensible defaults; adjust them per team habit in the `TAGS` constant of `index.js`.

## Develop and test

Zero dependencies, run directly with `node`, no `npm install`:

```bash
node test/unit.test.js     # 15 groups of unit tests: scan / three-state judgment / param parsing / self gate
node test/smoke-cli.js     # 29 spawn-level smoke tests: really spawns processes to pin the exit-code contract
npm test                   # equivalent to running the two above in order
```

The two test layers are deliberately separated: unit tests only cover exported pure functions and **never touch `process.exitCode`**; the exit-code contract can only be verified by `smoke-cli.js` (or `spawn-cli.js`) using `spawnSync` to really spawn a process. You can change an exit code and still have all unit tests green — only the smoke test catches it.

## License

MIT, see [LICENSE](LICENSE).

---

## Author

Maintained by **huanweide** · [GitHub](https://github.com/huanweide)

## Portability · zero-dependency promise

- Zero runtime dependencies: uses only one Node built-in module, no `npm install`.
- Single file: the whole tool is one `index.js`, copy it into any repo and it works.
- Offline / cross-platform: Node 18+ is enough, no network, no OS preference.
- One command: `node index.js --root ./src` (see Usage above).

← [Back to the zero-dependency CLI family overview](https://github.com/huanweide/family-showcase)
