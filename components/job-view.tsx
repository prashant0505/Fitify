"use client";
import { useState, useRef } from "react";
import {
  Sparkles,
  Download,
  ShieldCheck,
  FileText,
  Check,
  Circle,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
  Maximize,
  AlertTriangle,
  ChevronLeft,
  ChevronRight,
  ListChecks,
  Layers,
  Highlighter,
} from "lucide-react";
import { Badge, Button, Spinner, CheckLine } from "./ui";
import PdfPreview from "./pdf-preview";
import { STAGES, type Job } from "@/lib/types";
import { tailoredCoverage } from "@/lib/analysis";
import { assessAlignment, TARGET_ALIGNMENT } from "@/lib/requirements";
import { RequirementsChecklist } from "./requirements-checklist";
export default function JobView({
  job,
  onAction,
  onBack,
  aiReady,
  engineReady,
}: {
  job: Job;
  onAction: (action: string) => void;
  onBack: () => void;
  aiReady: boolean;
  engineReady: boolean;
}) {
  const [tab, setTab] = useState("analysis"),
    [zoom, setZoom] = useState(100),
    [page, setPage] = useState(1),
    [original, setOriginal] = useState(false),
    [reviewed, setReviewed] = useState(false),
    [showChanges, setShowChanges] = useState(true);
  const preview = useRef<HTMLDivElement>(null);
  const analysis = job.analysis,
    ready = job.status === "ready",
    processing = job.status === "processing";
  const tailored = ready && job.validation?.passed && analysis && job.segments && job.changes?.length
    ? tailoredCoverage(analysis.required, job.segments, job.changes)
    : undefined;
  const coverage = tailored ?? analysis;
  const baseline = assessAlignment(job.requirements ?? [], job.segments ?? []);
  const alignment = tailored
    ? assessAlignment(job.requirements ?? [], job.segments ?? [], job.changes)
    : baseline;
  const mustHaveGaps = alignment.gaps.filter((item) => item.priority === "Must-have").length;
  const noEditablePdf = (job.pdfEngineVersion ?? 0) >= 3 && job.editable === false;
  const fileUrl = (type: string) => `/api/jobs/${job.id}/download?type=${type}`;
  return (
    <>
      <div className="page-heading">
        <div>
          <button className="text-button" onClick={onBack}>
            <ChevronLeft size={15} /> Back to workspace
          </button>
          <h1>
            {ready
              ? "A sharper version of you."
              : processing
                ? "Good things take precision."
                : "Your next opportunity, decoded."}
          </h1>
          <p>
            {job.name} <span className="separator">/</span> {job.role}
          </p>
        </div>
        <Badge
          tone={ready ? "green" : job.status === "error" ? "amber" : "purple"}
        >
          {ready ? (
            <>
              <ShieldCheck size={14} /> Validated
            </>
          ) : job.status === "analyzed" ? (
            "Analysis complete"
          ) : job.status === "error" ? (
            "Needs attention"
          ) : job.status === "cancelled" ? (
            "Cancelled"
          ) : (
            "In progress"
          )}
        </Badge>
      </div>
      {job.format === "pdf" && analysis && !processing && (
        <section className="notice">
          <FileText size={20} />
          <div>
            <strong>PDF tailoring</strong>
            <p>
              {(job.pdfEngineVersion ?? 0) >= 2
                ? job.notice
                : "Editable PDF regions will be checked when tailoring starts. The original PDF remains untouched."}
            </p>
          </div>
        </section>
      )}
      {processing && (
        <section className="processing card">
          <div className="processing-orb">
            <Sparkles size={30} />
          </div>
          <div className="processing-main">
            <div className="row between">
              <h2>{STAGES[Math.min(job.stage, 7)]}</h2>
              <span className="muted">
                Stage {Math.min(job.stage + 1, 8)} of 8
              </span>
            </div>
            <p>
              Your original stays untouched. Each stage reflects a completed
              server operation.
            </p>
            <div className="progress-track">
              <div style={{ width: `${(job.stage / 8) * 100}%` }} />
            </div>
            <div className="stages">
              {STAGES.map((s, i) => (
                <span
                  className={
                    i < job.stage ? "done" : i === job.stage ? "active" : ""
                  }
                  key={s}
                  title={s}
                >
                  {i < job.stage ? (
                    <Check size={13} />
                  ) : i === job.stage ? (
                    <Spinner />
                  ) : (
                    <Circle size={11} />
                  )}
                  <span>{s}</span>
                </span>
              ))}
            </div>
          </div>
          <button
            className="icon-button"
            aria-label="Cancel processing"
            onClick={() => onAction("cancel")}
          >
            <X size={18} />
          </button>
        </section>
      )}
      {job.error && (
        <div className="error-box">
          <AlertTriangle size={20} />
          <div>
            <strong>We paused to protect your resume.</strong>
            <p>{job.error}</p>
            <Button kind="secondary" onClick={() => onAction("retry")}>
              <RotateCcw size={15} /> Retry saved document
            </Button>
          </div>
        </div>
      )}
      {job.status === "cancelled" && (
        <div className="notice">
          <span>
            Processing cancelled. Your original and completed stages are saved.
          </span>
          <Button kind="secondary" onClick={() => onAction("retry")}>
            Resume processing
          </Button>
        </div>
      )}
      {analysis && coverage && (
        <>
          <div className="result-summary">
            <section className="card score-card">
              <div
                className="score-ring"
                style={
                  {
                    "--score": `${(alignment.score ?? 0) * 3.6}deg`,
                  } as React.CSSProperties
                }
              >
                <div>
                  <strong>
                    {alignment.score ?? "—"}
                  </strong>
                  <span>
                    {alignment.score !== null
                      ? "out of 100"
                      : "no recognized terms"}
                  </span>
                </div>
              </div>
              <div>
                <Badge tone="purple">JOB REQUIREMENT COVERAGE</Badge>
                <h2>
                  {tailored ? "Tailored resume" : "Original resume"}
                </h2>
                <p>
                  {alignment.items.length - alignment.gaps.length} of {alignment.items.length} recognized requirement groups covered.
                </p>
                {mustHaveGaps > 0 && <p>{mustHaveGaps} must-have {mustHaveGaps === 1 ? "gap" : "gaps"}.</p>}
                {tailored && baseline.score !== null && (
                  <p>Original coverage {baseline.score}/100</p>
                )}
                {alignment.score !== null && <small>Coverage target {TARGET_ALIGNMENT}/100 · Keyword coverage {coverage.score}/100</small>}
              </div>
            </section>
            <section className="card target-card">
              <span className="eyebrow">THE OPPORTUNITY</span>
              <h2>{analysis.title}</h2>
              <p>{analysis.company || "Company not specified"}</p>
              <div className="target-foot">
                <span>Experience expectation</span>
                <strong>{analysis.experience}</strong>
              </div>
            </section>
          </div>
          <div className="tabs" role="tablist">
            {[
              { id: "analysis", label: "Alignment overview", icon: ListChecks },
              {
                id: "changes",
                label: `Content changes${job.changes ? ` · ${job.changes.length}` : ""}`,
                icon: Layers,
              },
              { id: "preview", label: "Document preview", icon: FileText },
            ].map((t) => (
              <button
                key={t.id}
                role="tab"
                aria-selected={tab === t.id}
                onClick={() => setTab(t.id)}
                className={tab === t.id ? "selected" : ""}
              >
                <t.icon size={16} />
                {t.label}
              </button>
            ))}
          </div>
          {tab === "analysis" && (
            <div className="analysis-grid">
              <RequirementsChecklist job={job} />
              <section className="card">
                <div className="row between">
                  <h3>Skills that connect</h3>
                  <Badge tone="green">{coverage.matched.length} matched</Badge>
                </div>
                <p>Recognized terms in the {tailored ? "tailored" : "original"} resume.</p>
                <div className="chips">
                  {coverage.matched.length ? (
                    coverage.matched.map((s) => (
                      <Badge key={s} tone="green">
                        <Check size={12} />
                        {s}
                      </Badge>
                    ))
                  ) : (
                    <span className="muted">
                      No recognized JD terms found in the resume.
                    </span>
                  )}
                </div>
                <div className="divider" />
                <h3>Your strengths</h3>
                {analysis.strengths.map((s) => (
                  <CheckLine key={s}>{s}</CheckLine>
                ))}
              </section>
              <section className="card">
                <div className="row between">
                  <h3>Gaps to be aware of</h3>
                  <Badge tone="amber">{alignment.gaps.length} missing</Badge>
                </div>
                <p>
                  Requirements still missing from the current resume.
                </p>
                <div className="chips">
                  {alignment.gaps.length ? (
                    alignment.gaps.map((gap) => (
                      <Badge key={gap.id} tone="amber">
                        {gap.terms.join(" or ")}
                      </Badge>
                    ))
                  ) : (
                    <span className="muted">
                      All recognized requirement groups are covered.
                    </span>
                  )}
                </div>
                <div className="divider" />
                <h3>Recommended improvements</h3>
                {analysis.improvements.map((s, i) => (
                  <div key={s} className="recommendation">
                    <span>{i + 1}</span>
                    <p>{s}</p>
                  </div>
                ))}
              </section>
              <section className="card full">
                <div className="row">
                  <ShieldCheck size={21} className="violet" />
                  <div>
                    <h3>Your experience is the source of truth.</h3>
                    <p>
                      Names, dates, qualifications, metrics, and unsupported
                      skills are protected. Automated checks support your
                      review; they do not replace it.
                    </p>
                  </div>
                </div>
              </section>
            </div>
          )}
          {tab === "changes" && (
            <section className="card changes">
              <div className="row between">
                <div>
                  <h2>Thoughtful edits. Full transparency.</h2>
                  <p>Review each rewrite against its original source.</p>
                </div>
                <Badge tone="purple">{job.changes?.length || 0} edits</Badge>
              </div>
              {job.changes?.length ? (
                job.changes.map((c) => (
                  <article className="change" key={c.id}>
                    <div className="change-columns">
                      <div>
                        <span className="eyebrow">ORIGINAL</span>
                        <p>{c.original}</p>
                      </div>
                      <div>
                        <span className="eyebrow violet">TAILORED</span>
                        <p>{c.replacement}</p>
                      </div>
                    </div>
                    <div className="change-reason">
                      <Sparkles size={14} />
                      {c.reason}
                    </div>
                    <details>
                      <summary>View source evidence</summary>
                      <blockquote>{c.evidence}</blockquote>
                    </details>
                  </article>
                ))
              ) : (
                <div className="empty-state">
                  <Layers size={36} />
                  <h3>Your edits will appear here.</h3>
                  <p>
                    Finish the analysis, then start tailoring to compare
                    supported changes.
                  </p>
                </div>
              )}
            </section>
          )}
          {tab === "preview" && (
            <section className="card preview-card" ref={preview}>
              <div className="preview-toolbar">
                <div className="toggle">
                  <button
                    className={!original ? "on" : ""}
                    onClick={() => setOriginal(false)}
                  >
                    Tailored
                  </button>
                  <button
                    className={original ? "on" : ""}
                    onClick={() => setOriginal(true)}
                  >
                    Original
                  </button>
                </div>
                <div className="row">
                  <button
                    className={`highlight-toggle ${showChanges ? "enabled" : ""}`}
                    aria-pressed={showChanges}
                    disabled={!ready}
                    onClick={() => setShowChanges((v) => !v)}
                  >
                    <Highlighter size={15} /> Show changes
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Previous page"
                    disabled={page <= 1}
                    onClick={() => setPage((v) => v - 1)}
                  >
                    <ChevronLeft size={17} />
                  </button>
                  <span>
                    {page} / {job.validation?.pagesTailored || "—"}
                  </span>
                  <button
                    className="icon-button"
                    aria-label="Next page"
                    disabled={page >= (job.validation?.pagesTailored || 1)}
                    onClick={() => setPage((v) => v + 1)}
                  >
                    <ChevronRight size={17} />
                  </button>
                  <span className="toolbar-divider" />
                  <button
                    className="icon-button"
                    aria-label="Zoom out"
                    disabled={zoom <= 50}
                    onClick={() => setZoom((z) => z - 25)}
                  >
                    <ZoomOut size={17} />
                  </button>
                  <span>{zoom}%</span>
                  <button
                    className="icon-button"
                    aria-label="Zoom in"
                    disabled={zoom >= 175}
                    onClick={() => setZoom((z) => z + 25)}
                  >
                    <ZoomIn size={17} />
                  </button>
                  <button
                    className="icon-button"
                    aria-label="Full screen preview"
                    onClick={() => {
                      if (document.fullscreenElement)
                        void document.exitFullscreen();
                      else void preview.current?.requestFullscreen();
                    }}
                  >
                    <Maximize size={17} />
                  </button>
                </div>
              </div>
              {ready ? (
                <>
                  <div className="preview-legend">
                    <span
                      className={
                        showChanges ? "highlight-swatch" : "clean-swatch"
                      }
                    />
                    <span>
                      {showChanges
                        ? `${job.changes?.length || 0} updated region${job.changes?.length === 1 ? "" : "s"} highlighted${original ? " in the original" : ""}.`
                        : "Clean document preview."}{" "}
                      Highlights are for review; resume downloads stay clean.
                    </span>
                  </div>
                  <PdfPreview
                    key={`${original}-${showChanges}-${page}`}
                    url={`${fileUrl(showChanges ? (original ? "highlighted-original-pdf" : "highlighted-pdf") : original ? "original-pdf" : "pdf")}&preview=1&renderPage=${page}`}
                    zoom={zoom}
                    title={`${original ? "Original" : "Tailored"} document${showChanges ? " with changes highlighted" : ""}`}
                    highlighted={showChanges}
                  />
                </>
              ) : (
                <div className="empty-state">
                  <FileText size={42} />
                  <h3>A preview worth trusting.</h3>
                  <p>
                    The original and tailored PDF previews appear only after the
                    document passes rendering and layout checks.
                  </p>
                </div>
              )}
            </section>
          )}
          {ready && job.validation && (
            <section className="validation card">
              <div>
                <ShieldCheck size={24} className="green-text" />
                <h3>Document validation passed</h3>
              </div>
              <div className="validation-checks">
                {job.validation.checks.map((c) => (
                  <CheckLine key={c}>{c}</CheckLine>
                ))}
              </div>
              {job.validation.warnings.map((w) => (
                <p className="fine-print" key={w}>
                  {w}
                </p>
              ))}
              <label className="review-check">
                <input
                  type="checkbox"
                  checked={reviewed}
                  onChange={(e) => setReviewed(e.target.checked)}
                />{" "}
                I reviewed the content changes and document previews.
              </label>
            </section>
          )}
          <div className="bottom-action">
            <div>
              <ShieldCheck size={19} />
              <span>
                {ready
                  ? "Separate output. Your original remains untouched."
                  : "Original design protected. Every claim grounded in your resume."}
              </span>
            </div>
            {job.status === "analyzed" ? (
              <Button
                onClick={() => onAction("tailor")}
                disabled={
                  !aiReady ||
                  !engineReady ||
                  noEditablePdf
                }
              >
                <Sparkles size={17} />
                {!aiReady
                  ? "Connect AI to start tailoring"
                  : noEditablePdf
                    ? "No editable PDF text regions"
                    : "Tailor my resume"}
              </Button>
            ) : ready ? (
              <div className="row">
                <Button kind="secondary" onClick={() => onAction("retry")}>
                  <RotateCcw size={16} /> Regenerate
                </Button>
                {job.format === "docx" && (
                  <a
                    className={`button secondary ${!reviewed ? "disabled" : ""}`}
                    href={reviewed ? fileUrl("pdf") : undefined}
                    aria-disabled={!reviewed}
                  >
                    <Download size={16} /> PDF
                  </a>
                )}
                <a
                  className={`button primary ${!reviewed ? "disabled" : ""}`}
                  href={reviewed ? fileUrl(job.format) : undefined}
                  aria-disabled={!reviewed}
                >
                  <Download size={16} /> Download {job.format.toUpperCase()}
                </a>
              </div>
            ) : null}
          </div>
        </>
      )}
      {!analysis && !processing && !job.error && (
        <div className="empty-state">
          <FileText size={32} />
          <h3>Your document is saved.</h3>
          <p>Resume processing to see the alignment report.</p>
        </div>
      )}
      <a className="original-download" href={fileUrl("original")}>
        <Download size={14} /> Download untouched original
      </a>
    </>
  );
}
