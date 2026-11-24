"use client";
import { useEffect, useRef, useState, useCallback } from "react";
import {
  LayoutDashboard,
  FilePlus2,
  History,
  Settings2,
  Search,
  Command,
  Plus,
  Sparkles,
  ShieldCheck,
  FileText,
  Target,
  UploadCloud,
  X,
  Check,
  Clipboard,
  Trash2,
  ChevronRight,
  ChevronDown,
  LockKeyhole,
  Menu,
  Layers,
  CircleHelp,
  CheckCircle2,
  AlertCircle,
  SlidersHorizontal,
  FolderOpen,
} from "lucide-react";
import { Brand, Button, Badge, Modal, Spinner, CheckLine } from "./ui";
import JobView from "./job-view";
import { analyze } from "@/lib/analysis";
import type { Job } from "@/lib/types";

type Config = {
  aiReady: boolean;
  documentReady: boolean;
  user: string;
  retentionDays: number;
};
type View = "dashboard" | "studio" | "history" | "settings";
const exampleJD = `Senior Frontend Engineer\nCompany: Acme\n\nWe are looking for a frontend engineer with 4+ years of experience building accessible web applications. You will develop responsive interfaces using React, TypeScript, and Next.js, collaborate with product and design teams, and improve performance.\n\nRequired: React, TypeScript, JavaScript, HTML, CSS, Git, REST APIs, and testing.\nPreferred: Playwright, GraphQL, and AWS.\n\nResponsibilities: Build reusable components, maintain application quality, and deliver thoughtful user experiences.`;
async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`/api/${path}`, options);
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error(
      "The connection was interrupted. Try again; saved documents are retained.",
    );
  }
  if (!res.ok)
    throw new Error((data as { error?: string }).error || "Request failed.");
  return data as T;
}
export default function Workspace() {
  const [view, setView] = useState<View>("dashboard"),
    [jobs, setJobs] = useState<Job[]>([]),
    [job, setJob] = useState<Job | null>(null),
    [config, setConfig] = useState<Config | null>(null),
    [file, setFile] = useState<File | null>(null),
    [jd, setJD] = useState(""),
    [drag, setDrag] = useState(false),
    [uploading, setUploading] = useState(false),
    [uploaded, setUploaded] = useState<number | null>(null),
    [error, setError] = useState(""),
    [toast, setToast] = useState(""),
    [loading, setLoading] = useState(true),
    [modal, setModal] = useState<"search" | "privacy" | "help" | null>(null),
    [query, setQuery] = useState(""),
    [mobile, setMobile] = useState(false),
    [filter, setFilter] = useState("all"),
    [deleting, setDeleting] = useState<string | null>(null),
    [deleteBusy, setDeleteBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null),
    uploadRequest = useRef<XMLHttpRequest | null>(null),
    idempotency = useRef<string>("");
  const notify = useCallback((s: string) => {
    setToast(s);
  }, []);
  const refresh = useCallback(async () => {
    try {
      const [j, c] = await Promise.all([
        api<Job[]>("jobs"),
        api<Config>("config"),
      ]);
      setJobs(j);
      setConfig(c);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);
  // Initial network hydration; state updates occur after the fetch promises settle.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Initial asynchronous network hydration.
    void refresh();
  }, [refresh]);
  useEffect(() => {
    if (toast) {
      const t = setTimeout(() => setToast(""), 4500);
      return () => clearTimeout(t);
    }
  }, [toast]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setModal((m) => (m === "search" ? null : "search"));
      }
      if (e.key === "Escape") {
        setModal(null);
        setDeleting(null);
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  useEffect(() => {
    if (job?.status !== "processing") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        const next = await api<Job & { busy?: boolean }>(
          `jobs/${job.id}/advance`,
          { method: "POST" },
        );
        if (stopped) return;
        setJob(next);
        if (next.status === "processing")
          timer = setTimeout(tick, next.busy ? 1600 : 200);
        else void refresh();
      } catch (e) {
        if (!stopped) {
          setError((e as Error).message);
          notify(
            "Connection interrupted. Reopen the saved resume to continue.",
          );
        }
      }
    };
    void tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [job?.id, job?.status, refresh, notify]);
  useEffect(() => () => uploadRequest.current?.abort(), []);
  function navigate(next: View) {
    setView(next);
    setJob(null);
    setError("");
    setMobile(false);
  }
  async function openJob(id: string) {
    try {
      setJob(await api<Job>(`jobs/${id}`));
      setModal(null);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  function selectFile(next: File | undefined) {
    if (!next) return;
    const ext = next.name.split(".").pop()?.toLowerCase();
    if (!["pdf", "docx"].includes(ext || "")) {
      setError("Choose a PDF or DOCX file. Other formats are not supported.");
      return;
    }
    if (!next.size || next.size > 5 * 1024 * 1024) {
      setError("Choose a non-empty document smaller than 5 MiB.");
      return;
    }
    setFile(next);
    setUploaded(null);
    setError("");
    idempotency.current = "";
  }
  async function upload() {
    if (!file) {
      setError("Upload your existing resume first.");
      return;
    }
    if (jd.trim().length < 100) {
      setError("Add a job description of at least 100 characters.");
      return;
    }
    if (jd.length > 30000) {
      setError("Keep the job description under 30,000 characters.");
      return;
    }
    setUploading(true);
    setError("");
    setUploaded(0);
    idempotency.current ||= crypto.randomUUID();
    const form = new FormData();
    form.append("file", file);
    form.append("jd", jd);
    const xhr = new XMLHttpRequest();
    uploadRequest.current = xhr;
    xhr.open("POST", "/api/jobs");
    xhr.setRequestHeader("Idempotency-Key", idempotency.current);
    xhr.timeout = 90000;
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable)
        setUploaded(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () => {
      setUploading(false);
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 400) throw new Error(data.error || "Upload failed.");
        setJob(data);
        void refresh();
        notify("Original securely saved. Analysis started.");
      } catch (e) {
        setError((e as Error).message);
      }
    };
    xhr.onerror = () => {
      setUploading(false);
      setError(
        "Upload connection failed. Retry to safely resume this request.",
      );
    };
    xhr.ontimeout = () => {
      setUploading(false);
      setError("Upload timed out. Retry using the same document.");
    };
    xhr.onabort = () => {
      setUploading(false);
      setUploaded(null);
      notify("Upload cancelled.");
    };
    xhr.send(form);
  }
  async function action(a: string) {
    if (!job) return;
    try {
      const next = await api<Job>(`jobs/${job.id}/${a}`, { method: "POST" });
      setJob({ ...job, ...next });
      setError("");
      void refresh();
    } catch (e) {
      setError((e as Error).message);
    }
  }
  async function deleteJob(id: string) {
    setDeleteBusy(true);
    try {
      await api(`jobs/${id}`, { method: "DELETE" });
      setDeleting(null);
      if (job?.id === id) setJob(null);
      await refresh();
      notify("Resume, job description, and generated files deleted.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setDeleteBusy(false);
    }
  }
  const processed = jobs.filter((j) => j.stage >= 3).length,
    tailored = jobs.filter((j) => j.status === "ready").length,
    scored = jobs.filter((j) => j.score !== null);
  const average = scored.length
    ? Math.round(scored.reduce((a, j) => a + (j.score || 0), 0) / scored.length)
    : null;
  const nav = [
    { id: "dashboard" as View, label: "Overview", icon: LayoutDashboard },
    { id: "studio" as View, label: "Tailor resume", icon: FilePlus2 },
    { id: "history" as View, label: "My resumes", icon: History },
  ];
  const visible = jobs.filter(
    (j) =>
      (filter === "all" || j.status === filter) &&
      `${j.name} ${j.role} ${j.company}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const detected = jd.trim().length >= 100 ? analyze("", jd) : null;
  function historyTable(rows: Job[]) {
    return rows.length ? (
      <div className="history-table">
        <div className="table-head">
          <span>RESUME / OPPORTUNITY</span>
          <span>ALIGNMENT</span>
          <span>STATUS</span>
          <span>CREATED</span>
          <span />
        </div>
        {rows.map((j) => (
          <div className="table-row" key={j.id}>
            <button className="resume-cell" onClick={() => void openJob(j.id)}>
              <span className="file-icon">
                <FileText size={19} />
                <small>{j.format.toUpperCase()}</small>
              </span>
              <span>
                <strong>{j.role === "Untitled role" ? j.name : j.role}</strong>
                <small>
                  {j.company ? `${j.company} · ` : ""}
                  {j.name}
                </small>
              </span>
            </button>
            <span className="score-cell">
              {j.score !== null ? (
                <>
                  <strong>{j.score}%</strong>
                  <span className="mini-track">
                    <i style={{ width: `${j.score}%` }} />
                  </span>
                </>
              ) : (
                <span className="muted">—</span>
              )}
            </span>
            <span>
              <Badge
                tone={
                  j.status === "ready"
                    ? "green"
                    : j.status === "error"
                      ? "amber"
                      : j.status === "processing"
                        ? "purple"
                        : "neutral"
                }
              >
                {j.status === "ready"
                  ? "Tailored"
                  : j.status === "analyzed"
                    ? "Analyzed"
                    : j.status === "error"
                      ? "Needs attention"
                      : j.status === "processing"
                        ? "Processing"
                        : "Cancelled"}
              </Badge>
            </span>
            <span className="table-date">
              {new Date(j.createdAt).toLocaleDateString("en-IN", {
                day: "numeric",
                month: "short",
              })}
            </span>
            <button
              aria-label={`Delete ${j.name}`}
              className="icon-button delete-button"
              onClick={() => setDeleting(j.id)}
            >
              <Trash2 size={16} />
            </button>
          </div>
        ))}
      </div>
    ) : (
      <div className="history-empty">
        <span className="empty-icon">
          <FolderOpen size={27} />
        </span>
        <h3>
          {query || filter !== "all"
            ? "No matching resumes."
            : "Your next chapter starts here."}
        </h3>
        <p>
          {query || filter !== "all"
            ? "Try another search or filter."
            : "Your tailored resumes will appear here, ready for the right opportunity."}
        </p>
        {!query && filter === "all" && (
          <button
            className="text-button violet"
            onClick={() => navigate("studio")}
          >
            <Plus size={16} /> Tailor your first resume
          </button>
        )}
      </div>
    );
  }
  return (
    <div className="app-shell" inert={loading} aria-busy={loading}>
      <aside className={`sidebar ${mobile ? "mobile-open" : ""}`}>
        <div className="sidebar-top">
          <Brand />
          <button
            className="mobile-only icon-button"
            aria-label="Close navigation"
            onClick={() => setMobile(false)}
          >
            <X size={20} />
          </button>
        </div>
        <button
          className="workspace-picker"
          onClick={() => setModal("privacy")}
        >
          <Layers size={16} />
          <span>Personal workspace</span>
          <ChevronDown size={14} />
        </button>
        <span className="nav-label">WORKSPACE</span>
        <nav>
          {nav.map((n) => (
            <button
              key={n.id}
              className={view === n.id && !job ? "nav-item active" : "nav-item"}
              onClick={() => navigate(n.id)}
            >
              <n.icon size={18} />
              <span className="nav-item-label">{n.label}</span>
              {n.id === "studio" && <Plus size={15} className="nav-end" />}
              {n.id === "history" && jobs.length > 0 && (
                <span className="nav-count">{jobs.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <span className="nav-label support-label">SUPPORT</span>
          <button
            className={view === "settings" ? "nav-item active" : "nav-item"}
            onClick={() => navigate("settings")}
          >
            <Settings2 size={18} /> Settings
          </button>
          <button className="nav-item" onClick={() => setModal("help")}>
            <CircleHelp size={18} /> Help & guidance
          </button>
          <button
            className="sidebar-assurance"
            onClick={() => setModal("privacy")}
          >
            <LockKeyhole size={13} />
            <span>Private by design</span>
          </button>
          <div className="profile">
            <div className="profile-avatar">
              {(config?.user || "You").slice(0, 1).toUpperCase()}
            </div>
            <div>
              <strong>
                {config?.user?.includes("@")
                  ? config.user.split("@")[0]
                  : config?.user || "Your workspace"}
              </strong>
              <small>Personal account</small>
            </div>
            <button
              className="icon-button"
              aria-label="View account privacy"
              onClick={() => setModal("privacy")}
            >
              <ChevronDown size={15} />
            </button>
          </div>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="row">
            <button
              className="icon-button mobile-only"
              aria-label="Open navigation"
              onClick={() => setMobile(true)}
            >
              <Menu size={20} />
            </button>
            <span className="breadcrumb">Workspace</span>
            <ChevronRight size={14} />
            <strong>
              {job
                ? "Resume workspace"
                : view === "dashboard"
                  ? "Overview"
                  : view === "studio"
                    ? "Tailor resume"
                    : view === "history"
                      ? "My resumes"
                      : "Settings"}
            </strong>
          </div>
          <div className="row topbar-actions">
            <button
              className="search-button"
              onClick={() => {
                setQuery("");
                setModal("search");
              }}
            >
              <Search size={15} />
              <span>Quick search</span>
              <kbd>
                <Command size={11} /> K
              </kbd>
            </button>
            <span className="topbar-line" />
            <span className="private-label">
              <LockKeyhole size={13} /> Private workspace
            </span>
          </div>
        </header>
        <main>
          {error && (
            <div className="global-error" role="alert">
              <AlertCircle size={18} />
              <span>
                {error}{" "}
                {error.includes("Sign in") && (
                  <a href="/signin-with-chatgpt?return_to=%2F" target="_top">
                    Sign in with ChatGPT
                  </a>
                )}
              </span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {job ? (
            <JobView
              key={job.id}
              job={job}
              onAction={(a) => void action(a)}
              onBack={() => {
                setJob(null);
                void refresh();
              }}
              aiReady={!!config?.aiReady}
              engineReady={!!config?.documentReady}
            />
          ) : (
            <>
              {view === "dashboard" && (
                <>
                  <div className="page-heading">
                    <div>
                      <span className="eyebrow">YOUR CAREER WORKSPACE</span>
                      <h1>Good experience deserves a great match.</h1>
                      <p>
                        A considered next step. A stronger first impression.
                      </p>
                    </div>
                    <Button kind="secondary" onClick={() => navigate("studio")}>
                      <Plus size={16} /> New resume
                    </Button>
                  </div>
                  <section className="hero">
                    <div className="hero-copy">
                      <Badge tone="purple">
                        <Sparkles size={13} /> THE RESUME TAILORING STUDIO
                      </Badge>
                      <h2>
                        Made for your
                        <br />
                        <em>next big move.</em>
                      </h2>
                      <p>
                        Turn your real experience into a resume that speaks to
                        the role. Same design. A more compelling story.
                      </p>
                      <Button onClick={() => navigate("studio")}>
                        <Sparkles size={17} /> Tailor my resume
                      </Button>
                      <div className="hero-proof">
                        <span>
                          <ShieldCheck size={14} /> Original design preserved
                        </span>
                        <span>
                          <Check size={14} /> No invented experience
                        </span>
                      </div>
                    </div>
                    <div className="hero-art" aria-hidden="true">
                      <div className="art-label">
                        <span>THE ART OF A BETTER FIT</span>
                        <Plus size={16} />
                      </div>
                      <div className="orbit orbit-one" />
                      <div className="orbit orbit-two" />
                      <div className="art-spark spark-one">✦</div>
                      <div className="art-spark spark-two">✧</div>
                      <div className="floating-tag tag-top">
                        <span className="tiny-icon">
                          <Layers size={14} />
                        </span>
                        Your layout, protected
                        <Check size={13} />
                      </div>
                      <div className="document-back" />
                      <div className="art-document">
                        <div className="doc-top">
                          <div className="doc-avatar">A</div>
                          <div>
                            <b>ALEX MORGAN</b>
                            <span>Product Engineer</span>
                          </div>
                          <span className="doc-monogram">AM.</span>
                        </div>
                        <div className="doc-rule" />
                        <span className="doc-heading">PROFILE</span>
                        <div className="doc-lines">
                          <i />
                          <i />
                          <i />
                        </div>
                        <span className="doc-heading">EXPERIENCE</span>
                        <div className="doc-job">
                          <b>Product Engineer</b>
                          <span>2022 — Present</span>
                        </div>
                        <div className="doc-lines">
                          <i />
                          <i className="highlight-line" />
                          <i />
                          <i />
                        </div>
                        <span className="doc-heading">SELECTED SKILLS</span>
                        <div className="doc-skill-row">
                          <i>React</i>
                          <i>TypeScript</i>
                          <i>Systems</i>
                        </div>
                        <div className="scan-line" />
                      </div>
                      <div className="floating-tag tag-bottom">
                        <span className="tag-spark">
                          <Sparkles size={17} />
                        </span>
                        <span>
                          Thoughtfully tailored
                          <small>Only what’s true to you.</small>
                        </span>
                        <ShieldCheck size={19} />
                      </div>
                      <span className="art-caption">ILLUSTRATIVE DOCUMENT</span>
                    </div>
                  </section>
                  <div className="dashboard-section-heading">
                    <div>
                      <span className="eyebrow">ACTIVITY</span>
                      <h2>Your workspace, at a glance.</h2>
                    </div>
                    <span className="section-caption">
                      Real work. Real progress.
                    </span>
                  </div>
                  <div className="stats-grid">
                    <Stat
                      icon={FileText}
                      label="Resumes analyzed"
                      value={loading ? "…" : String(processed)}
                      detail="Your original experience, understood"
                    />
                    <Stat
                      icon={Sparkles}
                      label="Resumes tailored"
                      value={loading ? "…" : String(tailored)}
                      detail="Ready for the next opportunity"
                    />
                    <Stat
                      icon={Target}
                      label="Average alignment"
                      value={
                        loading ? "…" : average === null ? "—" : `${average}%`
                      }
                      detail="Indicative keyword coverage"
                    />
                  </div>
                  <div className="dashboard-lower">
                    <section className="history-section card">
                      <div className="section-heading">
                        <div className="row">
                          <div>
                            <span className="eyebrow">YOUR LIBRARY</span>
                            <h2>Recent resumes</h2>
                          </div>
                          <Badge>{jobs.length}</Badge>
                        </div>
                        <button
                          className="text-button"
                          onClick={() => {
                            setQuery("");
                            setFilter("all");
                            navigate("history");
                          }}
                        >
                          View all <ChevronRight size={15} />
                        </button>
                      </div>
                      {loading ? (
                        <div className="skeleton-rows">
                          <i />
                          <i />
                          <i />
                        </div>
                      ) : (
                        historyTable(jobs.slice(0, 4))
                      )}
                    </section>
                    <aside className="workflow-guide card">
                      <div className="guide-heading">
                        <span className="eyebrow">A THOUGHTFUL PROCESS</span>
                        <ShieldCheck size={22} />
                      </div>
                      <h2>
                        Better fit.
                        <br />
                        Same you.
                      </h2>
                      <p>
                        Analyze your fit. Refine your content. Review every
                        detail.
                      </p>

                      <Button
                        kind="secondary"
                        onClick={() => navigate("studio")}
                      >
                        Open the studio <FilePlus2 size={16} />
                      </Button>
                    </aside>
                  </div>
                  <div className="principles">
                    <span>
                      <ShieldCheck size={17} /> Your document, your design
                    </span>
                    <span>
                      <LockKeyhole size={17} /> Private files, secure access
                    </span>
                    <span>
                      <CheckCircle2 size={17} /> Truth over keywords. Always.
                    </span>
                  </div>
                </>
              )}
              {view === "studio" && (
                <>
                  <div className="page-heading">
                    <div>
                      <span className="eyebrow">THE TAILORING STUDIO</span>
                      <h1>Bring your resume. Find your fit.</h1>
                      <p>Two inputs. One carefully considered next step.</p>
                    </div>
                    <Badge>
                      <ShieldCheck size={14} /> Original stays untouched
                    </Badge>
                  </div>
                  <div className="workflow-steps">
                    <span className="current">
                      <i>1</i> Add your documents
                    </span>
                    <span />
                    <span>
                      <i>2</i> Understand the fit
                    </span>
                    <span />
                    <span>
                      <i>3</i> Tailor & review
                    </span>
                  </div>
                  {!config?.documentReady && !loading && (
                    <div className="notice">
                      <Settings2 size={20} />
                      <div>
                        <strong>Document engine setup required</strong>
                        <p>
                          Your file can be saved securely. Analysis and
                          validated output require the private document service.
                        </p>
                      </div>
                      <button
                        className="text-button"
                        onClick={() => navigate("settings")}
                      >
                        View setup
                      </button>
                    </div>
                  )}
                  <div className="studio-grid">
                    <section className="card upload-card">
                      <div className="card-step">
                        <span>01</span>
                        <div>
                          <h2>Your original resume</h2>
                          <p>Keep the design. Elevate the content.</p>
                        </div>
                      </div>
                      <input
                        ref={input}
                        type="file"
                        accept=".pdf,.docx"
                        aria-label="Upload resume"
                        hidden
                        disabled={uploading}
                        onChange={(e) => selectFile(e.target.files?.[0])}
                      />
                      <div
                        className={`dropzone ${drag ? "dragging" : ""} ${file ? "has-file" : ""}`}
                        onDragOver={(e) => {
                          e.preventDefault();
                          setDrag(true);
                        }}
                        onDragLeave={() => setDrag(false)}
                        onDrop={(e) => {
                          e.preventDefault();
                          setDrag(false);
                          if (!uploading) selectFile(e.dataTransfer.files[0]);
                        }}
                      >
                        {file ? (
                          <>
                            <span className="uploaded-icon">
                              <FileText size={34} />
                              <i>
                                <Check size={11} />
                              </i>
                            </span>
                            <h3>{file.name}</h3>
                            <p>
                              {(file.size / 1024).toFixed(1)} KB ·{" "}
                              {file.name.split(".").pop()?.toUpperCase()}
                            </p>
                            <Badge tone="green">Ready to analyze</Badge>
                            <div className="row">
                              <Button
                                kind="secondary"
                                disabled={uploading}
                                onClick={() => input.current?.click()}
                              >
                                Replace file
                              </Button>
                              <button
                                disabled={uploading}
                                className="icon-button"
                                aria-label="Remove resume"
                                onClick={() => {
                                  setFile(null);
                                  idempotency.current = "";
                                  if (input.current) input.current.value = "";
                                }}
                              >
                                <Trash2 size={17} />
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <span className="upload-icon">
                              <UploadCloud size={31} />
                            </span>
                            <h3>Drop your resume here</h3>
                            <p>or choose a file from your device</p>
                            <Button
                              kind="secondary"
                              onClick={() => input.current?.click()}
                            >
                              Browse files
                            </Button>
                            <small>PDF or DOCX · Up to 5 MiB</small>
                          </>
                        )}
                      </div>
                      {uploading && (
                        <div className="upload-progress">
                          <span>
                            {uploaded === 100
                              ? "Upload sent. Saving securely…"
                              : `Uploading · ${uploaded || 0}%`}
                          </span>
                          <div className="progress-track">
                            <div style={{ width: `${uploaded || 0}%` }} />
                          </div>
                          <button
                            className="text-button"
                            onClick={() => uploadRequest.current?.abort()}
                          >
                            Cancel upload
                          </button>
                        </div>
                      )}
                      <div className="upload-guidance">
                        <ShieldCheck size={20} />
                        <div>
                          <strong>Your layout matters.</strong>
                          <p>
                            PDF and DOCX tailoring are supported. PDF edits
                            reuse original fonts and text positions; unsupported
                            regions stay unchanged.
                          </p>
                        </div>
                      </div>
                      <div className="file-protection">
                        <CheckLine>
                          Original file is never overwritten
                        </CheckLine>
                        <CheckLine>
                          Mixed-format text remains protected
                        </CheckLine>
                        <CheckLine>
                          Downloads require document validation
                        </CheckLine>
                      </div>
                    </section>
                    <section className="card jd-card">
                      <div className="card-step">
                        <span>02</span>
                        <div>
                          <h2>The opportunity</h2>
                          <p>Paste the role you have in mind.</p>
                        </div>
                        <div className="jd-tools">
                          <button
                            className="icon-button"
                            aria-label="Paste job description"
                            disabled={uploading}
                            onClick={async () => {
                              try {
                                setJD(
                                  (await navigator.clipboard.readText()).slice(
                                    0,
                                    30000,
                                  ),
                                );
                                idempotency.current = "";
                                notify("Job description pasted.");
                              } catch {
                                notify(
                                  "Clipboard access unavailable. Paste into the editor with your keyboard.",
                                );
                              }
                            }}
                          >
                            <Clipboard size={17} />
                          </button>
                          <button
                            className="icon-button"
                            aria-label="Clear job description"
                            disabled={uploading || !jd}
                            onClick={() => {
                              setJD("");
                              idempotency.current = "";
                            }}
                          >
                            <Trash2 size={17} />
                          </button>
                        </div>
                      </div>
                      <textarea
                        className="jd-editor"
                        aria-label="Job description"
                        maxLength={30000}
                        disabled={uploading}
                        value={jd}
                        onChange={(e) => {
                          setJD(e.target.value);
                          idempotency.current = "";
                        }}
                        placeholder={
                          "Job title, company, and the full description…\n\nInclude responsibilities, required skills, and qualifications for a more useful analysis."
                        }
                      />
                      <div className="editor-foot">
                        <button
                          className="text-button"
                          disabled={uploading}
                          onClick={() => {
                            setJD(exampleJD);
                            idempotency.current = "";
                            notify(
                              "Example job description loaded. Replace it with your target role.",
                            );
                          }}
                        >
                          Try an example JD
                        </button>
                        <span>{jd.length.toLocaleString()} / 30,000</span>
                      </div>
                      {detected && (
                        <div className="detected">
                          <span className="eyebrow">
                            DETECTED FROM YOUR DESCRIPTION
                          </span>
                          <div className="detected-role">
                            <strong>{detected.title}</strong>
                            <span>
                              {detected.company || "Company not specified"} ·{" "}
                              {detected.experience}
                            </span>
                          </div>
                          <div className="chips">
                            {detected.required.slice(0, 8).map((s) => (
                              <Badge key={s}>{s}</Badge>
                            ))}
                          </div>
                          <small>
                            Edit the description above to correct detected
                            information.
                          </small>
                        </div>
                      )}
                    </section>
                  </div>
                  <div className="bottom-action">
                    <div>
                      <LockKeyhole size={17} />
                      <span>
                        Private to your account. Automatically expires after 7
                        days.
                      </span>
                    </div>
                    <Button
                      disabled={uploading || !file || jd.trim().length < 100}
                      onClick={() => void upload()}
                    >
                      {uploading ? <Spinner /> : <Sparkles size={17} />}{" "}
                      {uploading ? "Saving your resume…" : "Analyze my resume"}
                    </Button>
                  </div>
                </>
              )}
              {view === "history" && (
                <>
                  <div className="page-heading">
                    <div>
                      <span className="eyebrow">YOUR WORK, IN ONE PLACE</span>
                      <h1>Every opportunity has a version.</h1>
                      <p>
                        Pick up where you left off. Review, retry, or download
                        your work.
                      </p>
                    </div>
                    <Button onClick={() => navigate("studio")}>
                      <Plus size={16} /> New resume
                    </Button>
                  </div>
                  <section className="card history-section">
                    <div className="history-tools">
                      <label className="history-search">
                        <Search size={17} />
                        <input
                          aria-label="Search saved resumes"
                          placeholder="Search resumes or roles…"
                          value={query}
                          onChange={(e) => setQuery(e.target.value)}
                        />
                      </label>
                      <div className="filter">
                        <SlidersHorizontal size={15} />
                        <select
                          aria-label="Filter by status"
                          value={filter}
                          onChange={(e) => setFilter(e.target.value)}
                        >
                          <option value="all">All statuses</option>
                          <option value="ready">Tailored</option>
                          <option value="analyzed">Analyzed</option>
                          <option value="processing">Processing</option>
                          <option value="error">Needs attention</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </div>
                    </div>
                    {historyTable(visible)}
                  </section>
                  <p className="fine-print">
                    Files and job descriptions are retained for 7 days. Delete
                    any resume sooner using the trash icon.
                  </p>
                </>
              )}
              {view === "settings" && (
                <>
                  <div className="page-heading">
                    <div>
                      <span className="eyebrow">WORKSPACE SETTINGS</span>
                      <h1>Built around your privacy.</h1>
                      <p>
                        Server connections, document safeguards, and data
                        controls.
                      </p>
                    </div>
                  </div>
                  <div className="settings-grid">
                    <section className="card">
                      <h2>Service connections</h2>
                      <p>
                        Secrets are configured on the server and never sent to
                        the browser.
                      </p>
                      <div className="connection">
                        <span className="connection-icon">
                          <Sparkles size={20} />
                        </span>
                        <div>
                          <strong>OpenAI rewriting</strong>
                          <small>
                            Structured edits and independent factual audit
                          </small>
                        </div>
                        <Badge tone={config?.aiReady ? "green" : "amber"}>
                          {config?.aiReady ? "Configured" : "Setup required"}
                        </Badge>
                      </div>
                      <div className="connection">
                        <span className="connection-icon">
                          <FileText size={20} />
                        </span>
                        <div>
                          <strong>Document engine</strong>
                          <small>
                            PDF & DOCX editing and layout validation
                          </small>
                        </div>
                        <Badge tone={config?.documentReady ? "green" : "amber"}>
                          {config?.documentReady
                            ? "Configured"
                            : "Setup required"}
                        </Badge>
                      </div>
                      <details className="setup-details">
                        <summary>Server configuration guide</summary>
                        <p>
                          Set these server environment variables, then redeploy:
                        </p>
                        <code>
                          OPENAI_API_KEY
                          <br />
                          OPENAI_MODEL (optional)
                          <br />
                          DOCUMENT_SERVICE_URL
                          <br />
                          DOCUMENT_SERVICE_TOKEN
                        </code>
                        <p>
                          The document service is included with the application
                          source. Run its Docker container behind HTTPS with a
                          random authentication token. Configure the same token
                          on the application server. Do not enter API keys into
                          job descriptions.
                        </p>
                        <p>
                          Local development reads these values from an untracked{" "}
                          <code>.dev.vars</code> file. Hosted deployments use
                          Sites runtime secrets.
                        </p>
                      </details>
                      <Button
                        kind="secondary"
                        onClick={() => {
                          void refresh();
                          notify("Connection configuration refreshed.");
                        }}
                      >
                        Refresh configuration
                      </Button>
                    </section>
                    <section className="card">
                      <h2>Data & privacy</h2>
                      <p>
                        Your uploaded documents are available only through
                        authenticated, owner-checked endpoints.
                      </p>
                      <div className="privacy-row">
                        <span>Retention period</span>
                        <strong>7 days</strong>
                      </div>
                      <div className="privacy-row">
                        <span>Original files</span>
                        <strong>Never overwritten</strong>
                      </div>
                      <div className="privacy-row">
                        <span>AI response storage</span>
                        <strong>Disabled in API request</strong>
                      </div>
                      <div className="privacy-row">
                        <span>Document content in logs</span>
                        <strong>Not logged</strong>
                      </div>
                      <p className="fine-print">
                        Resume text and the job description are sent to OpenAI
                        only when you start tailoring. Provider retention
                        policies may still apply. Expired records are removed on
                        workspace access; configure a scheduled purge for strict
                        unattended deletion.
                      </p>
                      <Button
                        kind="secondary"
                        onClick={() => navigate("history")}
                      >
                        <Trash2 size={15} /> Manage saved resumes
                      </Button>
                    </section>
                    <section className="card full">
                      <h2>What “preserved” means here</h2>
                      <p>
                        The engine changes text nodes in the original DOCX and
                        keeps all other package parts and formatting attributes
                        intact. It protects mixed-format paragraphs and identity
                        fields. Before release, it checks rendered page counts,
                        replacement text, unchanged paragraph positions, page
                        bounds, and text collisions. Files that cannot pass
                        these checks remain unavailable for download.
                      </p>
                      <p>
                        Keyword coverage is an indicative heuristic, not an ATS
                        test. Factual auditing is automated: always review
                        content and previews before submitting an application.
                      </p>
                    </section>
                  </div>
                </>
              )}
            </>
          )}
          <footer>
            <Brand />
            <span>Thoughtful tailoring. Authentic experience.</span>
            <button onClick={() => setModal("privacy")}>Privacy & data</button>
          </footer>
        </main>
      </div>
      {toast && (
        <div className="toast" role="status">
          <CheckCircle2 size={18} />
          {toast}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setToast("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {deleting && (
        <Modal
          title="Delete this resume?"
          onClose={() => !deleteBusy && setDeleting(null)}
        >
          <p>
            This permanently deletes the uploaded original, job description,
            analysis, and all generated files for this resume.
          </p>
          <div className="modal-actions">
            <Button
              kind="secondary"
              disabled={deleteBusy}
              onClick={() => setDeleting(null)}
            >
              Keep resume
            </Button>
            <Button
              kind="danger"
              disabled={deleteBusy}
              onClick={() => void deleteJob(deleting)}
            >
              {deleteBusy ? <Spinner /> : <Trash2 size={16} />} Delete resume
            </Button>
          </div>
        </Modal>
      )}
      {modal === "search" && (
        <Modal title="Find your next step" onClose={() => setModal(null)}>
          <label className="modal-search">
            <Search size={19} />
            <input
              autoFocus
              placeholder="Search resumes, roles, or companies…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <button
            className="search-result"
            onClick={() => {
              setModal(null);
              navigate("studio");
            }}
          >
            <Plus size={18} />
            <span>Tailor a new resume</span>
            <kbd>New</kbd>
          </button>
          {jobs
            .filter((j) =>
              `${j.name} ${j.role} ${j.company}`
                .toLowerCase()
                .includes(query.toLowerCase()),
            )
            .slice(0, 6)
            .map((j) => (
              <button
                className="search-result"
                key={j.id}
                onClick={() => void openJob(j.id)}
              >
                <FileText size={18} />
                <span>
                  {j.role}
                  <small>{j.name}</small>
                </span>
                <ChevronRight size={16} />
              </button>
            ))}
          {!jobs.length && (
            <p className="fine-print">
              Your saved resumes will be searchable here.
            </p>
          )}
        </Modal>
      )}
      {modal === "privacy" && (
        <Modal title="Your data stays yours." onClose={() => setModal(null)}>
          <p>
            FitiFy stores your uploaded resume, job description, analysis, and
            generated documents in private server storage, scoped to your
            signed-in account.
          </p>
          <CheckLine>
            Original files are kept separately from every output.
          </CheckLine>
          <CheckLine>
            Downloads require ownership checks on every request.
          </CheckLine>
          <CheckLine>
            Delete a saved resume and all its associated files at any time.
          </CheckLine>
          <p>
            Records expire after 7 days and are purged when the workspace is
            accessed. Strict unattended deletion needs a scheduled purge. When
            you start tailoring, document text is sent to the configured OpenAI
            model with response storage disabled; provider retention policies
            may apply.
          </p>
          <Button
            kind="secondary"
            onClick={() => {
              setModal(null);
              navigate("settings");
            }}
          >
            View data settings
          </Button>
        </Modal>
      )}
      {modal === "help" && (
        <Modal
          title="A better fit. The same you."
          onClose={() => setModal(null)}
        >
          <p>
            Start with your original PDF or DOCX and the full job description.
            FitiFy identifies recognized keyword overlap, then proposes edits
            supported by your existing experience.
          </p>
          <div className="help-steps">
            <CheckLine>
              Analyze first: inspect the strengths and gaps.
            </CheckLine>
            <CheckLine>
              Tailor truthfully: preserve dates, metrics, roles, and
              qualifications.
            </CheckLine>
            <CheckLine>
              Review carefully: compare edits and both rendered previews.
            </CheckLine>
            <CheckLine>
              Download only after document validation passes.
            </CheckLine>
          </div>
          <p>
            PDFs are edited directly in supported text regions. Scanned pages,
            unavailable fonts, and protected formatting remain unchanged.
            Alignment scores are keyword heuristics, never real ATS results.
          </p>
          <Button
            onClick={() => {
              setModal(null);
              navigate("studio");
            }}
          >
            Open the tailoring studio
          </Button>
        </Modal>
      )}
    </div>
  );
}
function Stat({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof FileText;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <section className="stat card">
      <div className="row between">
        <span>{label}</span>
        <Icon size={18} />
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </section>
  );
}
