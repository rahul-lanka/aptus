import React, { useMemo, useState } from "react";
import ReactDOM from "react-dom/client";
import {
  AlertCircle,
  ArrowDown,
  BadgeCheck,
  Brain,
  Clipboard,
  Download,
  ExternalLink,
  FileText,
  Gauge,
  KeyRound,
  ListChecks,
  Loader2,
  SearchCheck,
  Sparkles,
  Target,
  Upload
} from "lucide-react";
import { analyzeResume, fallbackResumeText, type AtsAnalysis } from "./analysis";
import "./styles.css";

const GEMINI_MODELS = [
  "gemini-2.5-flash-lite",
  "gemini-2.5-flash",
  "gemini-3.5-flash",
  "gemini-flash-latest"
];
const TEMPORARY_GEMINI_STATUSES = new Set([500, 502, 503, 504]);

type StepState = "idle" | "working" | "done" | "error";

const scoreVerdict = (score: number) => {
  if (score >= 82) return "Strong match";
  if (score >= 65) return "Competitive";
  if (score >= 45) return "Needs tuning";
  return "Low alignment";
};

const extractPdfText = async (file: File) => {
  const [pdfjs, worker] = await Promise.all([
    import("pdfjs-dist"),
    import("pdfjs-dist/build/pdf.worker.mjs?url")
  ]);

  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;

  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const pageTexts = await Promise.all(
    Array.from({ length: pdf.numPages }, async (_, index) => {
      const page = await pdf.getPage(index + 1);
      const content = await page.getTextContent();
      return content.items
        .map((item) => ("str" in item ? item.str : ""))
        .join(" ");
    })
  );

  return pageTexts.join("\n\n").trim();
};

const textFromParts = (parts: unknown) => {
  if (!Array.isArray(parts)) return "";

  return parts
    .map((part) =>
      part && typeof part === "object" && "text" in part
        ? String((part as { text?: unknown }).text ?? "")
        : ""
    )
    .filter(Boolean)
    .join("\n")
    .trim();
};

const extractGeminiText = (result: unknown) => {
  if (!result || typeof result !== "object") return "";

  const data = result as {
    output_text?: unknown;
    outputText?: unknown;
    text?: unknown;
    output?: unknown;
    candidates?: Array<{ content?: { parts?: unknown } }>;
  };

  if (typeof data.output_text === "string" && data.output_text.trim()) {
    return data.output_text.trim();
  }

  if (typeof data.outputText === "string" && data.outputText.trim()) {
    return data.outputText.trim();
  }

  if (typeof data.text === "string" && data.text.trim()) {
    return data.text.trim();
  }

  const candidateText = data.candidates
    ?.map((candidate) => textFromParts(candidate.content?.parts))
    .filter(Boolean)
    .join("\n")
    .trim();

  if (candidateText) {
    return candidateText;
  }

  if (Array.isArray(data.output)) {
    const outputText = data.output
      .map((item) => {
        if (!item || typeof item !== "object") return "";

        const outputItem = item as {
          text?: unknown;
          content?: unknown;
          parts?: unknown;
        };

        if (typeof outputItem.text === "string") return outputItem.text;
        if (Array.isArray(outputItem.content)) return textFromParts(outputItem.content);
        return textFromParts(outputItem.parts);
      })
      .filter(Boolean)
      .join("\n")
      .trim();

    if (outputText) {
      return outputText;
    }
  }

  return "";
};

const geminiErrorMessage = (result: unknown, fallback: string) => {
  if (!result || typeof result !== "object") return fallback;

  const data = result as {
    error?: { message?: unknown };
    message?: unknown;
  };

  return String(data.error?.message ?? data.message ?? fallback);
};

