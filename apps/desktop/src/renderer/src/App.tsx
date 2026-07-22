import { Route, Router } from "@solidjs/router";
import { Providers } from "./app/providers";
import { AgentWorkspaceRoute } from "./pages/agent-workspace/route";
import { DiffReviewRoute } from "./pages/diff-review/route";

export function App() {
  if (window.location.hash.startsWith("#/review")) {
    return (
      <Providers>
        <DiffReviewRoute />
      </Providers>
    );
  }

  return (
    <Providers>
      <Router>
        <Route path="/" component={AgentWorkspaceRoute} />
      </Router>
    </Providers>
  );
}
