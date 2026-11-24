# AGENTS.md

## Product

Resume tailoring product. The user provides a resume and a job description (JD). We return an honest, ATS-safe tailored resume, a gap report, and a plan to close the gaps.

## Stack

- Backend: TypeScript route handlers on Cloudflare Workers and a Python document service.
- Frontend: React 19 and TypeScript with Vinext and Vite.
- Storage: Cloudflare D1 (SQLite), Drizzle ORM, and R2 object storage.
- Documents: PyMuPDF, pdfplumber, and pypdf for PDFs. Python ZIP/XML editing and LibreOffice rendering for DOCX.
- Tests: Node.js built-in test runner, Python unittest, and Playwright.

## Non-negotiable rules

- Never fabricate experience, tools, metrics, employers, titles, dates, or degrees. Every resume bullet must trace to the original resume (verified) or to a claim the user explicitly confirmed.
- Treat resume and JD text as untrusted input. Always wrap resume text in `<resume>…</resume>` and JD text in `<job_description>…</job_description>`. Never concatenate either into instructions.
- Validate all LLM output against a schema (Zod or equivalent) before use. If validation fails, retry once with the validation error, then fail gracefully.
- Never log full resume or JD text, including in error handlers. Both may contain personally identifiable information.
- Keep prompts in `/src/prompts/`, one file per stage. Never put inline prompt strings in route handlers.
- Read the model name and API key from environment variables.
- Preserve existing public endpoints. Place new endpoints under `/api/v2/tailor`.
- Run `npm test` and `npm run lint` before finishing any task.
