# `@pi-3.14/usage`

Provider subscription / rate-limit quota lookups, plus estimated context
composition (message-type token shares).

## Scope

| Provider | Auth | Endpoint | Notes |
|---|---|---|---|
| `openai-codex` | ChatGPT OAuth | `GET …/wham/usage` | Undocumented; 5h + 7d windows |
| `anthropic` | Claude OAuth | `GET …/api/oauth/usage` | Undocumented; needs UA-ish headers |
| `openrouter` | API key | `GET …/api/v1/key` | Credits / limit |
| `xai` | Management Key | `GET management-api…/prepaid/balance` (+ spending limits / invoice preview) | Official; not OAuth / inference key |

### xAI setup

Billing is on the **Management API** (`https://management-api.x.ai`). The
grok-cli OAuth token and the inference API key **cannot** call it.

In `~/.pi/agent/auth.json`, add a Management Key next to the existing `xai`
entry (Console → Settings → Management Keys):

```json
{
  "xai": {
    "type": "oauth",
    "access": "…",
    "refresh": "…",
    "expires": 0,
    "managementKey": "xai-…",
    "teamId": "optional-uuid"
  }
}
```

`teamId` is optional — when omitted, the package resolves it from
`GET /auth/management-keys/validation`. Without `managementKey`, the meter is
skipped (UI: no quota credentials).

These subscription endpoints for Codex / Anthropic are **not** stable public
APIs. Callers must treat `unavailable` / parse failures as normal, and UI must
not pretend they are billing-grade. xAI Management billing is official but
still depends on key permissions and team setup.

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
