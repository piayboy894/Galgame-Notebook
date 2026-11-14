import { describe, expect, it, vi } from "vitest";
import {
  GitHubSyncService,
  type SyncPlan,
  type SyncPort,
} from "../src/application/sync-service";

function setup(action: SyncPlan["action"] = "upload") {
  const events: string[] = [];
  const port: SyncPort = {
    inspect: vi.fn(async () => {
      events.push("inspect");
      return {
        planId: "plan",
        action,
        path: "xuxian/projects/p.story.json",
        remoteText: action === "upload" ? null : '{"id":"p"}',
      };
    }),
    execute: vi.fn(async (_id, choice) => {
      events.push("execute:" + (choice || "auto"));
      return { action };
    }),
    validate: vi.fn(() => {
      events.push("validate");
    }),
    apply: vi.fn(() => {
      events.push("apply");
    }),
  };
  const service = new GitHubSyncService(port, () => {});
  return { service, port, events };
}
describe("manual GitHub sync workflow", () => {
  it("performs no network until requested and saves before inspection", async () => {
    const { service, port, events } = setup();
    expect(port.inspect).not.toHaveBeenCalled();
    await service.synchronize(async () => {
      events.push("save");
      return true;
    });
    expect(events).toEqual(["save", "inspect", "execute:auto", "apply"]);
    expect(service.state.phase).toBe("done");
  });
  it("stops when local saving is cancelled or fails", async () => {
    const { service, port } = setup();
    await service.synchronize(async () => false);
    expect(port.inspect).not.toHaveBeenCalled();
    expect(service.state.phase).toBe("idle");
  });
  it("validates incoming data before allowing a local replacement", async () => {
    const { service, port, events } = setup("download");
    await service.synchronize(async () => true);
    expect(events).toEqual(["inspect", "validate", "execute:auto", "apply"]);
    vi.mocked(port.validate).mockImplementation(() => {
      throw Error("invalid story");
    });
    vi.mocked(port.execute).mockClear();
    await service.synchronize(async () => true);
    expect(port.execute).not.toHaveBeenCalled();
    expect(service.state).toEqual({ phase: "error", message: "invalid story" });
  });
  it("waits for a conflict decision and supports cancellation", async () => {
    const { service, port } = setup("conflict");
    await service.synchronize(async () => true);
    expect(service.state.phase).toBe("conflict");
    expect(port.execute).not.toHaveBeenCalled();
    service.cancel();
    await service.resolve("local");
    expect(port.execute).not.toHaveBeenCalled();
    await service.synchronize(async () => true);
    await service.resolve("remote");
    expect(port.execute).toHaveBeenCalledWith("plan", "remote");
    expect(service.state.phase).toBe("done");
  });
  it("does not automatically recreate remote deletions", async () => {
    const { service, port } = setup("deleted");
    await service.synchronize(async () => true);
    await service.resolve("remote");
    expect(port.execute).not.toHaveBeenCalled();
    await service.resolve("local");
    expect(port.execute).toHaveBeenCalledWith("plan", "local");
  });
  it("prevents duplicate requests while a sync is in flight and retries after network failure", async () => {
    const { service, port } = setup();
    let release!: () => void;
    const first = service.synchronize(
      () =>
        new Promise<boolean>((resolve) => {
          release = () => resolve(true);
        }),
    );
    await service.synchronize(async () => true);
    release();
    await first;
    expect(port.inspect).toHaveBeenCalledTimes(1);
    vi.mocked(port.inspect).mockRejectedValueOnce(Error("offline"));
    await service.synchronize(async () => true);
    expect(service.state.phase).toBe("error");
    await service.synchronize(async () => true);
    expect(service.state.phase).toBe("done");
  });
});
