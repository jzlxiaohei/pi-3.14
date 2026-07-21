import { Route, Router } from "@solidjs/router";
import { Providers } from "./app/providers";
import { AgentWorkspaceRoute } from "./pages/agent-workspace/route";

export function App() {
  return (
    <Providers>
      <Router>
        <Route path="/" component={AgentWorkspaceRoute} />
      </Router>
    </Providers>
  );
}
