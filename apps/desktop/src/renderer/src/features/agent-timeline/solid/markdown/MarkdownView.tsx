import DOMPurify from "dompurify";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import { createMemo, createResource } from "solid-js";
import { writeClipboardText } from "@/shared/clipboard";
import { highlightCodeInner } from "./highlight";

type MarkdownViewProps = {
  content: string;
  streaming?: boolean;
};

const plainMarkdown = new Marked({ gfm: true, breaks: false });
const highlightedMarkdown = new Marked(
  { gfm: true, breaks: false },
  markedHighlight({
    async: true,
    highlight: (code, language) => highlightCodeInner(code, language || "text"),
  }),
);

export function MarkdownView(props: MarkdownViewProps) {
  const plainHtml = createMemo(() => renderPlainMarkdown(props.content));
  const [highlightedHtml] = createResource(
    () => (!props.streaming && props.content.trim() ? props.content : null),
    renderHighlightedMarkdown,
  );
  const html = () => highlightedHtml() ?? plainHtml();

  async function copyCode(event: MouseEvent): Promise<void> {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const button = target.closest<HTMLButtonElement>(".at-code-copy");
    if (!button) return;
    const code = button.closest(".at-code-frame")?.querySelector("code")?.textContent;
    if (!code) return;

    const ok = await writeClipboardText(code);
    if (!ok) return;
    button.textContent = "Copied";
    window.setTimeout(() => {
      if (button.isConnected) button.textContent = "Copy";
    }, 1200);
  }

  return <div class="at-markdown" innerHTML={html()} onClick={(event) => void copyCode(event)} />;
}

function renderPlainMarkdown(content: string): string {
  if (!content.trim()) return "";
  return finishHtml(plainMarkdown.parse(content, { async: false }) as string);
}

async function renderHighlightedMarkdown(content: string): Promise<string> {
  const html = await highlightedMarkdown.parse(content, { async: true });
  return finishHtml(html);
}

function finishHtml(html: string): string {
  const document = new DOMParser().parseFromString(html, "text/html");

  for (const pre of document.querySelectorAll("pre")) {
    const code = pre.querySelector(":scope > code");
    if (!code) continue;
    const language = [...code.classList]
      .find((name) => name.startsWith("language-"))
      ?.slice("language-".length) || "text";
    const frame = document.createElement("div");
    frame.className = "at-code-frame";
    const header = document.createElement("div");
    header.className = "at-code-frame__header";
    const label = document.createElement("span");
    label.textContent = language;
    const copy = document.createElement("button");
    copy.type = "button";
    copy.className = "at-code-copy";
    copy.setAttribute("aria-label", "Copy code");
    copy.textContent = "Copy";
    header.append(label, copy);
    pre.replaceWith(frame);
    frame.append(header, pre);
  }

  for (const table of document.querySelectorAll("table")) {
    const wrapper = document.createElement("div");
    wrapper.className = "at-table-wrap";
    table.replaceWith(wrapper);
    wrapper.append(table);
  }

  for (const link of document.querySelectorAll("a[href]")) {
    link.setAttribute("target", "_blank");
    link.setAttribute("rel", "noreferrer noopener");
  }

  return DOMPurify.sanitize(document.body.innerHTML, { USE_PROFILES: { html: true } });
}
