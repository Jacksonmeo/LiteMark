export interface ReadResult {
  content: string
  mtimeMs: number
}

export interface SaveResult {
  mtimeMs: number
}

export interface RecentsResult {
  items: string[]
}

export type SaveFormat = 'markdown' | 'pdf' | 'latex'

export interface BridgeApi {
  initialFile(): Promise<string | null>
  openDialog(): Promise<string | null>
  saveDialog(defaultName: string, format?: SaveFormat): Promise<string | null>
  readFile(path: string): Promise<ReadResult>
  writeFile(path: string, content: string): Promise<SaveResult>
  writeFileBinary(path: string, data: Uint8Array): Promise<SaveResult>
  exportPdf(): Promise<Uint8Array | null>
  watchFile(path: string): void
  listRecents(): Promise<RecentsResult>
  addRecent(path: string): void
  setTitle(title: string): void
  setDirty(dirty: boolean): void
  forceClose(): void
  openExternal(url: string): void
  resolveAsset(filePath: string, src: string): Promise<string>
  getPathForFile(file: File): string
  onOpenPath(cb: (path: string) => void): void
  onFileChanged(cb: () => void): void
  onFileDeleted(cb: () => void): void
  onRequestSave(cb: () => void): void
}
