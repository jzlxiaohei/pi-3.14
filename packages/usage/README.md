# `@pi-3.14/usage`

Provider subscription / rate-limit quota lookups, plus estimated context
composition (message-type token shares).

## Scope

| Provider | Auth | Endpoint | Notes |
|---|---|---|---|
| `openai-codex` | ChatGPT OAuth | `GET …/wham/usage` | Undocumented; 5h + 7d windows |
| `anthropic` | Claude OAuth | `GET …/api/oauth/usage` | Undocumented; needs UA-ish headers |
| `openrouter` | API key | `GET …/api/v1/key` | Credits / limit |

Other model providers (e.g. `xai`) currently have **no** known subscription
meter. UI should call `selectQuotasForModel(quotas, modelProvider)` and must
**not** fall back to another provider's windows.

These subscription endpoints are **not** stable public APIs. Callers must treat
`unavailable` / parse failures as normal, and UI must not pretend they are
billing-grade.

Context composition (`estimateContextComposition`) is always local estimation
(`chars / 4`), not provider-billed tokens.

## Usage

```ts
import {
  fetchProviderQuotas,
  estimateContextComposition,
  selectQuotasForModel,
} from "@pi-3.14/usage";
import { fetchPiProviderQuotas, loadPiAuthCredentials } from "@pi-3.14/usage/node";

const quotas = await fetchPiProviderQuotas();
// or: await fetchProviderQuotas(await loadPiAuthCredentials());
const forModel = selectQuotasForModel(quotas, activeModel.provider);

const composition = estimateContextComposition({
  systemPrompt: "...",
  messages: [{ role: "user", text: "hi" }],
});
```

Node-only helpers (`loadPiAuthCredentials`, `fetchPiProviderQuotas`) live under
`@pi-3.14/usage/node` so browser/renderer code can import the pure composition
helpers without pulling `node:fs`.