const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const getSuggestions = async (
  apiKey: string,
  resumeText: string,
  jobDescription: string,
  analysis: AtsAnalysis
) => {
  const prompt = `You are Aptus, an expert ATS resume tailoring assistant. Your job is to help the candidate improve this resume specifically for the pasted job description.

Rules:
- Use the job description as the target role.
- Use the local ATS score, matched keywords, and missing keywords as evidence.
- Suggest edits that improve keyword alignment, role relevance, and recruiter readability.
- Do not invent companies, titles, dates, degrees, tools, certifications, metrics, or experience.
- If a missing keyword is not supported by the resume, say to add it only if truthful.
- Keep suggestions practical and ready to apply.

ATS score: ${analysis.score}/100
Matched keywords: ${analysis.matchedKeywords
    .slice(0, 18)
    .map((item) => `${item.keyword} (${item.count})`)
    .join(", ")}
Missing keywords: ${analysis.missingKeywords
    .slice(0, 18)
    .map((item) => item.keyword)
    .join(", ")}
Keyword coverage: ${Math.round(analysis.coverage * 100)}%
Keyword density: ${Math.round(analysis.density * 100)}%
Resume format score: ${Math.round(analysis.formatScore * 100)}%

Resume:
${resumeText.slice(0, 7000)}

Job description:
${jobDescription.slice(0, 5000)}

Return:
1. Target role fit summary in 2 short sentences.
2. Top 5 resume changes ranked by ATS impact. For each change, explain where to edit and why it helps this job.
3. Missing keywords to add only if truthful, grouped as Skills, Tools, Responsibilities, and Domain terms.
4. Rewrite 3 resume bullets to better match the job description. Keep them truthful and use placeholders like [metric] only when the resume lacks a number.
5. Write one improved professional summary under 45 words tailored to this job.
6. List any red flags or gaps the candidate should address.`;

  const errors: string[] = [];

  for (const model of GEMINI_MODELS) {
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      const response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            contents: [
              {
                parts: [{ text: prompt }]
              }
            ],
            generationConfig: {
              maxOutputTokens: 700,
              temperature: 0.45,
              thinkingConfig: {
                thinkingBudget: 0
              }
            }
          })
        }
      );

      const result = await response.json().catch(() => null);

      if (response.ok) {
        const text = extractGeminiText(result);

        if (text) {
          return text;
        }

        errors.push(`${model}: empty response`);
        break;
      }

      const message = geminiErrorMessage(result, response.statusText);
      errors.push(`${model}: ${response.status} ${message}`);

      if (response.status === 429) {
        throw new Error(
          "Gemini quota is exhausted for this API key. Wait for the free-tier quota to reset, use another key/project, or enable billing in Google AI Studio."
        );
      }

      if (!TEMPORARY_GEMINI_STATUSES.has(response.status)) {
        break;
      }

      await wait(700 * attempt);
    }
  }

  throw new Error(`Gemini request failed. Tried ${errors.join(" | ")}`);
};

const buildReport = (analysis: AtsAnalysis | null, suggestions: string) => {
  if (!analysis) return "";

  return [
    "Aptus Resume ATS Report",
    `ATS Score: ${analysis.score}/100 (${scoreVerdict(analysis.score)})`,
    `Keyword Coverage: ${Math.round(analysis.coverage * 100)}%`,
    `Keyword Density: ${Math.round(analysis.density * 100)}%`,
    `Format Signals: ${Math.round(analysis.formatScore * 100)}%`,
    "",
    "Top missing keywords:",
    analysis.missingKeywords
      .slice(0, 12)
      .map((item) => `- ${item.keyword}`)
      .join("\n") || "- None",
    "",
    "Matched keywords:",
    analysis.matchedKeywords
      .slice(0, 18)
      .map((item) => `- ${item.keyword} (${item.count})`)
      .join("\n") || "- None",
    "",
    "AI suggestions:",
    suggestions || "Not generated yet."
  ].join("\n");
};

const statusLabel: Record<StepState, string> = {
  idle: "Ready",
  working: "Working",
  done: "Done",
  error: "Check input"
};

