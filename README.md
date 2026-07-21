# pi-3.14

A focused TypeScript monorepo for reusable PI model contracts, runtime hosts,
subagent orchestration, and session analysis.

## Packages

- `@pi-3.14/model` — JSON-safe host contracts and model types.
- `@pi-3.14/runtime` — embedded and RPC PI runtime hosts.
- `@pi-3.14/subagents` — concurrent subagent orchestration and tool integration.
- `@pi-3.14/session` — PI session JSONL parsing and analysis.

## Apps

- `@pi-3.14/desktop` — reusable Electron + SolidJS + Orbit desktop template.

## Development

Requires Node.js 22 or newer and pnpm 11.10.0.

```sh
pnpm install
pnpm typecheck
pnpm test
pnpm build
pnpm pack:dry-run
```

Desktop template:

```sh
pnpm desktop:dev
pnpm desktop:build
pnpm desktop:package
```

## License

MIT
