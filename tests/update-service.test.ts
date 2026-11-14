import { describe, expect, it, vi } from "vitest";
import {
  UpdateService,
  type UpdatePort,
  type AvailableUpdate,
} from "../src/application/update-service";

function setup() {
  const update: AvailableUpdate = {
    version: "2.1.0",
    notes: "改进调查阶段",
    install: vi.fn(async (progress) => {
      progress(50, 100);
    }),
    close: vi.fn(async () => {}),
  };
  const port: UpdatePort = {
    check: vi.fn(async () => update),
    backup: vi.fn(async () => {}),
    relaunch: vi.fn(async () => {}),
  };
  const changed = vi.fn();
  return { update, port, changed, service: new UpdateService(port, changed) };
}

describe("user-controlled updater", () => {
  it("stays offline until the user checks and never installs during a check", async () => {
    const { service, port, update } = setup();
    expect(port.check).not.toHaveBeenCalled();
    await service.check();
    expect(service.state).toEqual({
      phase: "available",
      version: "2.1.0",
      notes: "改进调查阶段",
    });
    expect(update.install).not.toHaveBeenCalled();
  });
  it("saves and backs up before installation, then relaunches", async () => {
    const { service, port, update, changed } = setup();
    const order: string[] = [];
    port.backup = vi.fn(async () => {
      order.push("backup");
    });
    update.install = vi.fn(async (progress) => {
      order.push("install");
      progress(50, 100);
    });
    port.relaunch = vi.fn(async () => {
      order.push("relaunch");
    });
    await service.check();
    await service.install(async () => {
      order.push("save");
      return true;
    });
    expect(order).toEqual(["save", "backup", "install", "relaunch"]);
    expect(changed).toHaveBeenCalledWith({
      phase: "downloading",
      received: 50,
      total: 100,
    });
  });
  it("does not update when saving is cancelled or fails", async () => {
    const { service, port, update } = setup();
    await service.check();
    await service.install(async () => false);
    expect(port.backup).not.toHaveBeenCalled();
    expect(update.install).not.toHaveBeenCalled();
    expect(service.state.phase).toBe("available");
  });
  it("stops when backup fails without downloading or restarting", async () => {
    const { service, port, update } = setup();
    port.backup = vi.fn(async () => {
      throw new Error("磁盘已满");
    });
    await service.check();
    await service.install(async () => true);
    expect(service.state).toEqual({ phase: "error", message: "磁盘已满" });
    expect(update.install).not.toHaveBeenCalled();
    expect(port.relaunch).not.toHaveBeenCalled();
  });
  it("does not restart after a failed download or invalid signature", async () => {
    const { service, port, update } = setup();
    update.install = vi.fn(async () => {
      throw new Error("signature verification failed");
    });
    await service.check();
    await service.install(async () => true);
    expect(service.state.phase).toBe("error");
    expect(port.relaunch).not.toHaveBeenCalled();
  });
  it("recovers after a network error and releases a previous update handle", async () => {
    const { service, port, update } = setup();
    vi.mocked(port.check).mockRejectedValueOnce(new Error("timeout"));
    await service.check();
    expect(service.state.phase).toBe("error");
    await service.check();
    await service.check();
    expect(update.close).toHaveBeenCalledTimes(1);
    vi.mocked(port.check).mockResolvedValueOnce(null);
    await service.check();
    expect(service.state.phase).toBe("current");
  });
  it("ignores repeated clicks while checking or installing", async () => {
    const { service, port } = setup();
    let finish!: (value: AvailableUpdate | null) => void;
    port.check = vi.fn(
      () =>
        new Promise<AvailableUpdate | null>((resolve) => {
          finish = resolve;
        }),
    );
    const pending = service.check();
    await service.check();
    expect(port.check).toHaveBeenCalledTimes(1);
    finish(null);
    await pending;
  });
});
