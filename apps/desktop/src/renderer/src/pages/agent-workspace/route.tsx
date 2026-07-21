import { createWorkspaceModel } from "./model";
import { AppShell } from "./ui/app-shell";

export function AgentWorkspaceRoute() {
  const model = createWorkspaceModel();
  return <AppShell model={model} />;
}
