export interface GraphRow {
  /** Column of the commit node. */
  column: number;
  /** Columns whose vertical line crosses the whole row without touching the node. */
  through: number[];
  /** Columns that reach the node from above; the node's own column is included when a child led here. */
  joins: number[];
  /** Columns the node continues into below: its first parent, then extra parents of a merge. */
  forks: number[];
  /** Number of columns this row needs. */
  width: number;
}

/**
 * Lays out commits (newest first, parents after children) on vertical lanes.
 * A lane waits for the hash of the next commit expected on it; commits whose
 * parents fall outside the loaded page simply keep their lane to the bottom.
 */
export function layoutGraph(commits: { hash: string; parents: string[] }[]): GraphRow[] {
  const lanes: (string | null)[] = [];
  const free = () => {
    const index = lanes.indexOf(null);
    return index === -1 ? lanes.length : index;
  };
  return commits.map((commit) => {
    const joins = lanes.flatMap((hash, index) => (hash === commit.hash ? [index] : []));
    const column = joins[0] ?? free();
    const through = lanes.flatMap((hash, index) =>
      hash !== null && hash !== commit.hash ? [index] : [],
    );
    for (const index of joins) lanes[index] = null;
    const forks: number[] = [];
    commit.parents.forEach((parent, order) => {
      const existing = lanes.indexOf(parent);
      if (existing !== -1) {
        forks.push(existing);
        return;
      }
      // The first parent continues in the node's own lane.
      const target = order === 0 ? column : free();
      lanes[target] = parent;
      forks.push(target);
    });
    while (lanes.length && lanes.at(-1) === null) lanes.pop();
    const used = [column, ...through, ...joins, ...forks];
    return { column, through, joins, forks, width: Math.max(...used) + 1 };
  });
}
