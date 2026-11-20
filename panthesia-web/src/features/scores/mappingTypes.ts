export interface ScoreMapping {
  id: string;
  page: number;
  start: number;
  end: number;
  pitch: number;
  track: number;
  index: number;
  scoreFinger: string | null;
}
export interface RendererNoteEvidence {
  renderer_id: string;
  page_index: number;
  onset_millis: number;
  pitch: number;
  duration_millis: number;
}
export interface ScoreMappingResult {
  mapping: ScoreMapping[];
  ambiguities: number;
  unmapped: number;
  following: boolean;
  mappingToken?: string;
}
export interface ScoreMappingRequest {
  measureRange?: {first:number;count:number};
  displayFingerprint?:string;
  pageCount?: number;
  practiceNotation?: boolean;
  contentId: string;
  scoreRevision: number;
  sourceFingerprint: string;
  midi: number[];
  notes: RendererNoteEvidence[];
}
