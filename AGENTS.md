# second-brain-dashboard

This repo hosts the [Hearth](https://github.com/ondreu/Hearth) Obsidian plugin under [`hearth/`](hearth/). There is no code at the repo root — all source, build tooling, tests, and docs live inside `hearth/`.

When working on the plugin itself, treat `hearth/` as the project root: run npm commands from inside it (`cd hearth && npm ci`), and follow `hearth/README.md`, `hearth/CONTRIBUTING.md`, and `hearth/RELEASING.md` for conventions.

CI at the repo root (`.github/workflows/lint.yml`) runs `hearth`'s lint, test, typecheck, and build steps via `working-directory: hearth`. `hearth/.github/workflows/` and `hearth/.claude/skills/` are inactive copies from upstream (GitHub only executes workflows at the repo root) — do not expect them to run automatically here.
