export interface ScreenshotEvidence {
  id: string;
  sessionId: string;
  snapshotId?: string;
  createdAt: number;
  url: string;
  dataUrl: string;
}
