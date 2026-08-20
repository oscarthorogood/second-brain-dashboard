# second-brain-dashboard

This repo hosts [Hearth](https://github.com/ondreu/Hearth), an Obsidian plugin providing a customizable home screen dashboard (search, cards, launcher) for your vault.

The plugin lives entirely under [`hearth/`](hearth/) — see [`hearth/README.md`](hearth/README.md) for what it does and how to use it, [`hearth/CONTRIBUTING.md`](hearth/CONTRIBUTING.md) for development setup, and [`hearth/RELEASING.md`](hearth/RELEASING.md) for the release process.

## Working in this repo

```bash
cd hearth
npm install
npm run dev     # watch build
npm run lint
npm test
npm run build
```

CI (`.github/workflows/lint.yml`) runs lint, tests, typecheck, and build from `hearth/` on every push and pull request.

`hearth/` was imported as a snapshot of the upstream Hearth repository (no upstream git history). Its own nested `.github/workflows/` and `.claude/skills/` are inactive here (GitHub only runs workflows from the repo root) and are kept for reference against the upstream project.
