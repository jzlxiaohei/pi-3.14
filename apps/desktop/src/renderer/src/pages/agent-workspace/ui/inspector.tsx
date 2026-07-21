import { Copy, GitBranch, GitCompareArrows, Terminal } from "lucide-solid";
import type { InspectorTab } from "../model";
import { Tabs } from "@/shared/ui/tabs";
import { DiffPreview } from "./inspector/diff-preview";
import { TerminalPreview } from "./inspector/terminal-preview";
import { WorkspaceTree } from "./inspector/workspace-tree";

type InspectorProps = {
  onTabChange: (tab: InspectorTab) => void;
  tab: InspectorTab;
};

export function Inspector(props: InspectorProps) {
  return (
    <aside class="inspector">
      <Tabs
        value={props.tab}
        onValueChange={(value) => props.onTabChange(value as InspectorTab)}
        items={[
          {
            value: "changes",
            label: "Changes",
            badge: "2",
            icon: <GitCompareArrows size={16} />
          },
          {
            value: "terminal",
            label: "Terminal",
            icon: <Terminal size={16} />
          }
        ]}
      />
      <div class="branch-bar">
        <span><GitBranch size={15} /> refactor/auth-middleware</span>
        <button><Copy size={14} /> Copy</button>
      </div>
      {props.tab === "changes" ? <DiffPreview /> : <TerminalPreview />}
      <WorkspaceTree />
    </aside>
  );
}
