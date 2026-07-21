import { For, Show } from "solid-js";

type TerminalLine = {
  id: string;
  command: string;
  output: string;
  isError: boolean;
};

type TerminalPreviewProps = {
  lines: TerminalLine[];
};

export function TerminalPreview(props: TerminalPreviewProps) {
  return (
    <div class="terminal-view">
      <Show
        when={props.lines.length > 0}
        fallback={<p class="inspector-empty">Shell tool output from this session will appear here.</p>}
      >
        <For each={props.lines}>
          {(line) => (
            <details class="terminal-block">
              <summary>
                <span>$</span> {line.command}
              </summary>
              <Show
                when={line.output}
                fallback={<pre class={line.isError ? "terminal-error" : undefined}>(no output)</pre>}
              >
                <pre class={line.isError ? "terminal-error" : undefined}>{line.output}</pre>
              </Show>
            </details>
          )}
        </For>
      </Show>
    </div>
  );
}
