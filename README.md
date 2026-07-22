# PIE

Personal code agent desktop app — habits, skills, workflows, and subagents in one place.

Shared PI runtime packages publish under the `@pi-3.14` npm scope.

## Packages

- `@pi-3.14/model` — JSON-safe host contracts and model types.
- `@pi-3.14/runtime` — embedded and RPC PI runtime hosts.
- `@pi-3.14/subagents` — concurrent subagent orchestration and tool integration.
- `@pi-3.14/session` — PI session JSONL parsing and analysis.

## Apps

- `pie` — Electron + SolidJS + Orbit desktop app.

## Development

Requires Node.js 22 or newer and pnpm 11.10.0.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm pack:dry-run
```

Desktop app:

```sh
pnpm desktop:dev
pnpm desktop:build
pnpm desktop:package
```

Optional **Engineering path** in the desktop app can use Matt engineering skills
in the **project** workspace (not vendored here; global PI install is optional).
See [`apps/desktop/README.md`](apps/desktop/README.md#engineering-path-optional).

## License

MIT
