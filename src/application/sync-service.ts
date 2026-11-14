export interface SyncPlan {
  planId: string;
  action: "upload" | "download" | "current" | "conflict" | "deleted";
  remoteText?: string | null;
  path: string;
}
export interface SyncPort {
  inspect(): Promise<SyncPlan>;
  execute(planId: string, resolution?: "local" | "remote"): Promise<any>;
  validate(text: string): void;
  apply(result: any): void;
}
export type SyncState =
  | { phase: "idle" | "saving" | "checking" | "syncing" }
  | { phase: "conflict"; plan: SyncPlan }
  | { phase: "done"; result: any }
  | { phase: "error"; message: string };

/** Manual synchronization only. Save and validate before any remote or local replacement. */
export class GitHubSyncService {
  state: SyncState = { phase: "idle" };
  private busy = false;
  private pending: SyncPlan | null = null;
  constructor(
    private readonly port: SyncPort,
    private readonly changed: (state: SyncState) => void,
  ) {}
  private set(state: SyncState) {
    this.state = state;
    this.changed(state);
  }
  private error(cause: unknown) {
    this.pending = null;
    this.set({
      phase: "error",
      message: cause instanceof Error ? cause.message : "同步未完成，请重试",
    });
  }
  async synchronize(save: () => Promise<boolean>) {
    if (this.busy) return;
    this.busy = true;
    this.pending = null;
    try {
      this.set({ phase: "saving" });
      if (!(await save())) {
        this.set({ phase: "idle" });
        return;
      }
      this.set({ phase: "checking" });
      const plan = await this.port.inspect();
      if (plan.remoteText) this.port.validate(plan.remoteText);
      if (plan.action === "conflict" || plan.action === "deleted") {
        this.pending = plan;
        this.set({ phase: "conflict", plan });
        return;
      }
      this.set({ phase: "syncing" });
      const result = await this.port.execute(plan.planId);
      this.port.apply(result);
      this.set({ phase: "done", result });
    } catch (cause) {
      this.error(cause);
    } finally {
      this.busy = false;
    }
  }
  async resolve(resolution: "local" | "remote") {
    if (this.busy || !this.pending) return;
    const plan = this.pending;
    if (plan.action === "deleted" && resolution === "remote") return;
    this.pending = null;
    this.busy = true;
    try {
      this.set({ phase: "syncing" });
      const result = await this.port.execute(plan.planId, resolution);
      this.port.apply(result);
      this.set({ phase: "done", result });
    } catch (cause) {
      this.error(cause);
    } finally {
      this.busy = false;
    }
  }
  cancel() {
    if (!this.busy) {
      this.pending = null;
      this.set({ phase: "idle" });
    }
  }
}
