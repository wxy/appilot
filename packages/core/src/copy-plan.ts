export const COPY_PLAN_FIELDS = [
  "name",
  "subtitle",
  "promotionalText",
  "description",
  "keywords",
] as const;

export type CopyPlanField = (typeof COPY_PLAN_FIELDS)[number];

export interface CopyPlanItem {
  id: string;
  projectId: string;
  productId: string;
  title: string;
  instruction: string;
  reason: string;
  fields: CopyPlanField[];
  /** Empty means every supported language. */
  languages: string[];
  source: "copilot" | "manual";
  sourceSuggestionId?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedDraftId?: string;
  lastUsedAt?: string;
}

export interface CopyPlanInput {
  title: string;
  instruction: string;
  reason: string;
  fields: CopyPlanField[];
  languages: string[];
}

function uniqueStrings(values: unknown, max = 20): string[] {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map((value) => String(value || "").trim()).filter(Boolean))]
    .slice(0, max);
}

export function normalizeCopyPlanInput(
  value: unknown,
  supportedLanguages: string[] = [],
): CopyPlanInput | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const title = String(raw.title || "").trim().slice(0, 80);
  const instruction = String(raw.instruction || "").trim().slice(0, 1000);
  const reason = String(raw.reason || "").trim().slice(0, 500);
  const fields = uniqueStrings(raw.fields)
    .filter((field): field is CopyPlanField => COPY_PLAN_FIELDS.includes(field as CopyPlanField));
  const allowedLanguages = new Set(supportedLanguages.map((item) => String(item).trim()).filter(Boolean));
  const languages = uniqueStrings(raw.languages)
    .filter((language) => allowedLanguages.size === 0 || allowedLanguages.has(language));
  if (!title || !instruction || fields.length === 0) return null;
  return { title, instruction, reason, fields, languages };
}

export function copyPlanDuplicateKey(input: CopyPlanInput): string {
  return `${input.title}\u0000${input.instruction}`.trim().toLocaleLowerCase();
}

export function createCopyPlanItem(args: {
  projectId: string;
  productId: string;
  input: CopyPlanInput;
  source: CopyPlanItem["source"];
  sourceSuggestionId?: string | null;
  now?: string;
  id?: string;
}): CopyPlanItem {
  const now = args.now || new Date().toISOString();
  return {
    id: args.id || `copy-plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    projectId: args.projectId,
    productId: args.productId,
    ...args.input,
    source: args.source,
    sourceSuggestionId: args.sourceSuggestionId || undefined,
    createdAt: now,
    updatedAt: now,
  };
}

export function copyPlansForProduct(project: any, productId: string): CopyPlanItem[] {
  return (Array.isArray(project?.copyPlans) ? project.copyPlans : [])
    .filter((item: any) => item?.productId === productId)
    .sort((a: any, b: any) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

export function upsertCopyPlan(project: any, item: CopyPlanItem): CopyPlanItem[] {
  const previous: CopyPlanItem[] = Array.isArray(project?.copyPlans) ? project.copyPlans : [];
  const next = previous.some((candidate) => candidate.id === item.id)
    ? previous.map((candidate) => candidate.id === item.id ? item : candidate)
    : [item, ...previous];
  project.copyPlans = next.slice(0, 100);
  return project.copyPlans;
}

export function deleteCopyPlan(project: any, productId: string, itemId: string): boolean {
  const previous: CopyPlanItem[] = Array.isArray(project?.copyPlans) ? project.copyPlans : [];
  const next = previous.filter((item) => !(item.id === itemId && item.productId === productId));
  if (next.length === previous.length) return false;
  project.copyPlans = next;
  return true;
}

export function markCopyPlansUsed(
  project: any,
  productId: string,
  draftId: string,
  languages: string[] = [],
  now = new Date().toISOString(),
): number {
  const languageSet = new Set(languages);
  let changed = 0;
  project.copyPlans = (Array.isArray(project?.copyPlans) ? project.copyPlans : []).map(
    (item: CopyPlanItem) => {
      const applies = item.productId === productId && (
        languageSet.size === 0
        || item.languages.length === 0
        || item.languages.some((language) => languageSet.has(language))
      );
      if (!applies) return item;
      changed += 1;
      return { ...item, lastUsedDraftId: draftId, lastUsedAt: now };
    },
  );
  return changed;
}

export function copyPlanMaterial(items: CopyPlanItem[], language?: string): string[] {
  return items
    .filter((item) => !language || item.languages.length === 0 || item.languages.includes(language))
    .map((item) => {
      const fields = item.fields.join(", ");
      const reason = item.reason ? ` Reason: ${item.reason}` : "";
      return `[${fields}] ${item.title}: ${item.instruction}.${reason}`;
    });
}
