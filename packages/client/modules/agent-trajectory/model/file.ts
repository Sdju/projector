/** The document file the special viewer accepts, and its default title. */

const TRAJECTORY_FILE = /\.(?:trajectory|trace)\.json$/i;

/** Whether a path is a trajectory document rather than ordinary JSON. */
export function isTrajectoryFilePath(path: string): boolean {
  return TRAJECTORY_FILE.test(path);
}

/** A readable title from the file name: `incident.trajectory.json` → `incident`. */
export function trajectoryFileTitle(path: string): string {
  const name = path.split("/").filter(Boolean).at(-1) ?? "Траектория";
  return name.replace(TRAJECTORY_FILE, "") || "Траектория";
}
