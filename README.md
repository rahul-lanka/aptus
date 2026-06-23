# Aptus

Aptus is an ATS resume analyzer that compares a resume against a job description, calculates an ATS-style score locally, finds matched and missing keywords, and uses Gemini only for resume improvement suggestions.

## Why Aptus

Most of the expensive work does not need AI.

```text
Resume PDF + Job Description
        ↓
Extract Text
        ↓
Keyword Matching
        ↓
ATS Score
        ↓
AI Suggestions
```

This keeps API usage low because:

- ATS score is calculated in the browser
- Missing keywords are detected in the browser
- Resume structure checks are calculated in the browser
- Gemini is called only when the user requests suggestions

## Features

- Upload a resume PDF or text file
- Paste a target job description
- Extract resume text with PDF.js
- Dynamically extract important job keywords and phrases
- Calculate ATS score using local TypeScript logic
- Show matched and missing keywords
- Show score breakdown for keyword coverage, density, and format signals
- Generate Gemini suggestions for job-specific resume improvements
- Copy or export an ATS report
- Link users to official Gemini API key documentation

## Tech Stack

- React
- TypeScript
- Vite
- PDF.js
- Gemini API
- Lucide React icons

## Run Locally

Install dependencies:

```bash
npm install
```

Start the development server:

```bash
npm run dev
```

Open the local URL shown in the terminal, usually:

```text
http://localhost:5173/
```

Build for production:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Gemini API Key

Aptus needs a Gemini API key only for the **Generate suggestions** feature. The ATS score and keyword matching work without an API key.

Official Google documentation:

```text
https://ai.google.dev/gemini-api/docs/api-key
```

Create or view an API key in Google AI Studio:

```text
https://aistudio.google.com/apikey
```

## Project Structure

```text
src/
  analysis.ts   Local ATS scoring and keyword matching logic
  main.tsx      React UI, PDF extraction, and Gemini suggestion flow
  styles.css    App styling
```

## Notes

- Do not commit real API keys.
- Gemini free-tier quota can return `429` if usage is exhausted.
- Gemini can return temporary `503` errors during high demand.
- Scanned image PDFs may not extract text correctly unless OCR is added later.
