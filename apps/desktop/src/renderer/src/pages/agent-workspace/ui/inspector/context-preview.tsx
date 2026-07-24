import {
  estimateContextComposition,
  selectQuotasForModel,
  type ContextCompositionEstimate,
  type ProviderQuotaSnapshot,
} from "@pi-3.14/usage";
import { Braces, Copy, RefreshCw } from "lucide-solid";
import { For, Show, createEffect, createMemo, createSignal, untrack } from "solid-js";
import type { PiLiveSkillInfo } from "@pi-3.14/model";
import type { PiSessionInspectResult } from "../../../../../../shared/desktop-contracts";
import { writeClipboardText } from "@/shared/clipboard";
import { Collapsible } from "@/shared/ui/collapsible";
import { IconButton } from "@/shared/ui/icon-button";
import { notifySuccess } from "@/shared/ui/toast";

type ContextPreviewProps = {
  refreshToken?: number;
  ready: boolean;
  /** Skill names ignored for the active task (not in live prompt). */
  ignoredSkillNames?: string[];
};

type ContextPane = "request" | "response";

type DisclosureKey =
  | "advanced"
  | "prompt"
  | "skills"
  | "tools"
  | "messages"
  | "assembled"
  | "wire";

export function ContextPreview(props: ContextPreviewProps) {
  const [data, setData] = createSignal<PiSessionInspectResult | null>(null);
  const [quotas, setQuotas] = createSignal<ProviderQuotaSnapshot[]>([]);
  const [error, setError] = createSignal<string | null>(null);
  const [loading, setLoading] = createSignal(false);
  const [pane, setPane] = createSignal<ContextPane>("request");
  /** Remember skill rows so ignored names can still show useful metadata. */
  const [knownSkills, setKnownSkills] = createSignal<Record<string, PiLiveSkillInfo>>({});
  const [open, setOpen] = createSignal<Record<DisclosureKey, boolean>>({
    advanced: false,
    prompt: false,
    skills: false,
    tools: false,
    messages: false,
    assembled: false,
    wire: false,
  });

  createEffect(() => {
    props.refreshToken;
    props.ready;
    if (!props.ready) {
      setData(null);
      setQuotas([]);
      setError(null);
      setKnownSkills({});
      return;
    }
    // Quiet skill toggles bump refreshToken while data stays mounted — reload without blanking.
    const silent = untrack(() => data() !== null);
    void load({ silent });
  });

  async function load(options?: { silent?: boolean }): Promise<void> {
    if (!options?.silent) setLoading(true);
    setError(null);
    try {
      const [inspect, providerQuotas] = await Promise.all([
        window.piDesktop.session.inspect(),
        window.piDesktop.usage.providerQuotas().catch(() => [] as ProviderQuotaSnapshot[]),
      ]);
      setData(inspect);
      const modelProvider = inspect.analysis?.model?.provider ?? null;
      setQuotas(selectQuotasForModel(providerQuotas, modelProvider));
      const nextKnown = { ...knownSkills() };
      for (const skill of inspect.live?.skills ?? []) {
        nextKnown[skill.name] = skill;
      }
      setKnownSkills(nextKnown);
    } catch (err) {
      if (!options?.silent) setData(null);
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      if (!options?.silent) setLoading(false);
    }
  }

  function toggle(key: DisclosureKey): void {
    setOpen((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  async function copyJson(label: string, value: unknown): Promise<void> {
    const ok = await writeClipboardText(JSON.stringify(value, null, 2));
    if (ok) notifySuccess(`已复制 ${label}`);
  }

  const analysis = () => data()?.analysis ?? null;
  const live = () => data()?.live ?? null;
  const context = () => data()?.context ?? null;
  const ignoredNames = createMemo(() => props.ignoredSkillNames ?? []);
  const ignoredSet = createMemo(() => new Set(ignoredNames()));

  const activeSkills = createMemo(() => {
    const ignored = ignoredSet();
    const byName = new Map<string, PiLiveSkillInfo>();
    for (const skill of Object.values(knownSkills())) {
      if (!ignored.has(skill.name)) byName.set(skill.name, skill);
    }
    for (const skill of live()?.skills ?? []) {
      if (!ignored.has(skill.name)) byName.set(skill.name, skill);
    }
    return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  });

  const ignoredSkillRows = createMemo(() =>
    ignoredNames().map(
      (name) =>
        knownSkills()[name] ?? {
          name,
          description: "Not in system prompt",
          filePath: "",
        },
    ),
  );
  const usage = () => analysis()?.usage ?? live()?.sessionStats.tokens ?? null;
  const messageRows = () => {
    const assembled = live()?.assembled?.messages;
    if (Array.isArray(assembled) && assembled.length > 0) {
      return assembled.map((message, index) => summarizeAssembledMessage(message, index));
    }
    return (context()?.messages ?? []).map((message, index) => ({
      key: `${message.sourceEntryId}-${index}`,
      role: message.role,
      text: message.text,
      highlight: message.role === "branchSummary" || message.role === "compaction",
    }));
  };

  const requestMessageRows = createMemo(() => messageRows());
  const responseMessageRows = createMemo(() =>
    messageRows().filter((row) => isModelResponseRole(row.role)),
  );
  const composition = createMemo((): ContextCompositionEstimate | null => {
    const inspect = data();
    if (!inspect) return null;
    const assembled = inspect.live?.assembled?.messages;
    const messages = Array.isArray(assembled)
      ? assembled.map((message) => {
          if (!message || typeof message !== "object") {
            return { role: "other", text: String(message) };
          }
          const record = message as Record<string, unknown>;
          return {
            role: typeof record.role === "string" ? record.role : "other",
            text: contentToText(record.content),
            thinking: typeof record.thinking === "string" ? record.thinking : undefined,
          };
        })
      : (inspect.context?.messages ?? []).map((message) => ({
          role: message.role,
          text: message.text,
        }));
    return estimateContextComposition({
      systemPrompt: inspect.live?.systemPrompt ?? "",
      messages,
    });
  });

  return (
    <div class="context-preview">
      <div class="context-preview__toolbar">
        <span class="context-preview__hint">
          {pane() === "request"
            ? "Request — sent to the model"
            : "Response — returned by the model"}
        </span>
        <IconButton label="Refresh context" size="sm" disabled={loading()} onClick={() => void load()}>
          <RefreshCw size={14} />
        </IconButton>
      </div>

      <Show when={error()}>
        <p class="inspector-empty">{error()}</p>
      </Show>
      <Show when={!props.ready}>
        <p class="inspector-empty">Open a session to inspect context.</p>
      </Show>
      <Show when={props.ready && loading() && !data()}>
        <p class="inspector-empty">Loading…</p>
      </Show>

      <Show when={data()}>
        {(inspect) => (
          <>
            <section class="context-preview__cards">
              <div class="context-stat">
                <span class="context-stat__label">Context</span>
                <strong>
                  {live()?.contextUsage?.percent != null
                    ? `${Math.round(live()!.contextUsage!.percent!)}%`
                    : "—"}
                </strong>
                <span class="context-stat__sub">
                  {live()?.contextUsage?.tokens != null
                    ? `${live()!.contextUsage!.tokens} / ${live()!.contextUsage!.contextWindow}`
                    : "window unknown"}
                </span>
              </div>
              <div class="context-stat">
                <span class="context-stat__label">Tokens</span>
                <strong>{formatNumber(usageTotal(usage()))}</strong>
                <span class="context-stat__sub">
                  in {formatNumber(asUsage(usage()).input)} · out {formatNumber(asUsage(usage()).output)}
                </span>
              </div>
              <div class="context-stat">
                <span class="context-stat__label">Cache</span>
                <strong>{formatNumber(asUsage(usage()).cacheRead + asUsage(usage()).cacheWrite)}</strong>
                <span class="context-stat__sub">
                  read/write {formatNumber(asUsage(usage()).cacheRead)}/
                  {formatNumber(asUsage(usage()).cacheWrite)}
                </span>
              </div>
              <div class="context-stat">
                <span class="context-stat__label">Turns</span>
                <strong>{analysis()?.turnCount ?? "—"}</strong>
                <span class="context-stat__sub">
                  tools {analysis()?.toolCallCount ?? "—"}
                  {analysis() ? ` · err ${analysis()!.toolErrorCount}` : ""}
                </span>
              </div>
            </section>

            <Show when={quotas().length > 0}>
              <section class="context-preview__block">
                <h3>Subscription</h3>
                <ul class="context-quota-list">
                  <For each={quotas()}>
                    {(quota) => (
                      <li class="context-quota">
                        <div class="context-quota__head">
                          <strong>{providerLabel(quota.provider)}</strong>
                          <span>
                            {quota.status === "ok"
                              ? quota.planLabel ?? "ok"
                              : quota.status}
                          </span>
                        </div>
                        <Show
                          when={quota.status === "ok" ? quota : null}
                          fallback={
                            <p class="context-preview__muted">
                              {quota.status === "ok" ? "Unavailable" : quota.error || "Unavailable"}
                            </p>
                          }
                        >
                          {(ok) => (
                            <>
                              <For each={ok().windows}>
                                {(windowRow) => (
                                  <div class="context-meter">
                                    <div class="context-meter__meta">
                                      <span>{windowRow.label}</span>
                                      <span>
                                        {windowRow.usedPercent != null
                                          ? `${Math.round(windowRow.usedPercent)}%`
                                          : "—"}
                                        {windowRow.resetAtMs
                                          ? ` · reset ${formatReset(windowRow.resetAtMs)}`
                                          : ""}
                                      </span>
                                    </div>
                                    <div class="context-meter__track">
                                      <div
                                        class="context-meter__fill"
                                        style={{
                                          width: `${clampPercent(windowRow.usedPercent)}%`,
                                        }}
                                      />
                                    </div>
                                  </div>
                                )}
                              </For>
                              <Show when={ok().credits}>
                                {(credits) => (
                                  <p class="context-preview__muted">
                                    credits
                                    {credits().remaining != null
                                      ? ` remaining ${formatNumber(credits().remaining!)}`
                                      : ""}
                                    {credits().usage != null
                                      ? ` · used ${formatNumber(credits().usage!)}`
                                      : ""}
                                    {credits().unlimited ? " · unlimited" : ""}
                                  </p>
                                )}
                              </Show>
                            </>
                          )}
                        </Show>
                      </li>
                    )}
                  </For>
                </ul>
                <p class="context-preview__muted">
                  Undocumented provider meters where noted — not billing-grade. Cached ~60s.
                </p>
              </section>
            </Show>

            <section class="context-preview__block">
              <h3>Session shape</h3>
              <dl class="context-preview__dl">
                <div>
                  <dt>Model</dt>
                  <dd>
                    {analysis()?.model
                      ? `${analysis()!.model!.provider}/${analysis()!.model!.id}`
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt>Thinking</dt>
                  <dd>{analysis()?.thinkingLevel ?? "—"}</dd>
                </div>
                <div>
                  <dt>Branches</dt>
                  <dd>
                    {analysis()?.branchPointCount ?? 0} forks · depth {analysis()?.maxDepth ?? "—"}
                  </dd>
                </div>
                <div>
                  <dt>Path / all</dt>
                  <dd>
                    {analysis()?.activePathEntryCount ?? "—"} / {analysis()?.entryCount ?? "—"} entries
                  </dd>
                </div>
                <div>
                  <dt>Compactions</dt>
                  <dd>
                    {analysis()?.compactionCount ?? 0}
                    {context()?.latestCompaction?.tokensBefore != null
                      ? ` · last @ ${context()!.latestCompaction!.tokensBefore} tok`
                      : ""}
                  </dd>
                </div>
                <div>
                  <dt>Effective msgs</dt>
                  <dd>
                    {context()?.messages.length ?? 0}
                    {context()?.excludedPathEntryIds.length
                      ? ` · excluded ${context()!.excludedPathEntryIds.length}`
                      : ""}
                  </dd>
                </div>
              </dl>
            </section>

            <div class="context-preview__panes" role="tablist" aria-label="Context direction">
              <button
                type="button"
                role="tab"
                class="context-preview__pane"
                aria-selected={pane() === "request"}
                data-selected={pane() === "request" ? "true" : undefined}
                onClick={() => setPane("request")}
              >
                Request
                <span class="context-preview__pane-count">{requestMessageRows().length}</span>
              </button>
              <button
                type="button"
                role="tab"
                class="context-preview__pane"
                aria-selected={pane() === "response"}
                data-selected={pane() === "response" ? "true" : undefined}
                onClick={() => setPane("response")}
              >
                Response
                <span class="context-preview__pane-count">{responseMessageRows().length}</span>
              </button>
            </div>

            <Show when={pane() === "request"}>
              <Show when={composition()}>
                {(comp) => (
                  <section class="context-preview__block">
                    <h3>Context composition (est.)</h3>
                    <p class="context-preview__muted">
                      ~{formatNumber(comp().totalEstimatedTokens)} tok via chars/4 — not provider
                      billed.
                    </p>
                    <ul class="context-compose-list">
                      <For each={comp().buckets}>
                        {(bucket) => (
                          <li class="context-meter">
                            <div class="context-meter__meta">
                              <span>{bucket.label}</span>
                              <span>
                                {Math.round(bucket.percent)}% ·{" "}
                                {formatNumber(bucket.estimatedTokens)}
                              </span>
                            </div>
                            <div class="context-meter__track">
                              <div
                                class="context-meter__fill context-meter__fill--compose"
                                data-bucket={bucket.id}
                                style={{ width: `${clampPercent(bucket.percent)}%` }}
                              />
                            </div>
                          </li>
                        )}
                      </For>
                    </ul>
                  </section>
                )}
              </Show>

              <section class="context-preview__block">
                <Collapsible
                  open={open().prompt}
                  title="System prompt"
                  onOpenChange={() => toggle("prompt")}
                >
                  <pre class="context-preview__pre">
                    {live()?.systemPrompt || "(unavailable)"}
                  </pre>
                  <p class="context-preview__muted">
                    Live host only — JSONL cannot restore historical system prompts
                    {context()?.recoverability.unavailableFromJsonl.length
                      ? ` (${context()!.recoverability.unavailableFromJsonl.join(", ")})`
                      : ""}
                    .
                  </p>
                </Collapsible>
              </section>

              <section class="context-preview__block">
                <Collapsible
                  open={open().skills}
                  title={
                    <>
                      Skills ({activeSkills().length} active
                      {ignoredNames().length > 0
                        ? ` · ${ignoredNames().length} ignored`
                        : ""}
                      )
                    </>
                  }
                  onOpenChange={() => toggle("skills")}
                >
                  <p class="context-preview__muted">
                    Read-only view. Configure per-task skill filtering from the chat composer.
                  </p>
                  <Show
                    when={activeSkills().length > 0}
                    fallback={
                      <Show when={ignoredNames().length === 0}>
                        <p class="context-preview__muted">No skills loaded</p>
                      </Show>
                    }
                  >
                    <ul class="context-preview__list">
                      <For each={activeSkills()}>
                        {(skill) => (
                          <li>
                            <div class="context-preview__skill-head">
                              <strong>{skill.name}</strong>
                            </div>
                            <span>{skill.description || "(no description)"}</span>
                            <Show when={skill.filePath}>
                              <code>{skill.filePath}</code>
                            </Show>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                  <Show when={ignoredSkillRows().length > 0}>
                    <h4 class="context-preview__subhead">Ignored for this task</h4>
                    <ul class="context-preview__list">
                      <For each={ignoredSkillRows()}>
                        {(skill) => (
                          <li>
                            <div class="context-preview__skill-head">
                              <strong>{skill.name}</strong>
                            </div>
                            <span class="context-preview__muted">
                              {skill.description || "Not in system prompt"}
                            </span>
                            <Show when={skill.filePath}>
                              <code>{skill.filePath}</code>
                            </Show>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                </Collapsible>
              </section>

              <section class="context-preview__block">
                <Collapsible
                  open={open().tools}
                  title={`Tools (${live()?.tools.length ?? 0})`}
                  onOpenChange={() => toggle("tools")}
                >
                  <Show
                    when={(live()?.tools.length ?? 0) > 0}
                    fallback={<p class="context-preview__muted">No tools loaded</p>}
                  >
                    <ul class="context-preview__list">
                      <For each={live()?.tools ?? []}>
                        {(tool) => (
                          <li>
                            <strong>{tool.name}</strong>
                            <span>{tool.description || "(no description)"}</span>
                          </li>
                        )}
                      </For>
                    </ul>
                  </Show>
                  <p class="context-preview__muted">
                    Active now: {(live()?.activeToolNames ?? []).join(", ") || "—"}
                  </p>
                </Collapsible>
              </section>

              <section class="context-preview__block">
                <Collapsible
                  open={open().messages}
                  title={`Sent messages (${requestMessageRows().length})`}
                  onOpenChange={() => toggle("messages")}
                >
                  <ul class="context-preview__msg-list">
                    <For each={requestMessageRows()}>
                      {(row) => (
                        <li
                          classList={{
                            "context-preview__msg--highlight": row.highlight,
                          }}
                        >
                          <span class="context-preview__msg-role">{row.role}</span>
                          <span class="context-preview__msg-text">{truncate(row.text, 180)}</span>
                        </li>
                      )}
                    </For>
                  </ul>
                  <p class="context-preview__muted">
                    Full message history included in the model request. Prior assistant replies and
                    tool results appear here when they are part of the next input.
                  </p>
                </Collapsible>
              </section>

              <section class="context-preview__block">
                <Collapsible
                  open={open().advanced}
                  title={
                    <>
                      <Braces size={14} /> Advanced request views
                    </>
                  }
                  onOpenChange={() => toggle("advanced")}
                >
                  <p class="context-preview__muted">
                    Use these to debug context assembly. Wire is the real provider payload;
                    assembled is host-local and may differ from provider serialization.
                  </p>

                  <div class="context-preview__advanced">
                    <section class="context-preview__block">
                      <Collapsible
                        open={open().assembled}
                        title="Live assembled (approx)"
                        trailing={
                          <IconButton
                            label="Copy assembled JSON"
                            size="sm"
                            disabled={!live()?.assembled}
                            onClick={() => void copyJson("assembled", live()?.assembled)}
                          >
                            <Copy size={14} />
                          </IconButton>
                        }
                        onOpenChange={() => toggle("assembled")}
                      >
                        <pre class="context-preview__pre">
                          {JSON.stringify(live()?.assembled ?? null, null, 2)}
                        </pre>
                        <p class="context-preview__muted">
                          Host-local approximation before provider serialization and extension
                          rewrites.
                        </p>
                      </Collapsible>
                    </section>

                    <section class="context-preview__block">
                      <Collapsible
                        open={open().wire}
                        title="Last wire request"
                        trailing={
                          <IconButton
                            label="Copy last wire JSON"
                            size="sm"
                            disabled={!live()?.lastProviderRequest}
                            onClick={() => void copyJson("wire", live()?.lastProviderRequest)}
                          >
                            <Copy size={14} />
                          </IconButton>
                        }
                        onOpenChange={() => toggle("wire")}
                      >
                        <Show
                          when={live()?.lastProviderRequest}
                          fallback={
                            <p class="context-preview__muted">
                              尚未捕获到 provider 请求。发一轮消息后会出现最近一次真实 payload。
                            </p>
                          }
                        >
                          {(wire) => (
                            <>
                              <p class="context-preview__muted">
                                at {new Date(wire().at).toLocaleString()}
                              </p>
                              <pre class="context-preview__pre">
                                {JSON.stringify(wire().payload, null, 2)}
                              </pre>
                            </>
                          )}
                        </Show>
                        <p class="context-preview__muted">
                          Only the most recent request from this host life. Switching session clears
                          it.
                        </p>
                      </Collapsible>
                    </section>

                  </div>
                </Collapsible>
              </section>
            </Show>

            <Show when={pane() === "response"}>
              <section class="context-preview__cards context-preview__cards--response">
                <div class="context-stat">
                  <span class="context-stat__label">Output</span>
                  <strong>{formatNumber(asUsage(usage()).output)}</strong>
                  <span class="context-stat__sub">
                    completion tokens · assistants {live()?.sessionStats.assistantMessages ?? "—"} ·
                    tool calls{" "}
                    {analysis()?.toolCallCount ?? live()?.sessionStats.toolCalls ?? "—"}
                  </span>
                </div>
              </section>

              <section class="context-preview__block">
                <h3>Model replies</h3>
                <Show
                  when={responseMessageRows().length > 0}
                  fallback={
                    <p class="context-preview__muted">
                      还没有 assistant 输出。发一轮消息后会出现在这里。
                    </p>
                  }
                >
                  <ul class="context-preview__msg-list">
                    <For each={responseMessageRows()}>
                      {(row) => (
                        <li
                          classList={{
                            "context-preview__msg--highlight": row.highlight,
                            "context-preview__msg--assistant": row.role === "assistant",
                          }}
                        >
                          <span class="context-preview__msg-role">{row.role}</span>
                          <span class="context-preview__msg-text">{truncate(row.text, 420)}</span>
                        </li>
                      )}
                    </For>
                  </ul>
                </Show>
                <p class="context-preview__muted">
                  这里展示模型返回的 assistant replies，不包含本地执行后的 tool results。tool
                  results 会在后续作为 Request 输入出现。
                </p>
              </section>

              <Show when={(analysis()?.diagnostics.length ?? 0) > 0}>
                <section class="context-preview__block">
                  <h3>Diagnostics</h3>
                  <ul class="context-preview__diags">
                    <For each={analysis()!.diagnostics}>
                      {(item) => (
                        <li data-severity={item.severity}>
                          <code>{item.code}</code> {item.message}
                        </li>
                      )}
                    </For>
                  </ul>
                </section>
              </Show>
            </Show>

            <p class="context-preview__muted context-preview__foot">
              leaf {inspect().leafEntryId ?? "—"}
              {inspect().sessionPath ? ` · ${inspect().sessionPath}` : ""}
            </p>
          </>
        )}
      </Show>
    </div>
  );
}

function isModelResponseRole(role: string): boolean {
  const normalized = role.toLowerCase();
  return normalized === "assistant";
}

function summarizeAssembledMessage(
  message: unknown,
  index: number,
): { key: string; role: string; text: string; highlight: boolean } {
  if (!message || typeof message !== "object") {
    return { key: `msg-${index}`, role: "unknown", text: String(message), highlight: false };
  }
  const record = message as Record<string, unknown>;
  const role = typeof record.role === "string" ? record.role : "unknown";
  const text = contentToText(record.content);
  const highlight =
    text.includes("<summary>") ||
    text.includes("branch that this conversation came back from") ||
    text.includes("conversation history before this point was compacted");
  return { key: `msg-${index}`, role, text, highlight };
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (!part || typeof part !== "object") return "";
      const record = part as Record<string, unknown>;
      return typeof record.text === "string" ? record.text : "";
    })
    .filter(Boolean)
    .join("\n");
}

function truncate(text: string, max: number): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 1)}…`;
}

function usageTotal(usage: unknown): number {
  const u = asUsage(usage);
  return u.total || u.input + u.output + u.cacheRead + u.cacheWrite;
}

function asUsage(usage: unknown): {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  total: number;
} {
  if (!usage || typeof usage !== "object") {
    return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
  }
  const record = usage as Record<string, unknown>;
  return {
    input: numberOr(record.input),
    output: numberOr(record.output),
    cacheRead: numberOr(record.cacheRead),
    cacheWrite: numberOr(record.cacheWrite),
    total: numberOr(record.total ?? record.totalTokens),
  };
}

function numberOr(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(
    value,
  );
}

function clampPercent(value: number | null | undefined): number {
  if (value == null || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function formatReset(resetAtMs: number): string {
  const delta = resetAtMs - Date.now();
  if (delta <= 0) return "now";
  const minutes = Math.round(delta / 60_000);
  if (minutes < 90) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return new Date(resetAtMs).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function providerLabel(provider: ProviderQuotaSnapshot["provider"]): string {
  switch (provider) {
    case "openai-codex":
      return "Codex";
    case "anthropic":
      return "Anthropic";
    case "openrouter":
      return "OpenRouter";
    case "xai":
      return "xAI";
    default:
      return provider;
  }
}
