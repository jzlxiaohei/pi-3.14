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
            <div class="terminal-block">
              <p><span>$</span> {line.command}</p>
              <Show when={line.output}>
                <pre class={line.isError ? "terminal-error" : undefined}>{line.output}</pre>
              </Show>
            </div>
          )}
        </For>
      </Show>
    </div>
  );
}
