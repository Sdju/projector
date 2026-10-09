const unsupported = (what: string) => new Error(`${what} не поддерживается на macOS`);

export const catalog = async (): Promise<never> => {
  throw unsupported("Каталог приложений");
};
export const resident = async (): Promise<never> => {
  throw unsupported("Резидентная палитра");
};
export const desktopPid = async (_service: string): Promise<number | undefined> => undefined;
export const shortcutStatus = async () => ({ supported: false, active: false, shortcut: "" });
export const shortcutAvailable = async (_shortcut: string) => ({
  supported: false,
  available: false,
});
