import { runPowerShellSync } from "./ps.ts";

/**
 * Start Menu / wscript hide the console. A modal MessageBox is the only way a
 * failed launch is visible; skip it when the user already has a TTY.
 */
export function alertHiddenFailure(message: string): void {
  const fromShortcut = process.env.PROJECTOR_FROM_SHORTCUT === "1";
  if (process.stdout.isTTY && !fromShortcut) return;
  try {
    runPowerShellSync(
      "Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show($env:PROJECTOR_ALERT, 'Projector', 'OK', [System.Windows.Forms.MessageBoxIcon]::Error, [System.Windows.Forms.MessageBoxDefaultButton]::Button1, [System.Windows.Forms.MessageBoxOptions]::SystemModal) | Out-Null",
      {
        sta: true,
        timeout: 120000,
        env: { PROJECTOR_ALERT: String(message).slice(0, 1000) },
      },
    );
  } catch {
    /* best-effort */
  }
}
