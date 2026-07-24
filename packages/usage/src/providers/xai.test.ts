import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fetchXaiQuota } from "./xai.js";
import type { ProviderAuthCredential } from "../types.js";

const credential: ProviderAuthCredential = {
  provider: "xai",
  accessToken: "xai-mgmt-test-key",
  teamId: "team-1",
};

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("fetchXaiQuota", () => {
  it("maps prepaid balance and soft spending limit into credits + month window", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/management-keys/validation")) {
        return jsonResponse(200, {
          name: "pi meter",
          teamId: "team-1",
          scopeId: "team-1",
        });
      }
      if (url.includes("/prepaid/balance")) {
        // Accounting inverted: total -2500 cents ⇒ $25 remaining.
        return jsonResponse(200, { total: { val: "-2500" }, changes: [] });
      }
      if (url.includes("/postpaid/spending-limits")) {
        return jsonResponse(200, {
          spendingLimits: { softSl: { val: "20000" }, effectiveSl: { val: "20000" } },
        });
      }
      if (url.includes("/postpaid/invoice/preview")) {
        return jsonResponse(200, {
          coreInvoice: {
            amountAfterVat: "5000",
            prepaidCreditsUsed: { val: "100" },
          },
          effectiveSpendingLimit: "20000",
        });
      }
      return jsonResponse(404, { error: "unexpected " + url });
    };

    const snapshot = await fetchXaiQuota(credential, { fetchImpl, includeRaw: true });
    assert.equal(snapshot.status, "ok");
    if (snapshot.status !== "ok") return;

    assert.equal(snapshot.provider, "xai");
    assert.equal(snapshot.planLabel, "pi meter");
    assert.equal(snapshot.credits?.remaining, 25);
    assert.equal(snapshot.credits?.limit, 200);
    // postpaid $50 against soft $200
    assert.equal(snapshot.windows[0]?.id, "month");
    assert.equal(snapshot.windows[0]?.usedPercent, 25);
    assert.ok(snapshot.raw);
  });

  it("uses credits tank percent when no soft spending limit", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      if (url.endsWith("/auth/management-keys/validation")) {
        return jsonResponse(200, { scopeId: "team-1" });
      }
      if (url.includes("/prepaid/balance")) {
        return jsonResponse(200, { total: { val: "-1000" } }); // $10 remaining
      }
      if (url.includes("/postpaid/spending-limits")) {
        return jsonResponse(200, { spendingLimits: { softSl: { val: "0" } } });
      }
      if (url.includes("/postpaid/invoice/preview")) {
        return jsonResponse(200, {
          coreInvoice: {
            amountAfterVat: "0",
            prepaidCreditsUsed: { val: "500" }, // $5 used
          },
        });
      }
      return jsonResponse(404, {});
    };

    const snapshot = await fetchXaiQuota(credential, { fetchImpl });
    assert.equal(snapshot.status, "ok");
    if (snapshot.status !== "ok") return;
    assert.equal(snapshot.windows[0]?.id, "credits");
    // used 5 / (5+10) = 33.333...
    assert.ok(snapshot.windows[0]?.usedPercent != null);
    assert.ok(Math.abs(snapshot.windows[0]!.usedPercent! - (500 / 1500) * 100) < 1e-9);
    assert.equal(snapshot.credits?.remaining, 10);
    assert.equal(snapshot.credits?.usage, 5);
  });

  it("returns unauthenticated for 403 on validation", async () => {
    const fetchImpl: typeof fetch = async () =>
      jsonResponse(403, { message: "oauth2-auth-forbidden" });

    const snapshot = await fetchXaiQuota(credential, { fetchImpl });
    assert.equal(snapshot.status, "unauthenticated");
    assert.ok(snapshot.notes?.some((n) => n.includes("Management Key")));
  });

  it("resolves teamId from validation when credential omits it", async () => {
    const seen: string[] = [];
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      seen.push(url);
      if (url.endsWith("/auth/management-keys/validation")) {
        return jsonResponse(200, { scopeId: "resolved-team" });
      }
      if (url.includes("/teams/resolved-team/prepaid/balance")) {
        return jsonResponse(200, { total: { val: "0" } });
      }
      if (url.includes("/teams/resolved-team/")) {
        return jsonResponse(200, {});
      }
      return jsonResponse(404, {});
    };

    const snapshot = await fetchXaiQuota(
      { provider: "xai", accessToken: "k" },
      { fetchImpl },
    );
    assert.equal(snapshot.status, "ok");
    assert.ok(seen.some((u) => u.includes("/teams/resolved-team/prepaid/balance")));
  });
});
