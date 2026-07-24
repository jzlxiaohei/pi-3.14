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
    <div class="terminal-panel">
      {/* Match Files tree-head height so tab switch does not jump the chrome. */}
      <div class="tree-head">
        <span class="tree-head__title">Shell output</span>
        <Show when={props.lines.length > 0}>
          <span class="tree-head__count">{props.lines.length}</span>
        </Show>
      </div>
      <div class="terminal-view">
        <Show
          when={props.lines.length > 0}
          fallback={
            <p class="inspector-empty">Shell tool output from this session will appear here.</p>
          }
        >
          <For each={props.lines}>
            {(line) => (
              <details class="terminal-block">
                <summary>
                  <span>$</span> {line.command}
                </summary>
                <Show
                  when={line.output}
                  fallback={
                    <pre class={line.isError ? "terminal-error" : undefined}>
                      {line.isError ? "Command failed (no stdout/stderr)." : "(no output)"}
                    </pre>
                  }
                >
                  <pre class={line.isError ? "terminal-error" : undefined}>{line.output}</pre>
                </Show>
              </details>
            )}
          </For>
        </Show>
      </div>
    </div>
  );
}
