import { Bell, Bot, Files, GitBranch, Plus, Terminal, Command } from "lucide-solid";
import { IconButton } from "@/shared/ui/icon-button";

type RailProps = {
  onNewTask: () => void;
};

export function Rail(props: RailProps) {
  return (
    <aside class="rail" aria-label="Primary navigation">
      <div class="brand-mark">
        <Command size={21} strokeWidth={2.4} />
      </div>
      <nav class="rail-nav">
        <IconButton label="Agent tasks" active>
          <Bot size={21} />
        </IconButton>
        <IconButton label="Files">
          <Files size={21} />
        </IconButton>
        <IconButton label="Source control">
          <GitBranch size={21} />
        </IconButton>
        <IconButton label="Terminal">
          <Terminal size={21} />
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
