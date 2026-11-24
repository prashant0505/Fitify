# FitiFy — AI Resume Tailor

A private resume workspace built with React 19, TypeScript, Vinext (Next.js-compatible routing), Cloudflare D1/R2, and a separate Python/LibreOffice document engine.

## Current status

Implemented: real PDF/DOCX upload and extraction, persistent history, deterministic JD keyword coverage, staged processing, server-side structured OpenAI rewriting and independent factual audit, conservative DOCX text-node editing, rendered validation, owner-checked original and output downloads, comparison/preview controls, cancellation/retry, deletion, upload limits, and responsive UI.

The local owner has configured an API key. The hosted app also needs a reachable document service; the locally tested engine is not automatically deployed with the Cloudflare Worker. Missing connections are visible in Settings and fail safely. This is a tested implementation with explicit constraints, not a claim of production certification.

PDF analysis and direct editing are supported. Supported uniform text runs are rewritten in the original pages, including regular runs next to protected bold text. Original embedded fonts or exact Base-14 fonts, sizes, colors and baselines are reused. Replacements must fit the original line count. Unsupported, rotated, scanned, linked and unavailable-font regions remain protected. DOCX edits support eligible single-run descriptions and skills lists. Mixed-format paragraphs, identity fields, education, headers/footers and unsupported structures remain protected. Some resumes will have no safely editable regions. The engine rejects outputs that cannot be verified.

Tailoring prioritizes must-have qualifications and relevant achievements. Supported skills lists can bring relevant skills forward and surface skills demonstrated in the original experience or projects. After validation, the result compares original and tailored keyword coverage and shows remaining gaps.

When AI rewriting is configured, **Analyze and tailor** runs analysis, rewriting, fact checks, and document validation in one flow. Fitify finds supporting details in the original resume and updates eligible project, experience, summary, and skills text. The result shows weighted requirement coverage and counts explicit alternatives as one requirement group.

## Run locally

Install Node.js 24 LTS, Python 3.12, LibreOffice Writer, and the fonts used by your resumes. Local development depends on the platforms supported by Cloudflare's native `workerd` runtime. The verification workflow targets Linux, macOS, and Windows. [Cloudflare system requirements](https://developers.cloudflare.com/workers/wrangler/install-and-update/#wrangler-system-requirements)

Run `npm ci` on the machine where you will run Fitify. It recreates `node_modules` from the lockfile. Create the Python virtual environment on the same machine. If you copied the checkout from another computer, move any copied `.venv` aside before running the setup commands.

On macOS or Linux, use a shell with Python 3.12 available as `python3.12`:

```sh
npm ci
python3.12 -m venv .venv
.venv/bin/python -m pip install -r document-service/requirements.txt
npm run dev:local
```

On Windows, use PowerShell:

```powershell
npm.cmd ci
py -3.12 -m venv .venv
.\.venv\Scripts\python.exe -m pip install -r document-service/requirements.txt
npm.cmd run dev:local
```

The launcher applies local migrations, starts the document engine on `127.0.0.1:8091`, and starts the app on `http://127.0.0.1:5173`. Use the local sign-in link. Press Ctrl+C to stop the stack. The document engine creates a local token in the ignored `.dev.vars` file. Local SQLite/R2 emulation lives in `.wrangler/state`.

Set `FITIFY_PYTHON` to the executable path to use an existing Python environment. LibreOffice is discovered on PATH or in its standard macOS or Windows install location. Set `SOFFICE_BIN` to the executable path for a custom installation. On Windows use the headless `soffice.com` executable.

Add these entries to `.dev.vars` to enable live rewriting, then restart the app:

```dotenv
OPENAI_API_KEY=your-server-key
OPENAI_MODEL=gpt-4.1
```

Never commit keys. The model is configurable; select a model supporting Responses API structured outputs. Requests set `store:false`. Provider data-retention terms can still apply.

## Architecture

- `components/workspace.tsx`: dashboard, studio, history, account settings and upload flow.
- `components/job-view.tsx`: alignment, staged progress, edit review, original/tailored previews, gated download.
- `lib/server.ts`: authenticated API, scoped storage, bounded uploads, idempotency, expiring execution leases, immutable stage-state pointers, cancellation and recovery.
- `lib/policy.ts`: the complete supplied tailoring prompt, immutable on the server.
- `lib/ai.ts`: structured Responses API calls, retries, timeout handling and a separate factual audit.
- `lib/analysis.ts`: recognized-term coverage and deterministic edit checks. No semantic/experience match claims are made by this heuristic.
- `document-service/engine.py`: ZIP safety validation, raw OOXML text-node patching, preservation checks, LibreOffice rendering and PDF layout comparison.
- `db/schema.ts` and `drizzle/`: migration-owned D1 schema. Resume text, JD and generated files live in R2, not list metadata.

The browser drives one authenticated stage request at a time. Each stage reflects actual work, persists its result, and atomically advances a leased state pointer. Closing the browser pauses further stage dispatch; an in-flight request may finish. Reopening a saved job resumes it. This is resumable request-driven processing, not a dedicated queue worker. Progress never advances on a timer alone.

Uploads are limited to 5 MiB, total multipart requests to 6 MiB, documents to 60,000 characters/500 paragraphs and PDFs to 10 pages. Per-user upload rate is limited to 25/hour. A unique owner/request key prevents duplicate records. Original documents are never overwritten.

## Validation contract

The service permits only text-node changes in existing paragraphs and verifies:

