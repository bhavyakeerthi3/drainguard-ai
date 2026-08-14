"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";

type Detection = {
  class: string;
  score: number;
  bbox: [number, number, number, number];
};

type Analysis = {
  blockage: number;
  litter: number;
  confidence: number;
  objects: Detection[];
  signal: string;
};

type Detector = {
  detect: (image: HTMLImageElement) => Promise<Array<{ class: string; score: number; bbox: number[] }>>;
};

declare global {
  interface Window {
    cocoSsd?: { load: (options?: { base?: string }) => Promise<Detector> };
  }
}

const SAMPLE_ANALYSIS: Analysis = {
  blockage: 82,
  litter: 62,
  confidence: 91,
  signal: "Saved demo result",
  objects: [
    { class: "mixed litter", score: 0.91, bbox: [44, 48, 285, 190] },
    { class: "organic debris", score: 0.86, bbox: [180, 12, 260, 205] },
  ],
};

const queue = [
  { id: "DG-104", place: "5th Cross · Koramangala", risk: 84, status: "Dispatch now", x: 68, y: 31 },
  { id: "DG-098", place: "Market Road · Shantinagar", risk: 76, status: "Inspect today", x: 37, y: 52 },
  { id: "DG-091", place: "1st Main · Indiranagar", risk: 61, status: "Monitor", x: 76, y: 68 },
  { id: "DG-087", place: "8th Block · Jayanagar", risk: 35, status: "Verified clear", x: 29, y: 77 },
];

let detectorPromise: Promise<Detector> | null = null;

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing?.dataset.loaded === "true") return resolve();
    const script = existing ?? document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => {
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => reject(new Error("Model resource unavailable"));
    if (!existing) document.head.appendChild(script);
  });
}

async function getDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js");
      await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js");
      if (!window.cocoSsd) throw new Error("Vision model did not initialize");
      return window.cocoSsd.load({ base: "lite_mobilenet_v2" });
    })();
  }
  return detectorPromise;
}

function clamp(value: number, min = 0, max = 100) {
  return Math.min(max, Math.max(min, value));
}

async function loadImage(src: string) {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = src;
  await image.decode();
  return image;
}

function extractVisualSignals(image: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  const size = 96;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return { texture: 0.45, debrisTone: 0.4 };
  context.drawImage(image, 0, 0, size, size);
  const pixels = context.getImageData(0, 0, size, size).data;
  let dark = 0;
  let earthy = 0;
  let edge = 0;
  const luminance: number[] = [];

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    luminance.push(lum);
    if (lum < 72) dark += 1;
    if (r > b * 1.14 && g > b * 1.04 && r < 190) earthy += 1;
  }

  for (let y = 1; y < size; y += 1) {
    for (let x = 1; x < size; x += 1) {
      const current = luminance[y * size + x];
      const left = luminance[y * size + x - 1];
      const above = luminance[(y - 1) * size + x];
      if (Math.abs(current - left) + Math.abs(current - above) > 75) edge += 1;
    }
  }

  return {
    texture: edge / ((size - 1) * (size - 1)),
    debrisTone: (dark + earthy * 0.7) / (size * size),
  };
}

function scoreRisk(blockage: number, litter: number, rain: number) {
  const rainfallIndex = clamp((rain / 64) * 100);
  return Math.round(blockage * 0.55 + rainfallIndex * 0.3 + litter * 0.15);
}

function riskBand(risk: number) {
  if (risk >= 80) return { label: "Critical", tone: "critical" };
  if (risk >= 60) return { label: "High", tone: "high" };
  if (risk >= 40) return { label: "Watch", tone: "watch" };
  return { label: "Low", tone: "low" };
}

