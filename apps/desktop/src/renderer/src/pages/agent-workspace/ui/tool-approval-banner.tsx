import { ShieldAlert } from "lucide-solid";
import { Show } from "solid-js";
import type { PiToolApprovalRequest } from "../../../../../shared/desktop-contracts";
import { Button } from "@/shared/ui/button";

type ToolApprovalBannerProps = {
  request: PiToolApprovalRequest | null;
  onAllow: () => void;
  onDeny: () => void;
};

export function ToolApprovalBanner(props: ToolApprovalBannerProps) {
  return (
    <Show when={props.request}>
      {(request) => (
        <div class="tool-approval-banner" role="alertdialog" aria-label="Tool approval required">
          <div class="tool-approval-copy">
            <ShieldAlert size={18} />
            <div>
              <strong>Allow `{request().toolName}` for this chat?</strong>
              <p>{summarizeArgs(request().args)}</p>
            </div>
          </div>
          <div class="tool-approval-actions">
            <Button variant="secondary" onClick={props.onDeny}>Deny</Button>
            <Button variant="primary" onClick={props.onAllow}>Allow for this chat</Button>
          </div>
        </div>
      )}
    </Show>
  );
}

function summarizeArgs(args: unknown): string {
  try {
    const text = JSON.stringify(args, null, 0);
    return text.length > 180 ? `${text.slice(0, 177)}…` : text;
  } catch {
    return String(args);
  }
}
