/** Only these serializable contracts cross the desktop IPC boundary. */
export interface FileStamp {
  size: number;
  lastModified: number;
  hash: string;
}

export interface ProjectDocument {
  format: "xuxian.story";
  version: 1 | 2 | 3 | 4;
  id: string;
  title: string;
  routes: unknown[];
  chapters: unknown[];
  [field: string]: unknown;
}

export interface NativeError {
  status: number;
  message: string;
}

export type CommandBody = Record<string, unknown>;

export interface ProjectFile {
  name: string;
  text: string;
  stamp: FileStamp;
  bindingId: string;
}
