import type { Analysis, Segment, Change, ConfirmedEvidence } from "./types";
const skills = [
  "JavaScript",
  "TypeScript",
  "Python",
  "Java",
  "C++",
  "C#",
  "Go",
  "Rust",
  "Ruby",
  "PHP",
  "React",
  "Next.js",
  "Vue",
  "Angular",
  "Node.js",
  "Express",
  "Django",
  "FastAPI",
  "Spring",
  "PostgreSQL",
  "MySQL",
  "MongoDB",
  "Redis",
  "SQL",
  "AWS",
  "Azure",
  "GCP",
  "Docker",
  "Kubernetes",
  "Terraform",
  "Git",
  "CI/CD",
  "GraphQL",
  "REST",
  "Kafka",
  "RabbitMQ",
  "Figma",
  "Agile",
  "Scrum",
  "Machine Learning",
  "TensorFlow",
  "PyTorch",
  "Excel",
  "Power BI",
  "Tableau",
  "Salesforce",
  "Leadership",
  "Stakeholder management",
  "Product management",
  "Communication",
  "Accessibility",
  "Testing",
  "Playwright",
  "Jest",
];
const skillAliases: Record<string, string[]> = {
  AWS: ["Amazon Web Services"],
  GCP: ["Google Cloud Platform"],
  "Node.js": ["NodeJS"],
  PostgreSQL: ["Postgres"],
  React: ["ReactJS"],
  Spring: ["SpringBoot"],
  TypeScript: ["Type Script"],
};
export function contains(text: string, term: string) {
  const variants = [term, ...(skillAliases[term] ?? [])]
    .map((value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("|");
  return new RegExp(`(^|[^a-z0-9])(?:${variants})($|[^a-z0-9])`, "i").test(text);
}
export const isSkillsSection = (section: string) =>
  /^(?:technical )?skills:?$/i.test(section.trim());

export function tailoredCoverage(
  terms: string[],
  segments: Segment[],
  changes: Change[],
) {
  const replacements = new Map(changes.map((change) => [change.id, change.replacement]));
  const text = segments.map((segment) => replacements.get(segment.id) ?? segment.text).join("\n");
  const matched = terms.filter((term) => contains(text, term));
  return {
    matched,
    missing: terms.filter((term) => !matched.includes(term)),
    score: terms.length ? Math.round((matched.length / terms.length) * 100) : 0,
  };
}

export function analyze(resume: string, jd: string): Analysis {
  const required = skills.filter((s) => contains(jd, s));
  const matched = required.filter((s) => contains(resume, s)),
    missing = required.filter((s) => !contains(resume, s));
  const lines = jd
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean);
  const title =
    lines.find(
      (l) =>
        /engineer|developer|designer|manager|analyst|specialist|consultant|architect|director/i.test(
          l,
        ) && l.length < 100,
    ) || "Target role";
  const company =
    lines
      .find((l) => /^(company|organization)\s*:/i.test(l))
      ?.replace(/^[^:]+:\s*/, "") || "";
  const experience =
    jd.match(
      /\d+(?:\s*[-–+]\s*\d*)?\s*(?:years?|yrs?)(?:\s+of\s+experience)?/i,
    )?.[0] || "Not specified";
  return {
    title,
    company,
    experience,
    required,
    preferred: [],
    responsibilities: lines
      .filter((l) =>
        /build|develop|design|lead|manage|collaborat|deliver|maintain/i.test(l),
      )
      .slice(0, 5),
    matched,
    missing,
    strengths: matched.length
      ? [
          `Your resume explicitly mentions ${matched.slice(0, 4).join(", ")}.`,
          `${matched.length} of ${required.length} recognized JD terms appear in your resume.`,
        ]
      : ["Your original document is retained for comparison."],
    improvements: [
      "Emphasize existing experience that supports the target responsibilities.",
      "Keep company names, dates, qualifications, and metrics unchanged.",
      ...(missing.length
        ? ["Report missing skills as gaps; do not insert them into the resume."]
        : []),
    ],
    score: required.length
      ? Math.round((matched.length / required.length) * 100)
      : 0,
    method:
      "Recognized keyword coverage, not an ATS score. This heuristic does not assess semantic fit or hiring probability.",
  };
}
export function validateChanges(
  segments: Segment[],
  changes: Change[],
  confirmedEvidence: ConfirmedEvidence[] = [],
) {
  if (!changes.length)
    throw new Error("The model returned no supported content changes.");
  const ids = new Set<number>();
  for (const c of changes) {
    const s = segments.find((s) => s.id === c.id);
    if (!s || !s.editable || s.text !== c.original || ids.has(c.id))
      throw new Error("An edit targets protected or mismatched source text.");
    ids.add(c.id);
    if (c.replacement.trim() === s.text.trim())
      throw new Error("An edit must make a meaningful text change.");
    if (
      !c.replacement.trim() ||
      c.replacement.length > Math.max(s.text.length * 1.12, s.text.length + 8)
    )
      throw new Error("An edit exceeds its original text budget.");
    const nums = (s: string) => s.match(/\d+(?:[.,]\d+)?%?/g) || [];
    if (JSON.stringify(nums(s.text)) !== JSON.stringify(nums(c.replacement)))
      throw new Error("An edit changes a date or numerical claim.");
    const summary = /^(?:professional summary|summary|profile)$/i.test(s.section);
    const skillsSection = isSkillsSection(s.section);
    const support = skillsSection
      ? segments.filter((source) => /experience|employment|project/i.test(source.section))
      : summary
        ? segments.filter((source) => isSkillsSection(source.section) ||
            /experience|employment|project/i.test(source.section))
        : [];
    for (const skill of skills)
      if (
        contains(c.replacement, skill) &&
        !contains(s.text, skill) &&
        !(s.sourceLine && contains(s.sourceLine, skill)) &&
        !support.some((source) => contains(source.text, skill)) &&
        !confirmedEvidence.some((entry) => entry.term === skill &&
          (summary || skillsSection || (
            entry.targetId === s.id && /experience|employment|projects?/i.test(s.section)
          )))
      )
        throw new Error(
          `An edit introduces ${skill} without supporting resume text.`,
        );
    if (!c.evidence || !s.text.includes(c.evidence))
      throw new Error("An edit lacks an exact supporting source excerpt.");
    if (c.replacement.includes("\n"))
      throw new Error("An edit introduces new paragraph breaks.");
  }
}
