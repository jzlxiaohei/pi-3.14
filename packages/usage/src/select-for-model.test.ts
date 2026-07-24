import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveUsageProviderId,
  selectQuotasForModel,
} from "./select-for-model.js";
import type { ProviderQuotaSnapshot } from "./types.js";

const codexOk: ProviderQuotaSnapshot = {
  provider: "openai-codex",
  status: "ok",
  fetchedAt: 1,
  planLabel: "Plus",
  windows: [
    { id: "5h", label: "5h", usedPercent: 12, resetAtMs: null, windowSeconds: 18_000 },
    { id: "7d", label: "7d", usedPercent: 34, resetAtMs: null, windowSeconds: 604_800 },
  ],
};

const anthropicOk: ProviderQuotaSnapshot = {
  provider: "anthropic",
  status: "ok",
  fetchedAt: 1,
  planLabel: "Pro",
  windows: [
    { id: "5h", label: "5h", usedPercent: 50, resetAtMs: null, windowSeconds: 18_000 },
  ],
};

const xaiOk: ProviderQuotaSnapshot = {
  provider: "xai",
  status: "ok",
  fetchedAt: 1,
  planLabel: "mgmt",
  windows: [
    { id: "credits", label: "credits", usedPercent: 20, resetAtMs: null, windowSeconds: null },
  ],
};

describe("resolveUsageProviderId", () => {
  it("maps known model providers onto quota meters", () => {
    assert.equal(resolveUsageProviderId("openai-codex"), "openai-codex");
    assert.equal(resolveUsageProviderId("anthropic"), "anthropic");
    assert.equal(resolveUsageProviderId("openrouter"), "openrouter");
    assert.equal(resolveUsageProviderId("xai"), "xai");
  });

  it("returns null when the model provider has no quota meter", () => {
    assert.equal(resolveUsageProviderId("unknown-provider"), null);
    assert.equal(resolveUsageProviderId(null), null);
    assert.equal(resolveUsageProviderId(undefined), null);
    assert.equal(resolveUsageProviderId(""), null);
  });
});

describe("selectQuotasForModel", () => {
  it("keeps only the active model provider's quota snapshot", () => {
    const selected = selectQuotasForModel([codexOk, anthropicOk], "anthropic");
    assert.deepEqual(selected, [anthropicOk]);
  });

  it("selects xai meter without falling back to other providers", () => {
    assert.deepEqual(selectQuotasForModel([codexOk, xaiOk], "xai"), [xaiOk]);
    assert.deepEqual(selectQuotasForModel([codexOk, anthropicOk], "xai"), []);
  });

  it("returns an empty list when model provider is unknown or missing", () => {
    assert.deepEqual(selectQuotasForModel([codexOk], null), []);
    assert.deepEqual(selectQuotasForModel([codexOk], "openai"), []);
  });
});
