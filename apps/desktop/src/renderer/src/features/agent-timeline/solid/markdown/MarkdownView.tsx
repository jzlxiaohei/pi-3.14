import { marked } from "marked";
import { createMemo } from "solid-js";

type MarkdownViewProps = {
  content: string;
};

marked.setOptions({
  gfm: true,
  breaks: false,
});

export function MarkdownView(props: MarkdownViewProps) {
  const html = createMemo(() => {
    const content = props.content;
    if (!content.trim()) return "";
    return marked.parse(content, { async: false }) as string;
  });

  return <div class="at-markdown" innerHTML={html()} />;
}
