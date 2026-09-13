export type DiagnosticSeverity = "blocking" | "warning" | "info";

export interface DiagnosticScope {
  projectId: string;
  productId: string;
  platform: string;
}

export interface DiagnosticEvidenceRef {
  id: string;
  kind: string;
  label: string;
  query: Record<string, string | number | boolean | null>;
}

export interface DiagnosticFact {
  id: string;
  statement: string;
  evidenceIds: string[];
}

export interface DiagnosticAnomaly {
  id: string;
  severity: DiagnosticSeverity;
  statement: string;
  evidenceIds: string[];
  /** What can be concluded without assigning an unproven cause. */
  interpretation: string;
}

export interface DiagnosticPackage<TCoverage> {
  schemaVersion: 1;
  generatedAt: string;
  scope: DiagnosticScope;
  coverage: TCoverage;
  facts: DiagnosticFact[];
  anomalies: DiagnosticAnomaly[];
  limitations: string[];
  evidenceIndex: DiagnosticEvidenceRef[];
}
