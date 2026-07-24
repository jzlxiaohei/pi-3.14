import { Toast, Toaster, createToaster } from "@ark-ui/solid/toast";
import { Check, CircleAlert, Info, X } from "lucide-solid";
import { Match, Switch } from "solid-js";
import { Portal } from "solid-js/web";

/** App-wide Ark toast engine (Orbit-styled via `.orbit-toast*`). */
export const toaster = createToaster({
  placement: "bottom-end",
  overlap: true,
  gap: 12,
  max: 3,
  offsets: "16px",
});

export function OrbitToaster() {
  return (
    <Portal>
      <Toaster toaster={toaster} class="orbit-toaster">
        {(toast) => (
          <Toast.Root class="orbit-toast">
            <div class="orbit-toast__icon" aria-hidden="true">
              <Switch fallback={<Info size={16} />}>
                <Match when={toast().type === "success"}>
                  <Check size={16} />
                </Match>
                <Match when={toast().type === "error"}>
                  <CircleAlert size={16} />
                </Match>
              </Switch>
            </div>
            <div class="orbit-toast__copy">
              <Toast.Title class="orbit-toast__title">{toast().title}</Toast.Title>
              <Toast.Description class="orbit-toast__desc">
                {toast().description}
              </Toast.Description>
            </div>
            <Toast.CloseTrigger class="orbit-toast__close" aria-label="Dismiss">
              <X size={14} />
            </Toast.CloseTrigger>
          </Toast.Root>
        )}
      </Toaster>
    </Portal>
  );
}

export function notifySuccess(title: string, description?: string): string {
  return toaster.create({
    title,
    description,
    type: "success",
    duration: 12_000,
  });
}

export function notifyError(title: string, description?: string): string {
  return toaster.create({
    title,
    description,
    type: "error",
    duration: 10_000,
  });
}
