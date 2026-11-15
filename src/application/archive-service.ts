export interface ArchiveTarget {
  connectionId: string;
  fileName: string;
  sha: string;
}
export interface ArchiveSave extends ArchiveTarget {
  name: string;
  note: string;
}
export interface LibraryArchivePort {
  saveCurrent(): Promise<boolean>;
  saveSlot(request: ArchiveSave): Promise<any>;
  loadSlot(request: ArchiveTarget): Promise<any>;
  deleteSlot(request: ArchiveTarget): Promise<any>;
  applyLibrary(result: any): void;
}
/** Every mutation has an explicit direction selected by the user. No comparison or sync plan. */
export class LibraryArchiveService {
  private busy = false;
  constructor(private readonly port: LibraryArchivePort) {}
  private async run(work: () => Promise<any>): Promise<any> {
    if (this.busy) return null;
    this.busy = true;
    try {
      return await work();
    } finally {
      this.busy = false;
    }
  }
  save(request: ArchiveSave): Promise<any> {
    return this.run(async () =>
      (await this.port.saveCurrent()) ? this.port.saveSlot(request) : null,
    );
  }
  load(request: ArchiveTarget): Promise<any> {
    return this.run(async () => {
      const result = await this.port.loadSlot(request);
      this.port.applyLibrary(result);
      return result;
    });
  }
  delete(request: ArchiveTarget): Promise<any> {
    return this.run(() => this.port.deleteSlot(request));
  }
}
