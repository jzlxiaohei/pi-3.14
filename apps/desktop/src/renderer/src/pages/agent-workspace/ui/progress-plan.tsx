import { Check, CirclePlus, LoaderCircle } from "lucide-solid";
import { For } from "solid-js";

type ProgressPlanProps = {
  completed: boolean;
};

const steps = [
  "Inspect middleware and auth flow",
  "Extract shared verification helper",
  "Update routes and run tests"
];

export function ProgressPlan(props: ProgressPlanProps) {
  const completedCount = () => props.completed ? 3 : 2;

  return (
    <div class="plan-card">
      <div class="plan-title">
        <span><CirclePlus size={17} /> Plan</span>
        <small>{completedCount()}/3 complete</small>
      </div>
      <For each={steps}>
        {(step, index) => {
          const done = () => index() < completedCount();
          return (
            <div class="plan-step">
              <span class={done() ? "step-done" : "step-running"}>
                {done() ? <Check size={12} strokeWidth={2.4} /> : <LoaderCircle size={12} />}
              </span>
              <span>{step}</span>
            </div>
          );
        }}
      </For>
    </div>
  );
}
