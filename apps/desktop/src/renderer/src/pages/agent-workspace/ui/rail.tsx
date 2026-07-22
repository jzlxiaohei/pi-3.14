import { Bell, ListTodo, Plus, Command } from "lucide-solid";
import { IconButton } from "@/shared/ui/icon-button";

type RailProps = {
  onNewTask: () => void;
  onToggleTasks: () => void;
  tasksOpen: boolean;
};

/** Product-level nav only — task-scoped panels stay in the task workspace. */
export function Rail(props: RailProps) {
  return (
    <aside class="rail" aria-label="Primary navigation">
      <div class="brand-mark">
        <Command size={21} strokeWidth={2.4} />
      </div>
      <nav class="rail-nav">
        <IconButton
          label={props.tasksOpen ? "Hide task list" : "Show task list"}
          active={props.tasksOpen}
          onClick={props.onToggleTasks}
        >
          <ListTodo size={21} />
        </IconButton>
      </nav>
      <div class="rail-bottom">
        <IconButton label="New task" onClick={props.onNewTask}>
          <Plus size={21} />
        </IconButton>
        <IconButton label="Notifications">
          <Bell size={21} />
        </IconButton>
        <button class="profile-button" aria-label="Profile">Z</button>
      </div>
    </aside>
  );
}