function App() {
  const [resumeFile, setResumeFile] = useState<File | null>(null);
  const [resumeText, setResumeText] = useState("");
  const [jobDescription, setJobDescription] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [extractState, setExtractState] = useState<StepState>("idle");
  const [suggestionState, setSuggestionState] = useState<StepState>("idle");
  const [error, setError] = useState("");
  const [suggestions, setSuggestions] = useState("");
  const [reportStatus, setReportStatus] = useState("");

  const analysis = useMemo(() => {
    if (!resumeText.trim() || !jobDescription.trim()) {
      return null;
    }

    return analyzeResume(resumeText, jobDescription);
  }, [resumeText, jobDescription]);

  const handleFile = async (file: File | undefined) => {
    if (!file) return;

    setResumeFile(file);
    setError("");
    setSuggestions("");
    setExtractState("working");

    try {
      const text =
        file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
          ? await extractPdfText(file)
          : await file.text();

      setResumeText(text || fallbackResumeText(file.name));
      setExtractState("done");
    } catch (err) {
      setResumeText(fallbackResumeText(file.name));
      setExtractState("error");
      setError(err instanceof Error ? err.message : "Could not parse the resume file.");
    }
  };

  const handleSuggestions = async () => {
    if (!analysis || !apiKey.trim()) return;

    setSuggestionState("working");
    setError("");

    try {
      const nextSuggestions = await getSuggestions(
        apiKey.trim(),
        resumeText,
        jobDescription,
        analysis
      );
      setSuggestions(nextSuggestions);
      setSuggestionState("done");
    } catch (err) {
      setSuggestionState("error");
      setError(
        err instanceof Error
          ? err.message
          : "Could not get Gemini suggestions. Check the API key and try again."
      );
    }
  };

  const scoreTone =
    !analysis || analysis.score < 45
      ? "low"
      : analysis.score < 75
        ? "medium"
        : "high";

  const quickWins = useMemo(() => {
    if (!analysis) {
      return [
        "Upload a resume and paste the full job description.",
        "Aptus will score keywords locally before using AI.",
        "Generate suggestions only when the local analysis is ready."
      ];
    }

    const wins: string[] = [];

    if (analysis.missingKeywords.length) {
      wins.push(
        `Naturally add the top missing terms: ${analysis.missingKeywords
          .slice(0, 5)
          .map((item) => item.keyword)
          .join(", ")}.`
      );
    }

    if (analysis.formatScore < 0.75) {
      wins.push("Add clear sections for Summary, Skills, Experience, Projects, and Education.");
    }

    if (analysis.density < 0.45) {
      wins.push("Repeat key role terms across bullets where they are accurate and evidence-backed.");
    }

    if (analysis.score < 70) {
      wins.push("Rewrite the top 3 bullets to mirror the job description with measurable outcomes.");
    }

    return wins.length ? wins : ["This resume is aligned well. Use Gemini for final wording polish."];
  }, [analysis]);

  const handleCopyReport = async () => {
    if (!analysis) return;

    const report = buildReport(analysis, suggestions);
    await navigator.clipboard.writeText(report);
    setReportStatus("Report copied");
    window.setTimeout(() => setReportStatus(""), 1800);
  };

  const handleDownloadReport = () => {
    if (!analysis) return;

    const report = buildReport(analysis, suggestions);
    const url = URL.createObjectURL(new Blob([report], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "aptus-ats-report.txt";
    link.click();
    URL.revokeObjectURL(url);
    setReportStatus("Report downloaded");
    window.setTimeout(() => setReportStatus(""), 1800);
  };

  return (
    <main className="app-shell">
      <section className="hero">
        <div className="hero-copy">
          <p className="eyebrow">Aptus Resume ATS</p>
          <h1>Resume PDF + Job Description to ATS score, without burning API calls.</h1>
          <p>
            Aptus extracts resume text, matches job keywords locally, calculates the ATS
            score in your browser, and uses Gemini only when you ask for rewrite suggestions.
          </p>
          <div className="hero-actions" aria-label="Aptus highlights">
            <span><Gauge /> Local scoring</span>
            <span><SearchCheck /> Keyword gap scan</span>
            <span><Sparkles /> Optional AI polish</span>
          </div>
        </div>
        <div className="pipeline" aria-label="Aptus workflow">
          <PipelineStep icon={<FileText />} label="Resume PDF" state={resumeFile ? "done" : "idle"} />
          <ArrowDown />
          <PipelineStep icon={<Upload />} label="Extract Text" state={extractState} />
          <ArrowDown />
          <PipelineStep icon={<Target />} label="Keyword Match" state={analysis ? "done" : "idle"} />
          <ArrowDown />
          <PipelineStep icon={<BadgeCheck />} label="ATS Score" state={analysis ? "done" : "idle"} />
          <ArrowDown />
          <PipelineStep icon={<Brain />} label="AI Suggestions" state={suggestionState} />
        </div>
      </section>

      <section className="workspace">
        <div className="input-panel">
          <label className="upload-zone">
            <input
              type="file"
              accept=".pdf,.txt"
              onChange={(event) => void handleFile(event.target.files?.[0])}
            />
            <span className="upload-icon">
              {extractState === "working" ? <Loader2 className="spin" /> : <Upload />}
            </span>
            <span>{resumeFile ? resumeFile.name : "Upload resume PDF or text file"}</span>
          </label>

          <label className="field-label" htmlFor="resume-text">
            Extracted resume text
          </label>
          <textarea
            id="resume-text"
            value={resumeText}
            onChange={(event) => setResumeText(event.target.value)}
            placeholder="Your parsed resume text will appear here. You can paste or edit it too."
          />
        </div>

        <div className="input-panel">
          <label className="field-label" htmlFor="job-description">
            Job description
          </label>
          <textarea
            id="job-description"
            value={jobDescription}
            onChange={(event) => setJobDescription(event.target.value)}
            placeholder="Paste the full job description here. Aptus will extract role keywords locally."
          />

        </div>
      </section>

      {error ? (
        <div className="notice" role="alert">
          <AlertCircle />
          <span>{error}</span>
        </div>
      ) : null}

      <section className="results">
        <div className={`score-card ${scoreTone}`}>
          <div
            className="score-ring"
            style={{ "--score": analysis ? analysis.score : 0 } as React.CSSProperties}
            aria-label={analysis ? `ATS score ${analysis.score}` : "ATS score not available"}
          >
            <span>{analysis ? analysis.score : "--"}</span>
          </div>
          <div>
            <p className="eyebrow">ATS Score</p>
            <h2>{analysis ? scoreVerdict(analysis.score) : "Ready to scan"}</h2>
            <p>
              {analysis
                ? `${Math.round(analysis.coverage * 100)}% keyword coverage from ${analysis.jobWordCount} job terms.`
                : "Upload a resume and paste a job description to calculate the score."}
            </p>
          </div>
        </div>

        <Metric label="Resume words" value={analysis?.resumeWordCount ?? 0} />
        <Metric label="Keyword density" value={`${Math.round((analysis?.density ?? 0) * 100)}%`} />
        <Metric label="Format signals" value={`${Math.round((analysis?.formatScore ?? 0) * 100)}%`} />
      </section>

      <section className="insight-grid">
        <div className="breakdown-panel">
          <div>
            <p className="eyebrow">Score Breakdown</p>
            <h2>What moved the score</h2>
          </div>
          <ScoreBar label="Keyword coverage" value={analysis?.coverage ?? 0} />
          <ScoreBar label="Keyword density" value={analysis?.density ?? 0} />
          <ScoreBar label="Resume format" value={analysis?.formatScore ?? 0} />
        </div>

        <div className="quick-wins-panel">
          <div>
            <p className="eyebrow">Local Recommendations</p>
            <h2>Next best actions</h2>
          </div>
          <ol>
            {quickWins.map((win) => (
              <li key={win}>
                <ListChecks />
                <span>{win}</span>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="keyword-grid">
        <KeywordList
          title="Matched keywords"
          empty="Matched keywords will show here."
          items={analysis?.matchedKeywords ?? []}
        />
        <KeywordList
          title="Missing keywords"
          empty="Missing keywords will show here."
          items={analysis?.missingKeywords ?? []}
          muted
        />
      </section>

      <section className="suggestions-panel">
        <div className="suggestions-heading">
          <p className="eyebrow">Gemini Free API</p>
          <h2>AI only for suggestions</h2>
        </div>
        <div className="gemini-key-card">
          <label className="field-label" htmlFor="gemini-key">
            Gemini API key
          </label>
          <label className="api-row" htmlFor="gemini-key">
            <KeyRound />
            <input
              id="gemini-key"
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Paste Google Gemini API key"
            />
          </label>
          <div className="api-links">
            <a
              href="https://ai.google.dev/gemini-api/docs/api-key"
              target="_blank"
              rel="noreferrer"
            >
              Official API key docs
              <ExternalLink />
            </a>
            <a href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
              Create free key
              <ExternalLink />
            </a>
          </div>
        </div>
        <div className="suggestion-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => void handleCopyReport()}
            disabled={!analysis}
          >
            <Clipboard />
            Copy report
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={handleDownloadReport}
            disabled={!analysis}
          >
            <Download />
            Export
          </button>
          <button
            type="button"
            onClick={() => void handleSuggestions()}
            disabled={!analysis || !apiKey.trim() || suggestionState === "working"}
          >
            {suggestionState === "working" ? <Loader2 className="spin" /> : <Sparkles />}
            Generate suggestions
          </button>
        </div>
        {reportStatus ? <div className="report-status">{reportStatus}</div> : null}
        <pre>{suggestions || "Suggestions will appear here after the local ATS score is ready."}</pre>
      </section>
    </main>
  );
}

function PipelineStep({
  icon,
  label,
  state
}: {
  icon: React.ReactNode;
  label: string;
  state: StepState;
}) {
  return (
    <div className={`pipeline-step ${state}`}>
      {icon}
      <span>{label}</span>
      <small>{statusLabel[state]}</small>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const percent = Math.round(value * 100);

  return (
    <div className="score-bar">
      <div>
        <span>{label}</span>
        <strong>{percent}%</strong>
      </div>
      <progress value={percent} max="100" />
    </div>
  );
}

function KeywordList({
  title,
  empty,
  items,
  muted = false
}: {
  title: string;
  empty: string;
  items: { keyword: string; count: number; importance: number }[];
  muted?: boolean;
}) {
  return (
    <div className="keyword-panel">
      <h2>{title}</h2>
      <div className="chips">
        {items.length ? (
          items.slice(0, 24).map((item) => (
            <span className={muted ? "chip muted" : "chip"} key={item.keyword}>
              {item.keyword}
              {!muted ? <small>{item.count}</small> : null}
            </span>
          ))
        ) : (
          <p>{empty}</p>
        )}
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
