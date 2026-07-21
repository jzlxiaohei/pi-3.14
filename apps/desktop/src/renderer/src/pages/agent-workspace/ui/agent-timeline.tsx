import {
  Check,
  CheckCircle,
  FileCode,
  LoaderCircle,
  Search,
  Sparkles,
  Terminal,
  UserCircle
} from "lucide-solid";
import type { JSX } from "solid-js";
import { Show } from "solid-js";
import { Button } from "@/shared/ui/button";
import { ProgressPlan } from "./progress-plan";

type AgentTimelineProps = {
  isComplete: boolean;
  onComplete: () => void;
};

export function AgentTimeline(props: AgentTimelineProps) {
  return (
    <section class="thread">
      <div class="message user-message">
        <div class="message-meta">
          <span class="avatar user"><UserCircle size={21} /></span>
          <strong>You</strong>
          <time>10:42</time>
        </div>
        <div class="message-body user-bubble">
          Refactor the auth middleware so route handlers share the same token verification path.
          Keep behavior unchanged and add coverage for expired sessions.
        </div>
      </div>

      <div class="message agent-message">
        <div class="message-meta">
          <span class="avatar agent"><Sparkles size={17} /></span>
          <strong>Orbit</strong>
          <span class="role">CODE AGENT</span>
          <time>10:42</time>
        </div>
        <div class="message-body">
          <p>I’ll trace the current auth paths, consolidate verification behind one helper, then run the focused test suite.</p>
          <ProgressPlan completed={props.isComplete} />
          <ToolCall icon={<Search size={15} />} title="Explored authentication flow" detail="Read 8 files · found 3 verification paths" />
          <ToolCall icon={<FileCode size={15} />} title="Edited 2 files" detail="+48 −31 lines" />
          <ToolCall
            icon={<Terminal size={15} />}
            title={props.isComplete ? "Tests passed" : "Running focused tests"}
            detail="auth.test.ts · session.test.ts"
            running={!props.isComplete}
          />
          <Show when={props.isComplete}>
            <div class="agent-result">
              <CheckCircle size={18} />
              <p><strong>Refactor complete.</strong> Token verification now has one path, and expired-session coverage was added. All 24 focused tests pass.</p>
            </div>
          </Show>
        </div>
      </div>

      <Show when={!props.isComplete}>
        <Button class="simulation-button" variant="ghost" onClick={props.onComplete}>
          <Check size={15} /> Simulate completion
        </Button>
      </Show>
    </section>
  );
}

type ToolCallProps = {
  detail: string;
  icon: JSX.Element;
  running?: boolean;
  title: string;
};

function ToolCall(props: ToolCallProps) {
  return (
    <div class="tool-call" data-running={props.running ? "true" : undefined}>
      <span class="tool-icon">{props.icon}</span>
      <span class="tool-copy">
        <strong>{props.title}</strong>
        <small>{props.detail}</small>
      </span>
      {props.running ? <LoaderCircle class="spin" size={17} /> : <CheckCircle size={17} />}
    </div>
  );
}