1. All non-text OOXML bytes and other ZIP members are unchanged.
2. All requested replacements occur in the rendered output.
3. Original/tailored page counts match.
4. Unchanged paragraph positions match within 1.5 points.
5. Rendered words remain within page bounds, without detected word collisions.

Numeric tokens must remain identical. New recognized technologies within an edited segment are rejected. A separate model audits support and fact preservation; this reduces risk but cannot mathematically prove truth. The user must review edits and previews.

The comparison uses two LibreOffice renders. Missing fonts, Word/LibreOffice rendering differences, pre-existing overlaps, text ordering, complex columns and embedded text can prevent validation. It is deliberately conservative. No pixel-identical guarantee is made.

## Production deployment

The Sites manifest declares D1 `DB` and R2 `BUCKET`. Sites provisions those and applies checked-in migrations when publishing. The private Site uses platform authentication. Every data operation checks the current owner; downloads stream through authenticated routes rather than public object URLs.

1. Deploy `document-service/Dockerfile` on a container host with LibreOffice, appropriate resume fonts, HTTPS ingress, restricted egress, CPU/memory/PID limits, a read-only filesystem plus writable `/tmp` and user profile paths, and no access to host files. Set a randomly generated `DOCUMENT_SERVICE_TOKEN` of at least 24 characters.
2. Set Site runtime secrets `DOCUMENT_SERVICE_URL` (HTTPS), `DOCUMENT_SERVICE_TOKEN`, and `OPENAI_API_KEY`; optionally set `OPENAI_MODEL`.
3. Redeploy so the Worker receives the new environment revision.
4. Run the live AI smoke journey with a synthetic resume, review content and both previews, then download and inspect the output.
5. Configure a scheduled retention purge and monitoring before onboarding customers.

Do not use a localhost document-service URL in hosted configuration. The document engine is a separate trusted service and never accepts a user-supplied endpoint. Container-host TLS, scaling, network isolation and monitoring need operational configuration; they are not provisioned by this repository.

Records expire after seven days. Reads deny expired access; workspace access deletes expired records and their objects. **Physical deletion of untouched expired records requires a scheduled purge.** An authenticated `DELETE /api/jobs/:id` removes all current original, stage and output objects. R2 bucket retention/versioning policy must also match your deletion commitments.

No billing, subscription management, team accounts, dedicated background queue, OCR, or guaranteed arbitrary-PDF editing is implemented. Do not market these capabilities without implementing and testing them.

## Checks

```sh
npm run typecheck
npm run lint
npm test
python3 -m unittest discover -s document-service -p 'test_*.py' -v
npm run build
```

Document tests additionally require `python-docx` (`pip install python-docx==1.2.0`). They use synthetic data, verify DOCX ZIP parts/fonts/margins and PDF fonts/geometry/rendered preservation, and run real generation/validation passes. Install all test dependencies with `pip install -r document-service/requirements-dev.txt`.

Generate the synthetic browser-test fixture:

```sh
python3 scripts/create-test-fixture.py
```

With both local services running and local migrations applied:

```sh
npx playwright install chromium
npm run test:e2e
```

`PLAYWRIGHT_CHROME_PATH` optionally selects an installed Chrome executable. Tests cover a real upload/extract/analyze/persist journey, missing-key gating, authenticated original download, blocked unvalidated outputs, invalid uploads, settings and mobile screenshot/overflow checks. Unit tests mock the provider only inside the test process to validate request construction and rejection; production contains no mock provider. Full live AI-to-download E2E remains a required post-key smoke test.

Visual regression baselines are platform-specific. Update them deliberately using `npm run test:e2e -- --update-snapshots` in the same OS/browser environment. CI starts the stack through Playwright and runs static, unit, document, browser, and build checks on Linux, macOS, and Windows.

Official API references used: [OpenAI structured outputs](https://developers.openai.com/api/docs/guides/structured-outputs), [Playwright visual comparisons](https://playwright.dev/docs/test-snapshots), [pdfplumber](https://github.com/jsvine/pdfplumber).

## Direct PDF editing

`document-service/pdf_engine.py` performs original-page edits, with no PDF-to-DOCX conversion or template recreation. Mixed-format blocks are split into uniform runs; protected bold runs are retained. The engine reuses embedded font programs and checks glyph coverage, text widths, original line counts, page geometry, searchable replacement text, untouched text positions, and a raster comparison outside edited regions. It serializes PDF-library operations for thread safety. Signed/interactive PDFs and image-only scans are rejected with an explanation.

The AI receives paragraph context and per-region length budgets. PDF fit is checked before factual auditing, with up to two additional rewriting attempts if the first text does not fit. A PDF input yields a PDF output, and no DOCX download is offered for that input. Existing saved PDF analyses are refreshed when tailoring begins.

The service dependency includes PyMuPDF; its upstream license terms apply. Review [PyMuPDF licensing](https://pymupdf.readthedocs.io/en/latest/about.html#license-and-copyright) before distributing or offering a hosted service.

## Preview change highlights

Validated results include a **Show changes** toggle in Document preview. It highlights updated text regions in the tailored PDF and the corresponding source text in the original view. The server creates separate annotated review copies lazily through the authenticated document service; ordinary PDF/DOCX downloads remain byte-for-byte clean. Existing saved results are supported without regenerating AI content. PDF edits use original region coordinates to avoid highlighting duplicate text elsewhere; DOCX render matching requires unique text. The viewer includes loading, retry and clean-preview fallback controls.
