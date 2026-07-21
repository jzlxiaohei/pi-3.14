import { codeToHtml } from "shiki";
import { Show, createResource } from "solid-js";

type CodeBlockProps = {
  code: string;
  language?: string;
};

export function CodeBlock(props: CodeBlockProps) {
  const [html] = createResource(
    () => ({ code: props.code, language: props.language ?? "text" }),
    async ({ code, language }) =>
      codeToHtml(code, {
        lang: language,
        theme: "github-light",
      }),
  );

  return (
    <Show when={html()} fallback={<pre class="at-code-block"><code>{props.code}</code></pre>}>
      {(value) => <div class="at-code-highlight" innerHTML={value()} />}
    </Show>
  );
}
