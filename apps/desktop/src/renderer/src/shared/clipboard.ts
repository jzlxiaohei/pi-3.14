import { notifyError } from "@/shared/ui/toast";

/** Copy text via the preload → main clipboard bridge. */
export async function writeClipboardText(text: string): Promise<boolean> {
  try {
    const write = window.piDesktop?.clipboard?.writeText;
    if (!write) {
      throw new Error("Clipboard bridge unavailable — restart the app");
    }
    await write(text);
    return true;
  } catch (error) {
    notifyError("Copy failed", error instanceof Error ? error.message : String(error));
    return false;
  }
}
