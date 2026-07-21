import { ChevronDown, ChevronRight, File, Folder, RefreshCw } from "lucide-solid";
import { createSignal, For } from "solid-js";
import type { WorkspaceFileNode } from "../../model";
import { workspaceFiles } from "../../model";
import { createTreeCollection, TreeView } from "@/shared/ui/tree-view";

export function WorkspaceTree() {
  const [expandedValue, setExpandedValue] = createSignal(["src", "middleware", "tests"]);
  const [selectedValue, setSelectedValue] = createSignal<string[]>(["auth.ts"]);
  const collection = createTreeCollection<WorkspaceFileNode>({
    nodeToString: (node) => node.name,
    nodeToValue: (node) => node.name,
    rootNode: {
      name: "",
      type: "folder",
      children: workspaceFiles
    }
  });

  return (
    <div class="tree-panel">
      <div class="tree-head">
        <span>Workspace files</span>
        <RefreshCw size={15} />
      </div>
      <TreeView.Root
        class="workspace-tree"
        collection={collection}
        expandedValue={expandedValue()}
        selectedValue={selectedValue()}
        onExpandedChange={(details) => setExpandedValue(details.expandedValue)}
        onSelectionChange={(details) => setSelectedValue(details.selectedValue)}
      >
        <TreeView.Tree class="workspace-tree__list">
          <For each={collection.rootNode.children}>
            {(node, index) => <WorkspaceTreeNode node={node} indexPath={[index()]} />}
          </For>
        </TreeView.Tree>
      </TreeView.Root>
    </div>
  );
}

function WorkspaceTreeNode(props: { indexPath: number[]; node: WorkspaceFileNode }) {
  return (
    <TreeView.NodeProvider node={props.node} indexPath={props.indexPath}>
      <TreeView.NodeContext>
        {(nodeState) => props.node.children ? (
          <TreeView.Branch class="workspace-tree__branch">
            <TreeView.BranchControl class="tree-row">
              <TreeView.BranchIndicator class="workspace-tree__indicator">
                {nodeState().expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
              </TreeView.BranchIndicator>
              <TreeView.BranchText class="workspace-tree__label">
                <Folder size={15} />
                <span>{props.node.name}</span>
              </TreeView.BranchText>
              {props.node.changed ? <b>M</b> : null}
            </TreeView.BranchControl>
            <TreeView.BranchContent class="workspace-tree__branch-content">
              <TreeView.BranchIndentGuide class="workspace-tree__indent-guide" />
              <For each={props.node.children}>
                {(node, index) => <WorkspaceTreeNode node={node} indexPath={[...props.indexPath, index()]} />}
              </For>
            </TreeView.BranchContent>
          </TreeView.Branch>
        ) : (
          <TreeView.Item class="tree-row workspace-tree__item">
            <TreeView.ItemText class="workspace-tree__label">
              <File size={15} />
              <span>{props.node.name}</span>
            </TreeView.ItemText>
            {props.node.changed ? <b>M</b> : null}
          </TreeView.Item>
        )}
      </TreeView.NodeContext>
    </TreeView.NodeProvider>
  );
}
