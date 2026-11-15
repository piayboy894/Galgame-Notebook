import { describe, expect, it, vi } from "vitest";
import {
  LibraryArchiveService,
  type LibraryArchivePort,
} from "../src/application/archive-service";
const target = {
  connectionId: "global",
  fileName: "save.json",
  sha: "previewed",
};
function setup() {
  const events: string[] = [];
  const port: LibraryArchivePort = {
    saveCurrent: vi.fn(async () => {
      events.push("save-local");
      return true;
    }),
    saveSlot: vi.fn(async (request) => {
      events.push("save-cloud");
      return request;
    }),
    loadSlot: vi.fn(async (request) => {
      events.push("load-cloud");
      return request;
    }),
    deleteSlot: vi.fn(async (request) => {
      events.push("delete-cloud");
      return request;
    }),
    applyLibrary: vi.fn(() => events.push("apply-library")),
  };
  return { port, events, service: new LibraryArchiveService(port) };
}
describe("explicit whole-library save slots", () => {
  it("does nothing at startup and always follows the user's save direction", async () => {
    const { service, port, events } = setup();
    expect(events).toEqual([]);
    const request = { ...target, name: "第一幕完成", note: "all projects" };
    await service.save(request);
    expect(events).toEqual(["save-local", "save-cloud"]);
    expect(port.saveSlot).toHaveBeenCalledWith(request);
    expect(port.loadSlot).not.toHaveBeenCalled();
  });
  it("loads and applies the whole library without saving or backing up local edits", async () => {
    const { service, port, events } = setup();
    await service.load(target);
    expect(events).toEqual(["load-cloud", "apply-library"]);
    expect(port.saveCurrent).not.toHaveBeenCalled();
    expect(port.loadSlot).toHaveBeenCalledWith(target);
    expect(port.saveSlot).not.toHaveBeenCalled();
  });
  it("cancels a cloud save when saving local edits is cancelled, but can still load", async () => {
    const { service, port } = setup();
    vi.mocked(port.saveCurrent).mockResolvedValue(false);
    expect(
      await service.save({ ...target, name: "save", note: "" }),
    ).toBeNull();
    expect(port.saveSlot).not.toHaveBeenCalled();
    vi.mocked(port.saveCurrent).mockClear();
    await service.load(target);
    expect(port.loadSlot).toHaveBeenCalledWith(target);
    expect(port.saveCurrent).not.toHaveBeenCalled();
  });
  it("deleting a selected slot never saves or applies a local project", async () => {
    const { service, port, events } = setup();
    await service.delete(target);
    expect(events).toEqual(["delete-cloud"]);
    expect(port.saveCurrent).not.toHaveBeenCalled();
    expect(port.applyLibrary).not.toHaveBeenCalled();
  });
  it("keeps current edits when a load fails and allows an explicit retry", async () => {
    const { service, port } = setup();
    vi.mocked(port.loadSlot).mockRejectedValueOnce(Error("stale preview"));
    await expect(service.load(target)).rejects.toThrow("stale preview");
    expect(port.applyLibrary).not.toHaveBeenCalled();
    expect(port.saveCurrent).not.toHaveBeenCalled();
    await service.load(target);
    expect(port.applyLibrary).toHaveBeenCalledTimes(1);
  });
  it("blocks duplicate operations and recovers after a request fails", async () => {
    const { service, port } = setup();
    let finish: () => void = () => {};
    vi.mocked(port.loadSlot).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = () => resolve(target);
        }),
    );
    const first = service.load(target);
    expect(await service.delete(target)).toBeNull();
    finish();
    await first;
    vi.mocked(port.deleteSlot).mockRejectedValueOnce(Error("offline"));
    await expect(service.delete(target)).rejects.toThrow("offline");
    await service.delete(target);
    expect(port.deleteSlot).toHaveBeenCalledTimes(2);
  });
});
