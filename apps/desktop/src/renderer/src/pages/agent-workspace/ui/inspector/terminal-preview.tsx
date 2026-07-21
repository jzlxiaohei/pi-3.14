export function TerminalPreview() {
  return (
    <div class="terminal-view">
      <p><span>$</span> pnpm test -- auth session</p>
      <p>✓ auth middleware <i>12 tests</i></p>
      <p>✓ session handling <i>12 tests</i></p>
      <p class="terminal-success">Tests 24 passed <small>1.42s</small></p>
      <p><span>$</span> <b class="cursor" /></p>
    </div>
  );
}