export default function Home() {
  const [imageUrl, setImageUrl] = useState("/demo-drain.jpg");
  const [fileName, setFileName] = useState("EGLE stormwater sample");
  const [analysis, setAnalysis] = useState<Analysis>(SAMPLE_ANALYSIS);
  const [mode, setMode] = useState<"surge" | "live">("surge");
  const [liveRain, setLiveRain] = useState(18);
  const [weatherStatus, setWeatherStatus] = useState("Bengaluru forecast");
  const [stage, setStage] = useState<"idle" | "loading" | "detecting" | "done">("idle");
  const [selectedSite, setSelectedSite] = useState(queue[0]);
  const [reportOpen, setReportOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [cleaned, setCleaned] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const rainfall = mode === "surge" ? 64 : liveRain;
  const risk = useMemo(
    () => (cleaned ? scoreRisk(16, 9, rainfall) : scoreRisk(analysis.blockage, analysis.litter, rainfall)),
    [analysis, cleaned, rainfall],
  );
  const band = riskBand(risk);

  useEffect(() => {
    const controller = new AbortController();
    fetch(
      "https://api.open-meteo.com/v1/forecast?latitude=12.9716&longitude=77.5946&daily=precipitation_sum,precipitation_probability_max&timezone=auto&forecast_days=1",
      { signal: controller.signal },
    )
      .then((response) => response.json())
      .then((data) => {
        const precipitation = Number(data?.daily?.precipitation_sum?.[0]);
        const probability = Number(data?.daily?.precipitation_probability_max?.[0]);
        if (Number.isFinite(precipitation)) setLiveRain(Math.max(precipitation, 1));
        if (Number.isFinite(probability)) setWeatherStatus(`${probability}% rain probability`);
      })
      .catch(() => setWeatherStatus("Forecast fallback"));
    return () => controller.abort();
  }, []);

  useEffect(() => {
    return () => {
      if (imageUrl.startsWith("blob:")) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) return;
    const nextUrl = URL.createObjectURL(file);
    setImageUrl(nextUrl);
    setFileName(file.name);
    setAnalysis({ blockage: 0, litter: 0, confidence: 0, objects: [], signal: "Ready to analyze" });
    setStage("idle");
    setCleaned(false);
  }

  async function runAnalysis() {
    setStage("loading");
    setCleaned(false);
    try {
      const image = await loadImage(imageUrl);
      const visual = extractVisualSignals(image);
      let predictions: Detection[] = [];
      let modelUsed = false;
      try {
        const detector = await getDetector();
        setStage("detecting");
        const raw = await detector.detect(image);
        predictions = raw
          .filter((item) => item.score >= 0.34)
          .slice(0, 5)
          .map((item) => ({
            class: item.class,
            score: item.score,
            bbox: [item.bbox[0], item.bbox[1], item.bbox[2], item.bbox[3]],
          }));
        modelUsed = true;
      } catch {
        setStage("detecting");
      }

      const litterObjects = predictions.filter((item) =>
        ["bottle", "cup", "book", "handbag", "backpack", "umbrella"].includes(item.class),
      ).length;
      const blockage = clamp(Math.round(24 + visual.debrisTone * 64 + visual.texture * 88 + litterObjects * 5), 14, 94);
      const litter = clamp(Math.round(14 + visual.texture * 105 + litterObjects * 18), 8, 96);
      const confidence = clamp(Math.round((modelUsed ? 78 : 59) + Math.min(predictions.length, 4) * 3), 0, 94);

      setAnalysis({
        blockage,
        litter,
        confidence,
        objects: predictions,
        signal: modelUsed ? "COCO-SSD + visual features" : "Visual features · offline fallback",
      });
      setStage("done");
    } catch {
      setAnalysis((current) => ({ ...current, signal: "Could not read this image" }));
      setStage("idle");
    }
  }

  function restoreSample() {
    setImageUrl("/demo-drain.jpg");
    setFileName("EGLE stormwater sample");
    setAnalysis(SAMPLE_ANALYSIS);
    setMode("surge");
    setCleaned(false);
    setStage("idle");
  }

  const report = `DRAINGUARD FIELD BRIEF · ${selectedSite.id}\nPriority: ${band.label.toUpperCase()} (${risk}/100)\nLocation: ${selectedSite.place}\nObserved blockage: ${cleaned ? 16 : analysis.blockage}%\nLitter signal: ${cleaned ? 9 : analysis.litter}%\nRain scenario: ${rainfall.toFixed(1)} mm / 24h\n\nRecommended action: ${risk >= 80 ? "Dispatch a cleanup crew before the next rainfall window. Photograph the cleared inlet to close the task." : risk >= 60 ? "Inspect and clear within 24 hours." : "Monitor and re-check after rainfall."}\n\nThis is a prioritization aid, not a flood prediction or emergency alert.`;

  async function copyReport() {
    await navigator.clipboard.writeText(report);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <main>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="DrainGuard home">
          <span className="brand-mark">DG</span>
          <span>DrainGuard <i>AI</i></span>
        </a>
        <div className="pilot-pill"><span /> Bengaluru pilot · Live</div>
        <nav aria-label="Primary navigation">
          <a href="#inspect">Inspect</a>
          <a href="#queue">Priority map</a>
          <a href="#method">Method</a>
        </nav>
        <button className="button button-small" onClick={() => fileInput.current?.click()}>+ New inspection</button>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow"><span>Monsoon readiness</span><span>Ward 151</span></div>
          <h1>Find the drain<br />that fails <em>next.</em></h1>
          <p>Turn one street photo into an explainable cleanup priority—before rain turns litter into flooding and waterway pollution.</p>
          <div className="hero-actions">
            <a className="button" href="#inspect">Run an inspection <span>→</span></a>
            <button className="text-button" onClick={restoreSample}>Watch sample analysis <span>↘</span></button>
          </div>
        </div>
        <div className="hero-proof" aria-label="Pilot impact snapshot">
          <div className="proof-head"><span>Today’s readiness</span><span className="live-dot">Updated now</span></div>
          <div className="proof-grid">
            <div><strong>12</strong><span>drains checked</span></div>
            <div><strong>4</strong><span>need action</span></div>
            <div><strong>2.8<span>kg</span></strong><span>estimated litter intercepted</span></div>
          </div>
          <div className="proof-line"><span style={{ width: "76%" }} /></div>
          <div className="proof-foot"><span>76% of pilot zone inspected</span><span>4 left</span></div>
        </div>
      </section>

      <section className="inspection-section" id="inspect">
        <div className="section-intro">
          <div>
            <span className="kicker">01 · Inspect</span>
            <h2>Photo in. Priority out.</h2>
          </div>
          <p>The model runs on the image, then a transparent risk formula combines obstruction, litter, and rainfall. No black-box flood claims.</p>
        </div>

        <div className="inspection-shell">
          <div className="photo-panel">
            <div className="panel-bar">
              <div><span className="camera-dot" /> Street image</div>
              <div className="file-name" title={fileName}>{fileName}</div>
            </div>
            <div className="photo-stage">
              <img id="inspection-image" src={imageUrl} alt="Storm drain submitted for inspection" />
              <div className="scan-grid" aria-hidden="true" />
              {analysis.objects.map((object, index) => {
                const image = typeof document !== "undefined" ? document.getElementById("inspection-image") as HTMLImageElement | null : null;
                const naturalWidth = image?.naturalWidth || 900;
                const naturalHeight = image?.naturalHeight || 600;
                return (
                  <div
                    className="detection-box"
                    key={`${object.class}-${index}`}
                    style={{
                      left: `${(object.bbox[0] / naturalWidth) * 100}%`,
                      top: `${(object.bbox[1] / naturalHeight) * 100}%`,
                      width: `${(object.bbox[2] / naturalWidth) * 100}%`,
                      height: `${(object.bbox[3] / naturalHeight) * 100}%`,
                    }}
                  >
                    <span>{object.class} · {Math.round(object.score * 100)}%</span>
                  </div>
                );
              })}
              <span className="photo-location">5th Cross · Koramangala</span>
              <span className="photo-time">14 Aug · 18:42</span>
            </div>
            <div className="photo-actions">
              <input ref={fileInput} onChange={chooseImage} type="file" accept="image/*" hidden aria-label="Upload a drain photo" />
              <button className="button button-outline" onClick={() => fileInput.current?.click()}>Choose a photo</button>
              <button className="button button-dark" disabled={stage === "loading" || stage === "detecting"} onClick={runAnalysis}>
                {stage === "loading" ? "Loading edge model…" : stage === "detecting" ? "Reading the scene…" : "Analyze with AI"}
              </button>
              <button className="sample-link" onClick={restoreSample}>Reset sample</button>
            </div>
          </div>

          <aside className="result-panel" aria-live="polite">
            <div className="result-topline"><span>Risk assessment</span><span>{analysis.signal}</span></div>
            <div className={`risk-score ${band.tone}`}>
              <div><strong>{risk}</strong><span>/100</span></div>
              <div><span className="risk-label">{band.label}</span><small>cleanup priority</small></div>
            </div>
            <div className="risk-meter"><span style={{ width: `${risk}%` }} /></div>

            <div className="signal-list">
              <div className="signal-row">
                <div><span className="signal-icon">◩</span><span>Drain obstruction<small>Visual occlusion estimate</small></span></div>
                <strong>{cleaned ? 16 : analysis.blockage}%</strong>
              </div>
              <div className="signal-row">
                <div><span className="signal-icon">⌁</span><span>Rainfall exposure<small>{mode === "surge" ? "Demo monsoon scenario" : weatherStatus}</small></span></div>
                <strong>{rainfall.toFixed(1)}<small> mm</small></strong>
              </div>
              <div className="signal-row">
                <div><span className="signal-icon">◇</span><span>Litter signal<small>Objects + visual texture</small></span></div>
                <strong>{cleaned ? 9 : analysis.litter}%</strong>
              </div>
            </div>

            <div className="scenario-control">
              <span>Weather scenario</span>
              <div>
                <button className={mode === "live" ? "active" : ""} onClick={() => setMode("live")}>Live</button>
                <button className={mode === "surge" ? "active" : ""} onClick={() => setMode("surge")}>Heavy rain</button>
              </div>
            </div>

            <div className="recommendation">
              <span>Recommended next step</span>
              <p>{risk >= 80 ? "Dispatch a cleanup crew before the next rainfall window." : risk >= 60 ? "Inspect and clear this inlet within 24 hours." : "Keep on the watchlist and re-check after rainfall."}</p>
            </div>
            <button className="button button-full" onClick={() => setReportOpen(true)}>Generate field brief <span>→</span></button>
            <p className="confidence">Model confidence {analysis.confidence}% · human verification required</p>
          </aside>
        </div>
      </section>

      <section className="queue-section" id="queue">
        <div className="section-intro compact">
          <div>
            <span className="kicker">02 · Prioritize</span>
            <h2>One queue for the whole ward.</h2>
          </div>
          <p>Crews see the highest-risk inlet first—not simply the newest report.</p>
        </div>

        <div className="queue-grid">
          <div className="map-card" aria-label="Priority map of inspected drains">
            <div className="map-top"><span>Ward 151 · Koramangala</span><span>12 inspections</span></div>
            <div className="map-canvas">
              <div className="road road-a" /><div className="road road-b" /><div className="road road-c" /><div className="road road-d" />
              <div className="waterway">Vrishabhavathi feeder</div>
              {queue.map((site) => (
                <button
                  key={site.id}
                  className={`map-pin risk-${riskBand(site.risk).tone} ${selectedSite.id === site.id ? "selected" : ""}`}
                  style={{ left: `${site.x}%`, top: `${site.y}%` }}
                  onClick={() => setSelectedSite(site)}
                  aria-label={`${site.id}, risk ${site.risk}`}
                >{site.risk}</button>
              ))}
              <div className="map-key"><span><i className="key-critical" /> Critical</span><span><i className="key-watch" /> Watch</span><span><i className="key-low" /> Clear</span></div>
            </div>
          </div>

          <div className="queue-card">
            <div className="queue-heading"><span>Cleanup queue</span><span>Sorted by risk</span></div>
            {queue.map((site, index) => (
              <button className={`queue-row ${selectedSite.id === site.id ? "active" : ""}`} key={site.id} onClick={() => setSelectedSite(site)}>
                <span className="queue-rank">0{index + 1}</span>
                <span className="queue-place"><strong>{site.place}</strong><small>{site.id} · {site.status}</small></span>
                <span className={`queue-risk ${riskBand(site.risk).tone}`}>{site.risk}</span>
              </button>
            ))}
            <div className="selected-summary">
              <span>Selected</span>
              <strong>{selectedSite.id}</strong>
              <p>{selectedSite.status}. Evidence is ready for the field brief.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="verification-section">
        <div className="verification-copy">
          <span className="kicker">03 · Verify</span>
          <h2>Close the loop,<br />not just the ticket.</h2>
          <p>A second photo verifies that the inlet is clear and updates the ward’s readiness score. Every intervention becomes measurable evidence.</p>
          <button className={`button ${cleaned ? "button-success" : ""}`} onClick={() => setCleaned((value) => !value)}>
            {cleaned ? "✓ Cleanup verified" : "Simulate after-cleanup photo"}
          </button>
        </div>
        <div className={`verification-card ${cleaned ? "is-clean" : ""}`}>
          <div className="verify-visual">
            <img src="/demo-drain.jpg" alt="Drain before cleanup" />
            <div className="clean-mask"><span>Flow restored</span></div>
          </div>
          <div className="verify-stats">
            <div><span>Risk</span><strong>{cleaned ? "23" : "84"}<small>/100</small></strong></div>
            <div><span>Obstruction</span><strong>{cleaned ? "16" : "82"}<small>%</small></strong></div>
            <div><span>Status</span><strong className="status-text">{cleaned ? "Clear" : "Open"}</strong></div>
          </div>
        </div>
      </section>

      <section className="method-section" id="method">
        <div className="method-head">
          <span className="kicker">How the intelligence works</span>
          <h2>AI proposes. Evidence explains.<br />People decide.</h2>
        </div>
        <div className="method-grid">
          <article><span>01</span><h3>See</h3><p>On-device COCO-SSD identifies visible litter objects; image features estimate texture and occlusion.</p></article>
          <article><span>02</span><h3>Score</h3><p>A published formula weights blockage 55%, rainfall 30%, and litter 15% into one priority score.</p></article>
          <article><span>03</span><h3>Act</h3><p>The system ranks inspections and generates a concise, traceable field brief for cleanup teams.</p></article>
          <article><span>04</span><h3>Verify</h3><p>A before/after record closes the task. Low-confidence cases stay flagged for human review.</p></article>
        </div>
        <div className="responsibility-note">
          <strong>Responsible use</strong>
          <p>DrainGuard prioritizes inspections; it does not predict floods or replace engineering assessment. Scores depend on image quality and local rainfall data.</p>
          <span>Prototype v0.9</span>
        </div>
      </section>

      <footer>
        <div className="brand footer-brand"><span className="brand-mark">DG</span><span>DrainGuard <i>AI</i></span></div>
        <p>See a drain. Stop a flood.</p>
        <div><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather: Open-Meteo</a><a href="https://www.michigan.gov/egle/about/organization/water-resources/stormwater" target="_blank" rel="noreferrer">Sample image: Michigan EGLE</a></div>
      </footer>

      {reportOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setReportOpen(false)}>
          <section className="report-modal" role="dialog" aria-modal="true" aria-labelledby="report-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setReportOpen(false)} aria-label="Close field brief">×</button>
            <span className="kicker">Actionable evidence</span>
            <h2 id="report-title">Field brief ready.</h2>
            <pre>{report}</pre>
            <div className="modal-actions">
              <button className="button" onClick={copyReport}>{copied ? "✓ Copied" : "Copy brief"}</button>
              <button className="button button-outline" onClick={() => { setReportOpen(false); setCleaned(true); }}>Mark dispatched</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
