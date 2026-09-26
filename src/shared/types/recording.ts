export interface RecordingEvidence {
  id: string;
  sessionId: string;
  tabId: number;
  url: string;
  createdAt: number;
  durationMs: number;
  mimeType: string;
  size: number;
  blob: Blob;
}

export interface RecordingStatus {
  active: boolean;
  startedAt?: number;
  sessionId?: string;
  tabId?: number;
  chunkCount?: number;
  error?: string;
}
