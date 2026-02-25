/** Status of a dev server for an iteration */
export type IterationStatus =
  | "creating"
  | "installing"
  | "starting"
  | "ready"
  | "error"
  | "stopped";

/** Information about a single iteration (worktree + dev server) */
export interface IterationInfo {
  name: string;
  branch: string;
  worktreePath: string;
  port: number;
  pid: number | null;
  status: IterationStatus;
  createdAt: string;
}
