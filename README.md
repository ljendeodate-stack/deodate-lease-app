# DEODATE Lease Schedule Engine

A web app that reads a commercial lease and produces a monthly charge schedule you can review and export to Excel.

Upload a lease PDF (OCR extracts key terms automatically), or enter your own schedule manually. Fill in NNN/CAM charge parameters, then export a finalized ledger with rent, NNN, abatement, and one-time items broken out by month.

---

## Prerequisites

- Node.js 18 or later
- An Anthropic API key (required for PDF OCR)

---

## Setup

1. Clone the repo
2. Install dependencies:
   ```bash
   npm install
   ```
3. Create a `.env` file in the project root:
   ```
   VITE_ANTHROPIC_API_KEY=sk-ant-...
   ```

---

## Run

```bash
npm run dev
```

Opens at [http://localhost:5173](http://localhost:5173)

On Windows, you can also double-click `Start Dev.cmd` in the repo root to launch the dev server and open the app in your browser.

---

## Build

```bash
npm run build     # production build → dist/
npm run preview   # serve the production build locally
```

---

## Test

```bash
npm test          # run all app tests
```

---

## Folder map

```
src/                  App source code
public/               Static files served by the app (includes download template)
docs/                 Planning docs, manuals, and reference material
resources/            Test fixtures
scripts/              Dev and eval utilities
manual-test-pdfs/     PDF test suite for OCR
skills/               Claude Code skill definitions
```

---

## Environment variables

| Variable | Required | Description |
|---|---|---|
| `VITE_ANTHROPIC_API_KEY` | Yes (PDF path) | Anthropic API key for lease OCR |
| `VITE_OPENAI_API_KEY` | No | Fallback OCR provider |
| `VITE_OCR_PROVIDER` | No | `anthropic` (default) or `openai` |
| `VITE_OPENAI_OCR_MODEL` | No | OpenAI model to use when provider is `openai` |
