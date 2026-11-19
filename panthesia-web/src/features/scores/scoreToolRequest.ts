export interface ScoreToolRequest {
  id: string;
  contentId: string;
  engineId?: string;
  kind: "export" | "located";
  sourceFingerprint?: string;
}
