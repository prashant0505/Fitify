export type Segment = {
  id: number;
  text: string;
  editable: boolean;
  section: string;
  maxCharacters?: number;
  sourceLine?: string;
};
export type Analysis = {
  title: string;
  company: string;
  experience: string;
  required: string[];
  preferred: string[];
  responsibilities: string[];
  matched: string[];
  missing: string[];
  strengths: string[];
  improvements: string[];
  score: number;
  method: string;
};
export type Change = {
  id: number;
  original: string;
  replacement: string;
  reason: string;
  evidence: string;
};
export type ConfirmedEvidence = { term: string; detail: string; targetId?: number };
export type JobRequirement = {
  term: string;
  priority: "Must-have" | "Preferred" | "Listed";
  description: string;
  alternatives?: string[];
};
export type Validation = {
  passed: boolean;
  pagesOriginal: number;
  pagesTailored: number;
  checks: string[];
  warnings: string[];
};
export type Job = {
  id: string;
  name: string;
  format: string;
  status: string;
  stage: number;
  score: number | null;
  role: string;
  company: string;
  createdAt: number;
  expiresAt: number;
  error: string | null;
  analysis?: Analysis;
  segments?: Segment[];
  changes?: Change[];
  validation?: Validation;
  pages?: number;
  editable?: boolean;
  notice?: string;
  pdfEngineVersion?: number;
  requirements?: JobRequirement[];
  confirmedEvidence?: ConfirmedEvidence[];
};
export const STAGES = [
  "Extracting document content",
  "Analyzing job description",
  "Matching skills and experience",
  "Optimizing resume content",
  "Checking factual support",
  "Preserving original formatting",
  "Validating generated document",
  "Preparing final resume",
];
