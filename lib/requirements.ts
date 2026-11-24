import { contains } from "./analysis.ts";
import type { Change, JobRequirement, Segment } from "./types";

export const TARGET_ALIGNMENT = 90;
const weight = { "Must-have": 3, Listed: 2, Preferred: 1 };

export function jobRequirements(jd: string, terms: string[]): JobRequirement[] {
  const found = new Map<string, JobRequirement>();
  const rank = { "Must-have": 0, Preferred: 1, Listed: 2 };
  let section: JobRequirement["priority"] = "Listed";
  for (const line of jd.split(/\r?\n/)) {
    const description = line.trim();
    if (/^(?:preferred|nice to have|bonus|desired)(?:\s+(?:skills|experience|qualifications))?\s*:?$/i.test(description))
      section = "Preferred";
    else if (/^(?:required(?:\s+(?:skills|experience|qualifications))?|requirements|minimum qualifications|must[- ]haves?)\s*:?$/i.test(description))
      section = "Must-have";
    else if (/^(?:responsibilities|about (?:us|you|the role)|benefits)\s*:?$/i.test(description))
      section = "Listed";
    const termsOnLine = terms.filter((term) => contains(description, term));
    const examples = description.match(/(?:\be\.g\.|\b(?:one of|either|such as|like)\b)([^;]*)/i)?.[1];
    const choice = examples ?? description.split(/,|;|\band\b/i).find((part) => /\bor\b/i.test(part));
    const alternatives = choice && !/\b(?:both|all of)\b/i.test(description)
      ? termsOnLine.filter((term) => contains(choice, term)) : [];
    for (const term of termsOnLine) {
      const priority = /\b(?:not required|preferred|nice to have|bonus|desirable)\b/i.test(description)
        ? "Preferred"
        : /\b(?:required|must have|must-have|minimum)\b/i.test(description)
          ? "Must-have" : section;
      const previous = found.get(term);
      const options = alternatives.length > 1 && alternatives.includes(term) ? alternatives : undefined;
      if (!previous || rank[priority] < rank[previous.priority] ||
          (previous.priority === priority && previous.alternatives && !options))
        found.set(term, { term, priority, description: description.slice(0, 260), alternatives: options });
    }
  }
  return [...found.values()].sort((a, b) => rank[a.priority] - rank[b.priority]);
}

export function assessAlignment(
  requirements: JobRequirement[],
  segments: Segment[],
  changes: Change[] = [],
) {
  const replacements = new Map(changes.map((change) => [change.id, change.replacement]));
  const text = segments.map((segment) => replacements.get(segment.id) ?? segment.text).join("\n");
  const work = segments.filter((segment) => /experience|employment|projects?/i.test(segment.section))
    .map((segment) => replacements.get(segment.id) ?? segment.text).join("\n");
  const groups = new Map<string, { terms: string[]; priority: JobRequirement["priority"] }>();
  const independent = new Set(requirements.filter((item) => !item.alternatives).map((item) => item.term));
  for (const item of requirements) {
    if (item.alternatives?.some((term) => independent.has(term))) continue;
    const terms = item.alternatives ?? [item.term];
    groups.set(terms.slice().sort().join("|"), { terms, priority: item.priority });
  }
  const items = [...groups.entries()].map(([id, group]) => ({
    id,
    ...group,
    matched: group.terms.filter((term) => contains(text, term)),
    inWork: group.terms.some((term) => contains(work, term)),
  }));
  const total = items.reduce((sum, item) => sum + weight[item.priority], 0);
  const covered = items.filter((item) => item.matched.length > 0);
  const earned = covered.reduce((sum, item) => sum + weight[item.priority], 0);
  return {
    items,
    score: total ? Math.round(100 * earned / total) : null,
    earned,
    workEvidence: covered.filter((item) => item.inWork).length,
    gaps: items.filter((item) => !item.matched.length),
  };
}

export function retainAlignedChanges(
  requirements: JobRequirement[],
  segments: Segment[],
  changes: Change[],
) {
  const baseline = assessAlignment(requirements, segments);
  const covered = new Set(baseline.items.filter((item) => item.matched.length).map((item) => item.id));
  const retainsCoverage = (edits: Change[]) =>
    !assessAlignment(requirements, segments, edits).gaps.some((gap) => covered.has(gap.id));
  if (retainsCoverage(changes)) return changes;
  const accepted: Change[] = [];
  for (const change of changes)
    if (retainsCoverage([...accepted, change])) accepted.push(change);
  return accepted;
}

export function requirementEvidence(term: string, segments: Segment[], changes: Change[]) {
  const source = segments.find((segment) => contains(segment.text, term));
  const tailored = changes.find((change) => contains(change.replacement, term));
  return {
    original: source?.text,
    tailored: tailored?.replacement,
    mentioned: !!tailored || segments.some((segment) =>
      !changes.some((change) => change.id === segment.id) && contains(segment.text, term),
    ),
  };
}
