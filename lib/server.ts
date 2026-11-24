import { env } from "cloudflare:workers";
import { getChatGPTUser } from "@/app/chatgpt-auth";
import {
  documentCall,
  base64,
  unbase64,
  type Extracted,
  type Generated,
} from "./document";
import { analyze, validateChanges } from "./analysis";
import { rewrite, audit } from "./ai";
import type { Job, Segment, Analysis, Change, Validation } from "./types";

type RecordData = {
  jd: string;
  segments?: Segment[];
  analysis?: Analysis;
  changes?: Change[];
  validation?: Validation;
  pages?: number;
  editable?: boolean;
  notice?: string;
  artifactPrefix?: string;
  rewriteFeedback?: string;
  auditAttempts?: number;
  filteredEdits?: number;
  previewRegions?: { id: number; page: number; bbox: number[] }[];
};
const E = env as unknown as Record<string, unknown> & {
  DB: D1Database;
  BUCKET: R2Bucket;
};
const TTL = 7 * 24 * 60 * 60 * 1000;
const json = (body: unknown, status = 200) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
class ApiError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
async function readState(id: string) {
  const row = await E.DB.prepare("SELECT state_key FROM jobs WHERE id=?")
    .bind(id)
    .first<{ state_key: string }>();
  const data = await E.BUCKET.get(`${id}/${row?.state_key || "state"}`);
  if (!data)
    throw new ApiError("Saved processing data could not be found.", 404);
  return data.json<RecordData>();
}
async function writeState(id: string, data: RecordData) {
  await E.BUCKET.put(`${id}/state`, JSON.stringify(data));
}
async function owned(id: string, user: string) {
  if (!/^[a-f0-9-]{36}$/.test(id)) throw new ApiError("Not found.", 404);
  const row = await E.DB.prepare(
    "SELECT id,name,format,status,stage,score,role,company,created_at as createdAt,expires_at as expiresAt,error FROM jobs WHERE id=? AND user_id=?",
  )
    .bind(id, user)
    .first<Job>();
  if (!row) throw new ApiError("Resume not found.", 404);
  if (row.expiresAt < Date.now()) {
    await remove(id, user);
    throw new ApiError(
      "This resume expired after seven days and was deleted.",
      410,
    );
  }
  return row;
}
async function remove(id: string, user: string) {
  await E.DB.prepare("DELETE FROM jobs WHERE id=? AND user_id=?")
    .bind(id, user)
    .run();
  let cursor: string | undefined;
  do {
    const listed = await E.BUCKET.list({ prefix: `${id}/`, cursor });
    if (listed.objects.length)
      await E.BUCKET.delete(listed.objects.map((o) => o.key));
    cursor = listed.truncated ? listed.cursor : undefined;
  } while (cursor);
}
async function limit(user: string) {
  const hour = Math.floor(Date.now() / 3600000);
  const key = `${user}:${hour}`;
  const row = await E.DB.prepare(
    "INSERT INTO limits (key,count,expires_at) VALUES (?,1,?) ON CONFLICT(key) DO UPDATE SET count=count+1 RETURNING count",
  )
    .bind(key, (hour + 1) * 3600000)
    .first<{ count: number }>();
  if ((row?.count || 0) > 25)
    throw new ApiError("Hourly upload limit reached. Try again later.", 429);
  await E.DB.prepare("DELETE FROM limits WHERE expires_at<?")
    .bind(Date.now())
    .run();
}
async function boundedForm(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("Request body is missing.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > 6 * 1024 * 1024) {
      await reader.cancel();
      throw new ApiError("Upload exceeds the request size limit.", 413);
    }
    chunks.push(value);
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.length;
  }
  return new Request(request.url, {
    method: "POST",
    headers: { "Content-Type": request.headers.get("Content-Type") || "" },
    body,
  }).formData();
}
async function fileData(id: string) {
  const obj = await E.BUCKET.get(`${id}/original`);
  if (!obj) throw new ApiError("Original file is unavailable.", 404);
  return base64(await obj.arrayBuffer());
}
async function advance(job: Job, user: string) {
  if (job.status !== "processing") return json(job);
  const now = Date.now();
  const lease = await E.DB.prepare(
    "UPDATE jobs SET lease_until=? WHERE id=? AND user_id=? AND stage=? AND status='processing' AND lease_until<? RETURNING id",
  )
    .bind(now + 600000, job.id, user, job.stage, now)
    .first();
  if (!lease) return json({ ...job, busy: true }, 202);
  try {
    const state = await readState(job.id);
    let retryRewrite = false;
    if (job.stage === 0) {
      const parsed = await documentCall<Extracted>(E, "/extract", {
        file: await fileData(job.id),
        format: job.format,
      });
      Object.assign(state, parsed);
    } else if (job.stage === 1) {
      state.analysis = analyze(
        (state.segments || []).map((s) => s.text).join("\n"),
        state.jd,
      );
    } else if (job.stage === 2) {
      if (!state.analysis)
        throw new Error("Analysis was not saved. Retry analysis.");
    } else if (job.stage === 3) {
      // Refresh extraction for existing PDFs analyzed before PDF editing was added.
      if (job.format === "pdf")
        Object.assign(
          state,
          await documentCall<Extracted>(E, "/extract", {
            file: await fileData(job.id),
            format: "pdf",
          }),
        );
      if (!state.editable)
        throw new Error(
          state.notice ||
            "No safely editable text regions were found. Protected fields remain untouched.",
        );
      let feedback = state.rewriteFeedback || "";
      let accepted = false;
      let rejection = "No supported edits were returned.";
      for (let attempt = 0; attempt < 3; attempt++) {
        const output = await rewrite(E, state.segments!, state.jd, feedback);
        const valid: Change[] = [];
        const seen = new Set<number>();
        for (const proposed of output.changes) {
          const source = state.segments!.find((s) => s.id === proposed.id);
          const candidate = { ...proposed, evidence: source?.text || "" };
          try {
            validateChanges(state.segments!, [candidate]);
            if (!seen.has(candidate.id)) {
              valid.push(candidate);
              seen.add(candidate.id);
            }
          } catch (error) {
            rejection =
              error instanceof Error ? error.message : "Invalid edit response.";
          }
        }
        state.filteredEdits =
          (state.filteredEdits || 0) + output.changes.length - valid.length;
        output.changes = valid;
        if (!valid.length) {
          feedback =
            "No previous suggestions passed validation: " +
            rejection +
            " Return only 1 or 2 minimal edits, keeping every replacement no longer than its original and preserving all facts and numeric tokens.";
          continue;
        }
        if (job.format === "pdf") {
          const fit = await documentCall<{
            fits: boolean;
            reason: string;
            rejectedIds?: number[];
          }>(E, "/check-pdf", {
            file: await fileData(job.id),
            changes: output.changes,
          });
          if (!fit.fits) {
            const rejected = new Set(
              fit.rejectedIds || output.changes.map((c) => c.id),
            );
            const remaining = output.changes.filter((c) => !rejected.has(c.id));
            state.filteredEdits =
              (state.filteredEdits || 0) +
              output.changes.length -
              remaining.length;
            if (remaining.length) output.changes = remaining;
            else {
              rejection = fit.reason;
              feedback =
                fit.reason +
                " Return just one or two shorter edits that preserve all facts. Avoid adding words; use concise equivalent wording.";
              continue;
            }
          }
        }
        state.changes = output.changes;
        accepted = true;
        break;
      }
      if (!accepted)
        throw new Error(
          "The AI edits did not pass the document constraints: " +
            rejection +
            " Your original is unchanged. Retry to regenerate.",
        );
    } else if (job.stage === 4) {
      validateChanges(state.segments!, state.changes!);
      let candidates = state.changes!;
      let supported = false;
      let issues: string[] = [];
      for (let pass = 0; pass < 3; pass++) {
        const result = await audit(E, state.segments!, candidates);
        if (
          result.supported === true &&
          !result.issues.length &&
          !result.rejectedIds.length
        ) {
          supported = true;
          state.changes = candidates;
          state.rewriteFeedback = undefined;
          break;
        }
        issues = result.issues;
        const rejected = new Set(result.rejectedIds);
        if (
          !rejected.size ||
          [...rejected].some((id) => !candidates.some((c) => c.id === id))
        )
          break;
        const remaining = candidates.filter((c) => !rejected.has(c.id));
        if (!remaining.length) break;
        candidates = remaining;
      }
      if (!supported) {
        if ((state.auditAttempts || 0) >= 2)
          throw new Error(
            "Factual review could not approve the rewrites after regeneration. No document was released.",
          );
        state.auditAttempts = (state.auditAttempts || 0) + 1;
        state.rewriteFeedback =
          "The factual auditor rejected prior edits: " +
          issues.join(" ") +
          " Make only minimal wording changes that preserve every claim and fact. Return just one or two safe edits.";
        state.changes = undefined;
        retryRewrite = true;
      }
    } else if (job.stage === 5) {
      validateChanges(state.segments!, state.changes!);
    } else if (job.stage === 6) {
      const result = await documentCall<Generated>(E, "/generate", {
        file: await fileData(job.id),
        changes: state.changes,
        format: job.format,
      });
      if (!result.validation.passed)
        throw new Error(
          "Document validation failed. No download was released.",
        );
      state.validation = result.validation;
      if (state.filteredEdits)
        state.validation.warnings.push(
          "Some AI suggestions were excluded because they did not pass source or layout constraints. Only approved changes are included.",
        );
      state.artifactPrefix = `artifacts-${now}`;
      if (job.format === "docx")
        await E.BUCKET.put(
          `${job.id}/${state.artifactPrefix}/tailored.docx`,
          unbase64(result.document),
        );
      await E.BUCKET.put(
        `${job.id}/${state.artifactPrefix}/tailored.pdf`,
        unbase64(result.pdf),
      );
      await E.BUCKET.put(
        `${job.id}/${state.artifactPrefix}/original.pdf`,
        unbase64(result.originalPdf),
      );
    } else if (job.stage === 7) {
      if (!state.validation?.passed)
        throw new Error("Document validation has not passed.");
    }
    const current = await owned(job.id, user);
    if (current.status !== "processing" || current.stage !== job.stage)
      return json(current);
    const stateKey = `state-${now}`;
    await E.BUCKET.put(`${job.id}/${stateKey}`, JSON.stringify(state));
    const next = retryRewrite ? 3 : job.stage + 1;
    const status =
      next === 3 && job.stage === 2
        ? "analyzed"
        : next === 8
          ? "ready"
          : "processing";
    await E.DB.prepare(
      "UPDATE jobs SET stage=?,status=?,score=?,role=?,company=?,state_key=?,error=NULL,lease_until=0 WHERE id=? AND user_id=? AND status='processing' AND stage=? AND lease_until=?",
    )
      .bind(
        next,
        status,
        state.analysis?.score ?? null,
        state.analysis?.title || job.role,
        state.analysis?.company || "",
        stateKey,
        job.id,
        user,
        job.stage,
        now + 600000,
      )
      .run();
    return json({
      ...(await owned(job.id, user)),
      ...(await readState(job.id)),
      jd: undefined,
    });
  } catch (error) {
    const exists = await E.DB.prepare(
      "SELECT id FROM jobs WHERE id=? AND user_id=?",
    )
      .bind(job.id, user)
      .first();
    if (!exists) {
      await remove(job.id, user);
      return json({ error: "Resume was deleted." }, 410);
    }
    const message =
      error instanceof Error
        ? error.message
        : "Processing failed. Retry your saved document.";
    await E.DB.prepare(
      "UPDATE jobs SET status='error',error=?,lease_until=0 WHERE id=? AND user_id=? AND status='processing' AND lease_until=?",
    )
      .bind(message, job.id, user, now + 600000)
      .run();
    return json({
      ...(await owned(job.id, user)),
      ...(await readState(job.id)),
      jd: undefined,
    });
  }
}
export async function handle(request: Request, parts: string[]) {
  try {
    const user = await getChatGPTUser();
    if (!user)
      return json({ error: "Sign in to access your private resumes." }, 401);
    if (!E.DB || !E.BUCKET)
      throw new ApiError(
        "Secure storage is not connected. Please contact the site owner.",
        503,
      );
    if (!["GET", "HEAD"].includes(request.method)) {
      const origin = request.headers.get("Origin");
      if (origin && origin !== new URL(request.url).origin)
        throw new ApiError("Cross-origin request rejected.", 403);
    }
    const [resource, id, action] = parts;
    if (resource === "config" && request.method === "GET")
      return json({
        aiReady: !!E.OPENAI_API_KEY,
        documentReady: !!E.DOCUMENT_SERVICE_URL && !!E.DOCUMENT_SERVICE_TOKEN,
        user: user.displayName,
        retentionDays: 7,
      });
    if (resource !== "jobs") throw new ApiError("Not found.", 404);
    if (!id && request.method === "GET") {
      const expired = await E.DB.prepare(
        "SELECT id FROM jobs WHERE user_id=? AND expires_at<? LIMIT 50",
      )
        .bind(user.userId, Date.now())
        .all<{ id: string }>();
      for (const row of expired.results) await remove(row.id, user.userId);
      const rows = await E.DB.prepare(
        "SELECT id,name,format,status,stage,score,role,company,created_at as createdAt,expires_at as expiresAt,error FROM jobs WHERE user_id=? ORDER BY created_at DESC LIMIT 100",
      )
        .bind(user.userId)
        .all<Job>();
      return json(rows.results);
    }
    if (!id && request.method === "POST") {
      if (Number(request.headers.get("Content-Length") || 0) > 6 * 1024 * 1024)
        throw new ApiError("Upload exceeds the 5 MiB file limit.", 413);
      await limit(user.userId);
      const form = await boundedForm(request);
      const file = form.get("file");
      const jd = String(form.get("jd") || "").trim();
      if (!(file instanceof File))
        throw new ApiError("Choose a PDF or DOCX resume.");
      if (file.size === 0 || file.size > 5 * 1024 * 1024)
        throw new ApiError("Choose a non-empty document smaller than 5 MiB.");
      if (jd.length < 100 || jd.length > 30000)
        throw new ApiError(
          "Use a job description between 100 and 30,000 characters.",
        );
      const format = file.name.split(".").pop()?.toLowerCase();
      if (!["pdf", "docx"].includes(format || ""))
        throw new ApiError("Only PDF and DOCX documents are supported.");
      const data = await file.arrayBuffer();
      const magic = new Uint8Array(data).slice(0, 5);
      if (
        (format === "pdf" && String.fromCharCode(...magic) !== "%PDF-") ||
        (format === "docx" && (magic[0] !== 80 || magic[1] !== 75))
      )
        throw new ApiError("File contents do not match the extension.");
      const requestKey =
        request.headers.get("Idempotency-Key") || crypto.randomUUID();
      if (requestKey.length > 100) throw new ApiError("Invalid request key.");
      const existing = await E.DB.prepare(
        "SELECT id FROM jobs WHERE user_id=? AND request_key=?",
      )
        .bind(user.userId, requestKey)
        .first<{ id: string }>();
      if (existing) return json(await owned(existing.id, user.userId));
      const uuid = crypto.randomUUID(),
        now = Date.now();
      const name = file.name
        .replace(/[^\p{L}\p{N} ._()-]/gu, "_")
        .slice(0, 160);
      await E.BUCKET.put(`${uuid}/original`, data);
      await writeState(uuid, { jd });
      try {
        await E.DB.prepare(
          "INSERT INTO jobs (id,user_id,name,format,status,stage,role,company,created_at,expires_at,lease_until,request_key) VALUES (?,?,?,?,'processing',0,'Untitled role','',?,?,0,?)",
        )
          .bind(uuid, user.userId, name, format, now, now + TTL, requestKey)
          .run();
      } catch (e) {
        await E.BUCKET.delete([`${uuid}/original`, `${uuid}/state`]);
        throw e;
      }
      return json(await owned(uuid, user.userId), 201);
    }
    if (!id) throw new ApiError("Not found.", 404);
    const job = await owned(id, user.userId);
    if (request.method === "DELETE" && !action) {
      await remove(id, user.userId);
      return json({ deleted: true });
    }
    if (request.method === "GET" && !action)
      return json({ ...job, ...(await readState(id)), jd: undefined });
    if (request.method === "POST" && action === "advance")
      return advance(job, user.userId);
    if (
      request.method === "POST" &&
      ["tailor", "retry", "cancel", "refresh-document"].includes(action || "")
    ) {
      if (action === "cancel") {
        await E.DB.prepare(
          "UPDATE jobs SET status='cancelled',lease_until=0 WHERE id=? AND user_id=?",
        )
          .bind(id, user.userId)
          .run();
      } else {
        if (action === "tailor" && job.status !== "analyzed")
          throw new ApiError("Analyze this resume before tailoring.");
        if (
          action === "retry" &&
          !["error", "cancelled", "ready"].includes(job.status)
        )
          throw new ApiError("This job cannot be retried yet.");
        if (action === "refresh-document" && job.status !== "ready")
          throw new ApiError(
            "Only validated outputs can be regenerated without rewriting.",
          );
        const stage =
          action === "refresh-document"
            ? 6
            : job.status === "ready"
              ? 3
              : job.stage;
        await E.DB.prepare(
          "UPDATE jobs SET status='processing',stage=?,error=NULL,lease_until=0 WHERE id=? AND user_id=?",
        )
          .bind(stage, id, user.userId)
          .run();
      }
      return json(await owned(id, user.userId));
    }
    if (request.method === "GET" && action === "download") {
      const type = new URL(request.url).searchParams.get("type") || job.format;
      if (job.format === "pdf" && type === "docx")
        throw new ApiError(
          "This resume was uploaded as PDF; download the tailored PDF.",
          400,
        );
      if (
        ![
          "docx",
          "pdf",
          "original-pdf",
          "original",
          "highlighted-pdf",
          "highlighted-original-pdf",
        ].includes(type)
      )
        throw new ApiError("Unsupported download type.");
      if (
        type !== "original" &&
        (job.status !== "ready" || !(await readState(id)).validation?.passed)
      )
        throw new ApiError(
          "Downloads unlock after document validation passes.",
          409,
        );
      const prefix =
        type === "original" ? "" : (await readState(id)).artifactPrefix;
      if (type !== "original" && !prefix)
        throw new ApiError("Validated output is unavailable.", 404);
      const highlighted =
        type === "highlighted-pdf" || type === "highlighted-original-pdf";
      const highlightOriginal = type === "highlighted-original-pdf";
      const highlightedKey = `${id}/${prefix}/${highlightOriginal ? "highlighted-original" : "highlighted"}.pdf`;
      if (highlighted && !(await E.BUCKET.head(highlightedKey))) {
        const state = await readState(id);
        let regions = state.previewRegions;
        if (job.format === "pdf" && !regions) {
          const extracted = await documentCall<Extracted>(E, "/extract", {
            file: await fileData(id),
            format: "pdf",
          });
          regions = extracted.previewRegions;
        }
        const source = await E.BUCKET.get(
          `${id}/${prefix}/${highlightOriginal ? "original" : "tailored"}.pdf`,
        );
        if (!source)
          throw new ApiError("The validated PDF preview is unavailable.", 404);
        const result = await documentCall<{
          pdf: string;
          highlightedChanges: number;
        }>(E, "/highlight", {
          file: base64(await source.arrayBuffer()),
          changes: state.changes,
          regions,
          original: highlightOriginal,
        });
        await E.BUCKET.put(highlightedKey, unbase64(result.pdf));
      }
      const key = highlighted
        ? highlightedKey
        : type === "original"
          ? `${id}/original`
          : type === "original-pdf"
            ? `${id}/${prefix}/original.pdf`
            : `${id}/${prefix}/tailored.${type}`;
      const obj = await E.BUCKET.get(key);
      if (!obj) throw new ApiError("Download is unavailable.", 404);
      const pageParameter = new URL(request.url).searchParams.get("renderPage");
      if (pageParameter !== null) {
        if (
          ![
            "pdf",
            "original-pdf",
            "highlighted-pdf",
            "highlighted-original-pdf",
          ].includes(type)
        )
          throw new ApiError("Only validated PDF previews can be rendered.");
        const number = Number(pageParameter);
        const state = await readState(id);
        if (
          !Number.isInteger(number) ||
          number < 1 ||
          number > (state.validation?.pagesTailored || 0)
        )
          throw new ApiError("Preview page does not exist.", 400);
        const imageKey = `${id}/${prefix}/preview-${type}-${number}.png`;
        let image = await E.BUCKET.get(imageKey);
        if (!image) {
          const rendered = await documentCall<{ image: string }>(
            E,
            "/render-page",
            { file: base64(await obj.arrayBuffer()), page: number },
          );
          await E.BUCKET.put(imageKey, unbase64(rendered.image));
          image = await E.BUCKET.get(imageKey);
        }
        if (!image) throw new ApiError("The page preview is unavailable.", 503);
        return new Response(image.body, {
          headers: {
            "Content-Type": "image/png",
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
          },
        });
      }
      const fmt =
        type === "original" ? job.format : type === "docx" ? "docx" : "pdf";
      const filename =
        type === "original"
          ? job.name
          : `${job.name.replace(/\.[^.]+$/, "")}-${highlighted ? "highlighted-preview" : type === "original-pdf" ? "original" : "tailored"}.${fmt}`;
      return new Response(obj.body, {
        headers: {
          "Content-Type":
            fmt === "pdf"
              ? "application/pdf"
              : "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
          "Content-Disposition": `${new URL(request.url).searchParams.has("preview") ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(filename)}`,
          "Cache-Control": "private, no-store",
          "X-Content-Type-Options": "nosniff",
        },
      });
    }
    throw new ApiError("Not found.", 404);
  } catch (e) {
    if (e instanceof ApiError) return json({ error: e.message }, e.status);
    return json(
      {
        error:
          "The service could not complete this request. Your saved files are retained; try again.",
      },
      500,
    );
  }
}
