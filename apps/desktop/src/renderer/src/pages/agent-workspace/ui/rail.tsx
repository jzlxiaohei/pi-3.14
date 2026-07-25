import { LayoutTemplate, ListTodo, Command, Route } from "lucide-solid";
import { Tooltip } from "@/shared/ui/tooltip";

export type MainView = "workspace" | "templates" | "playbooks";

type RailProps = {
  mainView: MainView;
  tasksOpen: boolean;
  onSelectTasks: () => void;
  onSelectTemplates: () => void;
  onSelectPlaybooks: () => void;
};

/**
 * Product-level nav: Tasks, Agent Templates, Playbook (path) Templates.
 */
export function Rail(props: RailProps) {
  const tasksActive = () => props.mainView === "workspace";
  const templatesActive = () => props.mainView === "templates";
  const playbooksActive = () => props.mainView === "playbooks";
  const tasksLabel = () =>
    props.mainView === "workspace"
      ? props.tasksOpen
        ? "收起任务列表"
        : "展开任务列表"
      : "返回任务工作区";

  return (
    <aside class="rail" aria-label="Primary navigation">
      <div class="brand-mark">
        <Command size={21} strokeWidth={2.4} />
      </div>
      <nav class="rail-nav">
        <Tooltip label={tasksLabel()}>
          <button
            type="button"
            class="rail-item"
            data-active={tasksActive() ? "true" : undefined}
            aria-label={tasksLabel()}
            aria-pressed={tasksActive() && props.tasksOpen}
            onClick={props.onSelectTasks}
          >
            <ListTodo size={21} strokeWidth={2.2} />
            <span class="rail-item__label">Tasks</span>
          </button>
        </Tooltip>
        <Tooltip label="Agent 模板库">
          <button
            type="button"
            class="rail-item"
            data-active={templatesActive() ? "true" : undefined}
            aria-label="Agent 模板库"
            aria-pressed={templatesActive()}
            onClick={props.onSelectTemplates}
          >
            <LayoutTemplate size={21} strokeWidth={2.2} />
            <span class="rail-item__label">Templates</span>
          </button>
        </Tooltip>
        <Tooltip label="路径模板（Playbook）">
          <button
            type="button"
            class="rail-item"
            data-active={playbooksActive() ? "true" : undefined}
            aria-label="路径模板"
            aria-pressed={playbooksActive()}
            onClick={props.onSelectPlaybooks}
          >
            <Route size={21} strokeWidth={2.2} />
            <span class="rail-item__label">Paths</span>
          </button>
        </Tooltip>
      </nav>
    </aside>
  );
}
