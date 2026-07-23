import { Check, LoaderCircle, Sparkles } from "lucide-solid";
import { Show, createMemo, createSignal } from "solid-js";
import type { TimelineItem } from "@/features/agent-timeline";
import { Button } from "@/shared/ui/button";
import { notifyError, notifySuccess } from "@/shared/ui/toast";
import { latestAssistantSkillDraft } from "../extract-skill";

type ExtractSkillBannerProps = {
  items: TimelineItem[];
  busy?: boolean;
};

export function ExtractSkillBanner(props: ExtractSkillBannerProps) {
  const draft = createMemo(() => latestAssistantSkillDraft(props.items));
  const [overwrite, setOverwrite] = createSignal(false);
  const [writing, setWriting] = createSignal(false);
  const [previewOpen, setPreviewOpen] = createSignal(false);

  async function confirmWrite(): Promise<void> {
    const next = draft();
    if (!next || writing()) return;
    setWriting(true);
    try {
      const result = await window.piDesktop.skills.writePersonal({
        slug: next.slug,
        skillMd: next.skillMd,
        overwrite: overwrite(),
      });
      if (!result.ok) {
        notifyError("写入失败", result.error);
        return;
      }
      notifySuccess(
        `已写入 /${result.slug}`,
        `${result.skillPath} · 新开或 rebind session 后可用`,
      );
    } catch (error) {
      notifyError("写入失败", error instanceof Error ? error.message : String(error));
    } finally {
      setWriting(false);
    }
  }

  return (
    <div class="extract-banner">
      <div class="extract-banner__copy">
        <Sparkles size={14} />
        <div>
          <strong>抽取 session</strong>
          <Show
            when={draft()}
            fallback={
              <span>
                {props.busy
                  ? "正在根据 transcript 起草 SKILL.md…"
                  : "完成后若回复含 SKILL.md，可确认写入个人 PI skills 库。"}
              </span>
            }
          >
            {(value) => (
              <span>
                已识别草案 <code>/{value().slug}</code> · 确认后写入{" "}
                <code>~/.pi/agent/skills</code>
              </span>
            )}
          </Show>
        </div>
      </div>
      <div class="extract-banner__actions">
        <Show when={draft()}>
          <label class="extract-banner__overwrite">
            <input
              type="checkbox"
              checked={overwrite()}
              onChange={(event) => setOverwrite(event.currentTarget.checked)}
            />
            覆盖同名
          </label>
          <Button variant="secondary" onClick={() => setPreviewOpen((open) => !open)}>
            {previewOpen() ? "收起预览" : "预览"}
          </Button>
          <Button
            variant="primary"
            disabled={writing() || props.busy}
            onClick={() => void confirmWrite()}
          >
            <Show when={writing()} fallback={<Check size={14} />}>
              <LoaderCircle size={14} class="spin" />
            </Show>
            确认写入
          </Button>
        </Show>
      </div>
      <Show when={previewOpen() && draft()}>
        {(value) => <pre class="extract-banner__preview">{value().skillMd}</pre>}
      </Show>
    </div>
  );
}
