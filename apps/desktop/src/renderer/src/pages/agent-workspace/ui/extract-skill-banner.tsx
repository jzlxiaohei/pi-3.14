import { Check, LoaderCircle, Sparkles } from "lucide-solid";
import { Show, createMemo, createSignal } from "solid-js";
import type { TimelineItem } from "@/features/agent-timeline";
import { Button } from "@/shared/ui/button";
import { Dialog } from "@/shared/ui/dialog";
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
  const [confirmOpen, setConfirmOpen] = createSignal(false);

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
      setConfirmOpen(false);
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
    <>
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
              onClick={() => setConfirmOpen(true)}
            >
              <Check size={14} />
              确认写入
            </Button>
          </Show>
        </div>
        <Show when={previewOpen() && draft()}>
          {(value) => <pre class="extract-banner__preview">{value().skillMd}</pre>}
        </Show>
      </div>

      <Dialog
        class="orbit-dialog__content--compact"
        open={confirmOpen() && Boolean(draft())}
        title="确认写入 Skill"
        onOpenChange={(open) => {
          if (writing()) return;
          setConfirmOpen(open);
        }}
      >
        <div class="confirm-dialog">
          <header class="confirm-dialog__header">
            <h2>写入个人 Skill 库？</h2>
          </header>
          <div class="confirm-dialog__body">
            <p>
              将把草案写入{" "}
              <code>
                ~/.pi/agent/skills/{draft()?.slug ?? "…"}/SKILL.md
              </code>
              。写入后需新开或 rebind session 才会加载。
            </p>
            <Show when={overwrite()}>
              <p class="confirm-dialog__note">已勾选「覆盖同名」：若目标已存在将被覆盖。</p>
            </Show>
            <Show when={!overwrite()}>
              <p class="confirm-dialog__note">未勾选覆盖：若同名已存在将写入失败。</p>
            </Show>
          </div>
          <footer class="confirm-dialog__footer">
            <Button
              variant="secondary"
              disabled={writing()}
              onClick={() => setConfirmOpen(false)}
            >
              取消
            </Button>
            <Button
              variant="primary"
              disabled={writing() || props.busy}
              onClick={() => void confirmWrite()}
            >
              <Show when={writing()} fallback={<Check size={14} />}>
                <LoaderCircle size={14} class="spin" />
              </Show>
              {writing() ? "写入中…" : "确认写入"}
            </Button>
          </footer>
        </div>
      </Dialog>
    </>
  );
}
