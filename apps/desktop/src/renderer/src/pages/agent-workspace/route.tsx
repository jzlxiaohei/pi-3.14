import { createWorkspaceModel } from "./model";
import { createAgentWorkspaceSession } from "./session";
import { AppShell } from "./ui/app-shell";

export function AgentWorkspaceRoute() {
  const model = createWorkspaceModel();
  const session = createAgentWorkspaceSession(model);
  return <AppShell model={model} session={session} />;
}
