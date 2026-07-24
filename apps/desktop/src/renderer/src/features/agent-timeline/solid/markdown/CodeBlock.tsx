import { Show, createResource } from "solid-js";
import { highlightCodeHtml } from "./highlight";

type CodeBlockProps = {
  code: string;
  language?: string;
};

export function CodeBlock(props: CodeBlockProps) {
  const [html] = createResource(
    () => ({ code: props.code, language: props.language ?? "text" }),
    ({ code, language }) => highlightCodeHtml(code, language),
  );

  return (
    <Show when={html()} fallback={<pre class="at-code-block"><code>{props.code}</code></pre>}>
      {(value) => <div class="at-code-highlight" innerHTML={value()} />}
    </Show>
  );
}
