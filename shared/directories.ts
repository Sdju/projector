export interface DirectoryEntry {
  name: string;
  path: string;
}
export interface DirectoryListing {
  path: string;
  entries: DirectoryEntry[];
  truncated: boolean;
}
