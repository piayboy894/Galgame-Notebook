export type UpdateState =
  | { phase: "idle" | "checking" | "current" }
  | { phase: "available"; version: string; notes: string }
  | { phase: "downloading"; received: number; total?: number }
  | { phase: "installing" }
  | { phase: "error"; message: string };

export interface AvailableUpdate {
  version: string;
  notes: string;
  install(progress: (received: number, total?: number) => void): Promise<void>;
  close(): Promise<void>;
}

export interface UpdatePort {
  check(): Promise<AvailableUpdate | null>;
  backup(): Promise<void>;
  relaunch(): Promise<void>;
}

/** No network requests until check() is explicitly called by the user. */
export class UpdateService {
  state: UpdateState = { phase: "idle" };
  private update: AvailableUpdate | null = null;
  private busy = false;

  constructor(
    private readonly port: UpdatePort,
    private readonly changed: (state: UpdateState) => void,
  ) {}

  private set(state: UpdateState): void {
    this.state = state;
    this.changed(state);
  }

  async check(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.set({ phase: "checking" });
    try {
      await this.update?.close();
      this.update = null;
      this.update = await this.port.check();
      this.set(
        this.update
          ? {
              phase: "available",
              version: this.update.version,
              notes: this.update.notes,
            }
          : { phase: "current" },
      );
    } catch (cause) {
      this.set({
        phase: "error",
        message: String(cause instanceof Error ? cause.message : cause),
      });
    } finally {
      this.busy = false;
    }
  }

  async install(save: () => Promise<boolean>): Promise<void> {
    if (this.busy || !this.update) return;
    this.busy = true;
    try {
      if (!(await save())) return;
      await this.port.backup();
      this.set({ phase: "downloading", received: 0 });
      await this.update.install((received, total) =>
        this.set({ phase: "downloading", received, total }),
      );
      this.set({ phase: "installing" });
      await this.port.relaunch();
    } catch (cause) {
      this.set({
        phase: "error",
        message: String(cause instanceof Error ? cause.message : cause),
      });
    } finally {
      this.busy = false;
    }
  }
}
