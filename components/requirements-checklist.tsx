import { requirementEvidence } from "@/lib/requirements";
import type { Job } from "@/lib/types";
import { Badge } from "./ui";

export function RequirementsChecklist({ job }: { job: Job }) {
  const changes = job.status === "ready" && job.validation?.passed ? job.changes ?? [] : [];
  const segments = job.segments ?? [];
  return (
    <section className="card full" aria-label="Job requirements checklist">
      <h3>Job requirements checklist</h3>
      <p>Recognized job requirements and the evidence found automatically in your resume.</p>
      {!job.requirements?.length && <p>No recognized skills were found in this job description.</p>}
      {job.requirements?.map(({ term, priority, description, alternatives }) => {
        const evidence = requirementEvidence(term, segments, changes);
        const alternative = alternatives?.find((option) =>
          option !== term && requirementEvidence(option, segments, changes).mentioned,
        );
        return (
          <article key={term} className="requirement-item">
            <div className="row between">
              <strong>{term}</strong>
              <Badge tone={priority === "Must-have" ? "purple" : "neutral"}>{priority}</Badge>
            </div>
            <p className="muted">{description}</p>
            {evidence.original && <p><strong>Original resume</strong> {evidence.original}</p>}
            {evidence.tailored && <p><strong>Tailored resume</strong> {evidence.tailored}</p>}
            {!evidence.mentioned && <p>{alternative ? `Covered by the listed alternative ${alternative}.` : "Evidence needed."}</p>}
          </article>
        );
      })}
    </section>
  );
}
