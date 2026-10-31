export type TerminalClipboardFailure = "retry" | "denied" | "unsupported";

export type TerminalClipboardResult =
  | { status: "success"; text: string }
  | { status: TerminalClipboardFailure };

export async function readTerminalClipboard(
  clipboard: Pick<Clipboard, "readText"> | undefined,
  permissions: Pick<Permissions, "query"> | undefined,
): Promise<TerminalClipboardResult> {
  if (!clipboard) return { status: "unsupported" };
  try {
    return { status: "success", text: await clipboard.readText() };
  } catch {
    try {
      const permission = await permissions?.query({
        name: "clipboard-read" as PermissionName,
      });
      if (permission?.state === "denied") return { status: "denied" };
    } catch {
      // Some browsers expose Clipboard API without clipboard-read permission queries.
    }
    return { status: "retry" };
  }
}
