"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import NextImage from "next/image";
import { DrainMap, type MapSite } from "./DrainMap";
import {
  ActionPlanner,
  DemoMode,
  EnvironmentalDashboard,
  JudgeQuestions,
  PriorityExplanation,
  PriorityShockPanel,
  RainfallScenarioExplorer,
  TrustPanel,
  ValidationPanel,
  WorkflowComparison,
  VerificationChecklist,
  type DemoScenario,
  type VerificationCheck,
} from "./EnvironmentalPanels";
import { inspectionDecision, passesCleanupVerification, priorityAction, SAME_DRAIN_THRESHOLD } from "../lib/decisions.js";
import type { EnvironmentalContextResponse } from "../lib/environment.ts";
import { calculateEnvironmentalRisk, type WaterwayContext } from "../lib/scoring/environmentalRisk.ts";
import { calculatePriorityScore, recommendedAction, scoreLevel } from "../lib/scoring/priority.ts";
import { calculateRainfallScenarios } from "../lib/scoring/rainfallScenarios.ts";
import blockageModelMetadata from "../public/models/drain-blockage-resnet50-v1.json";
import {
  calculateBaseVisionScores,
  calculateDrainConfidence,
  clamp,
  compareSceneFingerprints,
  extractVisualSignalsFromRgba,
} from "../lib/vision.js";

type Detection = {
  class: string;
  score: number;
  bbox: [number, number, number, number];
};

type Analysis = {
  blockage: number;
  litter: number;
  confidence: number;
  drainConfidence?: number;
  fingerprint?: number[];
  objects: Detection[];
  signal: string;
};

type VerificationResult = Analysis & {
  reduction: number;
  sceneMatch: number;
  sameDrain: boolean;
  verified: boolean;
};

const modelEvaluation = { test: blockageModelMetadata.evaluation };

type EvidenceRecord = {
  beforeImage: string;
  beforeName: string;
  beforeAnalysis: Analysis;
  afterImage?: string;
  afterName?: string;
  verification?: VerificationResult;
  updatedAt: string;
};

type PersistedPilot = {
  version: 3;
  sites: MapSite[];
  evidence: Record<string, EvidenceRecord>;
  reviewDecisions?: Record<string, "open" | "approved" | "request-photo">;
};

type Detector = {
  detect: (image: HTMLImageElement) => Promise<Array<{ class: string; score: number; bbox: number[] }>>;
};

type BlockageModelMetadata = {
  model: string;
  threshold: number;
};

type BlockageClassifier = {
  session: {
    run: (feeds: Record<string, unknown>) => Promise<Record<string, { data: ArrayLike<number> }>>;
  };
  metadata: BlockageModelMetadata;
};

declare global {
  interface Window {
    cocoSsd?: { load: (options?: { base?: string }) => Promise<Detector> };
    ort?: {
      env: { wasm: { wasmPaths: string; numThreads: number } };
      Tensor: new (type: "float32", data: Float32Array, dimensions: number[]) => unknown;
      InferenceSession: { create: (model: string, options: { executionProviders: string[] }) => Promise<BlockageClassifier["session"]> };
    };
  }
}

const SAMPLE_ANALYSIS: Analysis = {
  blockage: 82,
  litter: 62,
  confidence: 91,
  drainConfidence: 94,
  signal: "Drain-domain gate + litter detector",
  objects: [
    { class: "mixed litter", score: 0.91, bbox: [4, 8, 32, 32] },
    { class: "organic debris", score: 0.86, bbox: [20, 2, 29, 34] },
  ],
};

const INITIAL_SITES: MapSite[] = [
  { id: "DG-104", place: "5th Cross · Koramangala", risk: 84, environmentalRisk: 87, environmentalLevel: "critical", environmentalDistanceMeters: 180, environmentalContext: "Demo: mapped stream approximately 180 m away", status: "Dispatch now", lat: 12.9352, lon: 77.6245, rainfall: 18, blockage: 82, litter: 62, recommendedAction: "Inspect and clean as soon as operationally practical.", photo: "/demo-drain.jpg", isDemo: true },
  { id: "DG-098", place: "Market Road · Shantinagar", risk: 76, environmentalRisk: 73, environmentalLevel: "high", environmentalDistanceMeters: 520, environmentalContext: "Demo: mapped canal approximately 520 m away", status: "Inspect today", lat: 12.9536, lon: 77.5937, rainfall: 18, blockage: 68, litter: 58, recommendedAction: "Schedule inspection and cleanup within 24 hours.", photo: "/demo-drain.jpg", isDemo: true },
  { id: "DG-091", place: "1st Main · Indiranagar", risk: 61, environmentalRisk: 58, environmentalLevel: "moderate", environmentalDistanceMeters: null, environmentalContext: "Demo: environmental context unavailable", status: "Needs review", lat: 12.9784, lon: 77.6408, rainfall: 18, blockage: 56, litter: 44, recommendedAction: "Human review required before dispatch.", photo: "/demo-drain.jpg", isDemo: true },
  { id: "DG-087", place: "8th Block · Jayanagar", risk: 35, environmentalRisk: 31, environmentalLevel: "low", environmentalDistanceMeters: 1100, environmentalContext: "Demo: nearest mapped water feature approximately 1.1 km away", status: "Verified clear", lat: 12.925, lon: 77.5938, rainfall: 18, blockage: 28, litter: 22, recommendedAction: "Cleanup verified. Continue routine monitoring.", photo: "/demo-drain.jpg", isDemo: true },
];

const PILOT_STORAGE_KEY = "drainguard-pilot:v2";
const LEGACY_STORAGE_KEY = "drainguard-pilot-v1";

const DEMO_SCENARIOS: DemoScenario[] = [
  { id: "clear", title: "Low-risk clear drain", description: "Low blockage and little visible litter.", blockage: 22, litter: 16, rainfallMm: 2, status: "Monitor", environmentalDistanceMeters: 1200 },
  { id: "moderate", title: "Moderate blockage", description: "Visible obstruction needs routine inspection.", blockage: 52, litter: 38, rainfallMm: 8, status: "Monitor", environmentalDistanceMeters: 680 },
  { id: "litter", title: "Heavy blockage + litter", description: "Strong visible evidence raises cleanup urgency.", blockage: 88, litter: 84, rainfallMm: 6, status: "Dispatch now", environmentalDistanceMeters: 880 },
  { id: "rainfall", title: "Heavy blockage + rainfall", description: "The same evidence under a heavy-rain scenario.", blockage: 84, litter: 58, rainfallMm: 64, status: "Dispatch now", environmentalDistanceMeters: 820 },
  { id: "waterway", title: "Near mapped waterway", description: "High concern with mapped environmental context.", blockage: 78, litter: 72, rainfallMm: 28, status: "Dispatch now", environmentalDistanceMeters: 140 },
  { id: "verified", title: "Verified cleanup", description: "A successful same-scene before/after decision.", blockage: 28, litter: 24, rainfallMm: 12, status: "Verified clear", environmentalDistanceMeters: 420 },
  { id: "review", title: "Human review required", description: "Uncertain evidence remains open for a person.", blockage: 67, litter: 51, rainfallMm: 18, status: "Needs review", environmentalDistanceMeters: null },
];

const JUDGE_STEPS = [
  { id: "detect", label: "See", title: "A crew receives a report.", copy: "We begin with visible evidence from the street: a blocked drain, litter, and the current rainfall context.", hint: "Visible evidence first · controlled demonstration data" },
  { id: "prioritize", label: "Understand", title: "How serious is it?", copy: "The system turns blockage, visible litter, and rainfall into an explainable inspection priority.", hint: "Why this one? Every point has a visible reason." },
  { id: "shock", label: "Adapt", title: "The drains did not change. The conditions did.", copy: "Move the rainfall scenario and watch scores, rankings, and urgency respond using the same evidence.", hint: "Scenario exploration · not a forecast or flood prediction" },
  { id: "act", label: "Decide", title: "One crew. A clear action plan.", copy: "We cannot inspect everything, so DrainGuard turns priority into an explainable plan within today's capacity.", hint: "Action Planner · top reports within today's capacity" },
  { id: "verify", label: "Verify", title: "Cleanup needs evidence.", copy: "A second image must match the same scene and show meaningful improvement before the report can close.", hint: "Upload an after photo to run the real verification gate" },
  { id: "close", label: "Close the loop", title: "Detection alone is not the finish line.", copy: "DrainGuard supports the decision, the action, and the verification. Uncertain evidence stays visible for human review.", hint: "Verified clear appears only when the evidence passes" },
] as const;

const UNAVAILABLE_WATERWAY: WaterwayContext = {
  status: "unavailable",
  distanceMeters: null,
  source: "OpenStreetMap / Overpass",
  message: "Environmental context unavailable. No proximity value was fabricated.",
};

let detectorPromise: Promise<Detector> | null = null;
let blockageClassifierPromise: Promise<BlockageClassifier> | null = null;

function loadScript(src: string) {
  return new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${src}"]`);
    if (existing?.dataset.loaded === "true") return resolve();
    const script = existing ?? document.createElement("script");
    script.src = src;
    script.async = true;
    const timeout = window.setTimeout(() => reject(new Error("Model resource timed out")), 15000);
    script.onload = () => {
      window.clearTimeout(timeout);
      script.dataset.loaded = "true";
      resolve();
    };
    script.onerror = () => {
      window.clearTimeout(timeout);
      reject(new Error("Model resource unavailable"));
    };
    if (!existing) document.head.appendChild(script);
  });
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timeout = window.setTimeout(() => reject(new Error("Vision model timed out")), timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timeout);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timeout);
        reject(error);
      },
    );
  });
}

async function getDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow/tfjs@4.22.0/dist/tf.min.js");
      await loadScript("https://cdn.jsdelivr.net/npm/@tensorflow-models/coco-ssd@2.2.3/dist/coco-ssd.min.js");
      if (!window.cocoSsd) throw new Error("Vision model did not initialize");
      return withTimeout(window.cocoSsd.load({ base: "lite_mobilenet_v2" }), 25000);
    })();
  }
  try {
    return await detectorPromise;
  } catch (error) {
    detectorPromise = null;
    throw error;
  }
}

async function getBlockageClassifier() {
  if (!blockageClassifierPromise) {
    blockageClassifierPromise = (async () => {
      await loadScript("https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/ort.min.js");
      if (!window.ort) throw new Error("Blockage model runtime did not initialize");
      window.ort.env.wasm.wasmPaths = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/";
      window.ort.env.wasm.numThreads = 1;
      const response = await fetch("/models/drain-blockage-resnet50-v1.json");
      if (!response.ok) throw new Error("Blockage model metadata unavailable");
      const metadata = await response.json() as BlockageModelMetadata;
      const session = await window.ort.InferenceSession.create(metadata.model, { executionProviders: ["wasm"] });
      return { session, metadata };
    })();
  }
  try {
    return await blockageClassifierPromise;
  } catch (error) {
    blockageClassifierPromise = null;
    throw error;
  }
}

async function loadImage(src: string) {
  const image = new Image();
  image.crossOrigin = "anonymous";
  image.src = src;
  await image.decode();
  return image;
}

async function fileToStoredImage(file: File) {
  const temporaryUrl = URL.createObjectURL(file);
  try {
    const image = await loadImage(temporaryUrl);
    const maxDimension = 960;
    const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Image canvas unavailable");
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.74);
  } finally {
    URL.revokeObjectURL(temporaryUrl);
  }
}

function extractVisualSignals(image: HTMLImageElement) {
  const canvas = document.createElement("canvas");
  const size = 96;
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return extractVisualSignalsFromRgba([], 0, 0);
  context.drawImage(image, 0, 0, size, size);
  const pixels = context.getImageData(0, 0, size, size).data;
  return extractVisualSignalsFromRgba(pixels, size, size);
}

async function classifyBlockage(image: HTMLImageElement) {
  const classifier = await getBlockageClassifier();
  if (!window.ort) throw new Error("Blockage model runtime unavailable");
  const size = 224;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("Blockage model canvas unavailable");
  context.drawImage(image, 0, 0, size, size);
  const pixels = context.getImageData(0, 0, size, size).data;
  const tensorData = new Float32Array(3 * size * size);
  const means = [0.485, 0.456, 0.406];
  const deviations = [0.229, 0.224, 0.225];
  for (let pixelIndex = 0; pixelIndex < size * size; pixelIndex += 1) {
    for (let channel = 0; channel < 3; channel += 1) {
      tensorData[channel * size * size + pixelIndex] = (pixels[pixelIndex * 4 + channel] / 255 - means[channel]) / deviations[channel];
    }
  }
  const tensor = new window.ort.Tensor("float32", tensorData, [1, 3, size, size]);
  const result = await classifier.session.run({ image: tensor });
  const probability = Number(result.blocked_probability.data[0]);
  return { probability, threshold: classifier.metadata.threshold };
}

function combineDrainConfidence(baseConfidence: number, classification: { probability: number } | null) {
  if (!classification || baseConfidence < 38) return baseConfidence;
  const certainty = Math.abs(classification.probability - 0.5) * 2;
  if (certainty < 0.6) return baseConfidence;
  return Math.max(baseConfidence, clamp(Math.round(55 + certainty * 35), 0, 94));
}

function scoreRisk(blockage: number, litter: number, rain: number | null | undefined) {
  return calculatePriorityScore({ blockage, litter, rainfallMm: rain ?? null }).score;
}

function riskBand(risk: number) {
  const level = scoreLevel(risk);
  if (level === "critical") return { label: "Critical", tone: "critical" };
  if (level === "high") return { label: "High", tone: "high" };
  if (level === "moderate") return { label: "Watch", tone: "watch" };
  return { label: "Low", tone: "low" };
}

function confidenceLabel(value: number) {
  if (value >= 80) return "Strong visual evidence";
  if (value >= 60) return "Usable with review";
  return "Uncertain · human review";
}

function modelLabel(signal: string) {
  if (signal.includes("Research ResNet-50")) return "Research ResNet-50 blockage classifier";
  if (signal.includes("Visual fallback")) return "Visual texture fallback";
  if (signal.includes("Demo scenario")) return "Controlled demo evidence";
  return "Drain-domain evidence gate";
}

function waterwayContextForSite(site: MapSite): WaterwayContext {
  if (typeof site.environmentalDistanceMeters === "number") {
    return {
      status: "available",
      distanceMeters: site.environmentalDistanceMeters,
      source: "OpenStreetMap / Overpass",
      message: site.environmentalContext ?? `Mapped water feature approximately ${site.environmentalDistanceMeters} m away.`,
    };
  }
  return UNAVAILABLE_WATERWAY;
}

function queueReason(site: MapSite) {
  if (site.status === "Verified clear") return "Cleanup verified · routine monitoring";
  if (site.status === "Needs review") return "Uncertain evidence · human review";
  if ((site.blockage ?? 0) >= 75 && (site.rainfall ?? 0) >= 25) return "Heavy obstruction + rainfall exposure";
  if ((site.blockage ?? 0) >= 60 || (site.litter ?? 0) >= 60) return "Visible obstruction + litter evidence";
  return "Lower-risk report · monitor conditions";
}

export default function Home() {
  const [imageUrl, setImageUrl] = useState("/demo-drain.jpg");
  const [fileName, setFileName] = useState("EGLE stormwater sample");
  const [imageError, setImageError] = useState("");
  const [analysis, setAnalysis] = useState<Analysis>(SAMPLE_ANALYSIS);
  const [mode, setMode] = useState<"surge" | "live">("live");
  const [scenarioRainfall, setScenarioRainfall] = useState(64);
  const [weatherStatus, setWeatherStatus] = useState("Sample rainfall scenario");
  const [waterwayContext, setWaterwayContext] = useState<WaterwayContext>(() => waterwayContextForSite(INITIAL_SITES[0]));
  const [stage, setStage] = useState<"idle" | "loading" | "detecting" | "done">("idle");
  const [sites, setSites] = useState<MapSite[]>(INITIAL_SITES);
  const [selectedSite, setSelectedSite] = useState<MapSite>(INITIAL_SITES[0]);
  const [locationInput, setLocationInput] = useState("");
  const [locationStatus, setLocationStatus] = useState("");
  const [locating, setLocating] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [cleaned, setCleaned] = useState(false);
  const [verificationImageUrl, setVerificationImageUrl] = useState<string | null>(null);
  const [verificationFileName, setVerificationFileName] = useState("");
  const [verificationResult, setVerificationResult] = useState<VerificationResult | null>(null);
  const [verificationStage, setVerificationStage] = useState<"idle" | "loading" | "detecting" | "done">("idle");
  const [verificationReveal, setVerificationReveal] = useState<"idle" | "checking" | "measuring" | "verified" | "review">("idle");
  const [evidenceBySite, setEvidenceBySite] = useState<Record<string, EvidenceRecord>>({});
  const [reviewDecisions, setReviewDecisions] = useState<Record<string, "open" | "approved" | "request-photo">>({});
  const [judgeMode, setJudgeMode] = useState(false);
  const [judgeStep, setJudgeStep] = useState(0);
  const [pitchMode, setPitchMode] = useState(false);
  const [crewCount, setCrewCount] = useState(1);
  const [inspectionCapacity, setInspectionCapacity] = useState(2);
  const [rippleVersion, setRippleVersion] = useState(0);
  const [comparisonMode, setComparisonMode] = useState<"side-by-side" | "slider">("side-by-side");
  const [comparisonSplit, setComparisonSplit] = useState(50);
  const [persistenceReady, setPersistenceReady] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const verificationInput = useRef<HTMLInputElement>(null);
  const nextLocationId = useRef(105);

  const rainfall = mode === "surge" ? scenarioRainfall : (selectedSite.rainfall ?? null);
  const effectiveAnalysis = cleaned && verificationResult ? verificationResult : analysis;
  const priorityResult = useMemo(() => calculatePriorityScore({
    blockage: effectiveAnalysis.blockage,
    litter: effectiveAnalysis.litter,
    rainfallMm: rainfall,
    evidenceConfidence: effectiveAnalysis.confidence,
  }), [effectiveAnalysis.blockage, effectiveAnalysis.confidence, effectiveAnalysis.litter, rainfall]);
  const environmentalResult = useMemo(() => calculateEnvironmentalRisk({
    blockage: effectiveAnalysis.blockage,
    litter: effectiveAnalysis.litter,
    rainfallMm: rainfall,
    waterway: waterwayContext,
    evidenceConfidence: effectiveAnalysis.confidence,
  }), [effectiveAnalysis.blockage, effectiveAnalysis.confidence, effectiveAnalysis.litter, rainfall, waterwayContext]);
  const scenarios = useMemo(() => calculateRainfallScenarios({
    blockage: effectiveAnalysis.blockage,
    litter: effectiveAnalysis.litter,
    waterway: waterwayContext,
    evidenceConfidence: effectiveAnalysis.confidence,
  }), [effectiveAnalysis.blockage, effectiveAnalysis.confidence, effectiveAnalysis.litter, waterwayContext]);
  const queueSites = useMemo(() => sites.map((site) => {
    const rainfallForSite = mode === "surge" ? scenarioRainfall : (site.rainfall ?? null);
    const priority = calculatePriorityScore({
      blockage: site.blockage ?? site.risk,
      litter: site.litter ?? 0,
      rainfallMm: rainfallForSite,
      evidenceConfidence: 70,
    });
    const environmental = calculateEnvironmentalRisk({
      blockage: site.blockage ?? site.risk,
      litter: site.litter ?? 0,
      rainfallMm: rainfallForSite,
      waterway: waterwayContextForSite(site),
      evidenceConfidence: 70,
    });
    const preservedStatus = ["Needs review", "Verified clear"].includes(site.status);
    return {
      ...site,
      risk: priority.score,
      environmentalRisk: environmental.score,
      environmentalLevel: environmental.level,
      rainfall: rainfallForSite ?? undefined,
      status: preservedStatus ? site.status : priorityAction(priority.score),
      recommendedAction: recommendedAction(priority.score, site.status === "Verified clear"),
    };
  }), [mode, scenarioRainfall, sites]);
  const risk = priorityResult.score;
  const band = riskBand(risk);
  const action = !cleaned && stage === "done" && (effectiveAnalysis.drainConfidence ?? effectiveAnalysis.confidence) < 60
    ? "Human review required before dispatch."
    : recommendedAction(risk, cleaned);
  const sortedSites = useMemo(() => [...queueSites].sort((a, b) => b.risk - a.risk), [queueSites]);
  const reviewSites = useMemo(() => queueSites.filter((site) => site.status === "Needs review"), [queueSites]);
  const selectedRank = Math.max(1, sortedSites.findIndex((site) => site.id === selectedSite.id) + 1);
  const verifiedRiskReduction = verificationResult?.verified
    ? Math.max(0, scoreRisk(analysis.blockage, analysis.litter, rainfall) - risk)
    : null;
  const verificationBeforeRisk = scoreRisk(analysis.blockage, analysis.litter, rainfall);
  const verificationAfterRisk = verificationResult
    ? scoreRisk(verificationResult.blockage, verificationResult.litter, rainfall)
    : null;
  const dashboardRecords = useMemo(() => queueSites.map((site) => ({
    ...site,
    verifiedReduction: evidenceBySite[site.id]?.verification?.verified
      ? evidenceBySite[site.id].verification?.reduction
      : undefined,
  })), [evidenceBySite, queueSites]);
  const verificationChecks = useMemo<VerificationCheck[]>(() => {
    if (!verificationResult) {
      return [
        { label: "Same scene confidence", detail: "Waiting for an after photo.", state: "waiting" },
        { label: "Drain evidence", detail: "Waiting for an after photo.", state: "waiting" },
        { label: "Obstruction improved", detail: "Requires at least a 15-point reduction.", state: "waiting" },
        { label: "Litter threshold", detail: "Residual litter must be 48 or lower.", state: "waiting" },
      ];
    }
    return [
      { label: "Same scene confidence", detail: `${verificationResult.sceneMatch ?? 0}% match; ${SAME_DRAIN_THRESHOLD}% required.`, state: verificationResult.sameDrain ? "pass" : "fail" },
      { label: "Drain evidence", detail: `${verificationResult.drainConfidence ?? 0}% confidence; 60% required.`, state: (verificationResult.drainConfidence ?? 0) >= 60 ? "pass" : "fail" },
      { label: "Obstruction improved", detail: `${verificationResult.reduction}-point reduction; 15 required.`, state: verificationResult.reduction >= 15 ? "pass" : "fail" },
      { label: "Litter threshold", detail: `${verificationResult.litter}/100 residual litter; maximum 48.`, state: verificationResult.litter <= 48 ? "pass" : "fail" },
    ];
  }, [verificationResult]);
  const verificationFailureReason = verificationChecks
    .filter((check) => check.state === "fail")
    .map((check) => `${check.label}: ${check.detail}`)
    .join(" ");

  /* eslint-disable react-hooks/set-state-in-effect -- The staged reveal is a deliberate presentation of one completed verification result. */
  useEffect(() => {
    if (!verificationResult) {
      setVerificationReveal("idle");
      return;
    }
    if (!verificationResult.verified) {
      setVerificationReveal("review");
      return;
    }
    setVerificationReveal("checking");
    const measuringTimer = window.setTimeout(() => setVerificationReveal("measuring"), 700);
    const verifiedTimer = window.setTimeout(() => setVerificationReveal("verified"), 1500);
    return () => {
      window.clearTimeout(measuringTimer);
      window.clearTimeout(verifiedTimer);
    };
  }, [verificationResult]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    const controller = new AbortController();
    const targetSiteId = selectedSite.id;

    async function loadEnvironmentalContext() {
      if (selectedSite.isDemo) {
        const context = typeof selectedSite.environmentalDistanceMeters === "number" ? {
          status: "available" as const,
          distanceMeters: selectedSite.environmentalDistanceMeters,
          source: "OpenStreetMap / Overpass" as const,
          message: selectedSite.environmentalContext ?? `Demo scenario: mapped water feature approximately ${selectedSite.environmentalDistanceMeters} m away.`,
        } : UNAVAILABLE_WATERWAY;
        setWeatherStatus(`Sample data · ${selectedSite.place}`);
        setWaterwayContext(context);
        return;
      }

      setWeatherStatus(`Loading live rainfall · ${selectedSite.place}`);
      setWaterwayContext({
        status: "loading",
        distanceMeters: null,
        source: "OpenStreetMap / Overpass",
        message: "Checking mapped waterways near this report…",
      });
      let data: Pick<EnvironmentalContextResponse, "weather" | "waterway">;
      try {
        const response = await fetch(
          `/api/environmental-context?latitude=${selectedSite.lat}&longitude=${selectedSite.lon}`,
          { signal: controller.signal },
        );
        if (!response.ok) throw new Error(`Environmental context returned ${response.status}`);
        data = await response.json() as Pick<EnvironmentalContextResponse, "weather" | "waterway">;
      } catch {
        if (controller.signal.aborted) return;
        data = {
          weather: {
            status: "unavailable",
            precipitationMm: null,
            probabilityPercent: null,
            source: "Open-Meteo",
            message: "Live rainfall unavailable. Priority uses visible evidence with lower coverage; no fallback was invented.",
          },
          waterway: UNAVAILABLE_WATERWAY,
        };
      }
      if (controller.signal.aborted) return;
      const context = data.waterway;
      const localRain = data.weather.status === "available" ? data.weather.precipitationMm : null;
      const localStatus = `${data.weather.message} · ${selectedSite.place}`;
      setWeatherStatus(localStatus);
      setWaterwayContext(context);
      const locationRisk = scoreRisk(effectiveAnalysis.blockage, effectiveAnalysis.litter, localRain);
      const environmental = calculateEnvironmentalRisk({
        blockage: effectiveAnalysis.blockage,
        litter: effectiveAnalysis.litter,
        rainfallMm: localRain,
        waterway: context,
        evidenceConfidence: effectiveAnalysis.confidence,
      });
      const action = recommendedAction(locationRisk, cleaned);
      setSites((current) => current.map((site) => site.id === targetSiteId ? {
        ...site,
        risk: locationRisk,
        status: ["Needs review", "Verified clear"].includes(site.status) ? site.status : priorityAction(locationRisk),
        rainfall: localRain ?? undefined,
        weatherStatus: localStatus,
        blockage: effectiveAnalysis.blockage,
        litter: effectiveAnalysis.litter,
        environmentalRisk: environmental.score,
        environmentalLevel: environmental.level,
        environmentalContext: context.message,
        environmentalDistanceMeters: context.distanceMeters,
        recommendedAction: action,
      } : site));
      setSelectedSite((current) => current.id === targetSiteId ? {
        ...current,
        risk: locationRisk,
        status: ["Needs review", "Verified clear"].includes(current.status) ? current.status : priorityAction(locationRisk),
        rainfall: localRain ?? undefined,
        weatherStatus: localStatus,
        blockage: effectiveAnalysis.blockage,
        litter: effectiveAnalysis.litter,
        environmentalRisk: environmental.score,
        environmentalLevel: environmental.level,
        environmentalContext: context.message,
        environmentalDistanceMeters: context.distanceMeters,
        recommendedAction: action,
      } : current);
    }

    void loadEnvironmentalContext();
    return () => controller.abort();
  }, [cleaned, effectiveAnalysis.blockage, effectiveAnalysis.confidence, effectiveAnalysis.litter, selectedSite.environmentalContext, selectedSite.environmentalDistanceMeters, selectedSite.id, selectedSite.isDemo, selectedSite.lat, selectedSite.lon, selectedSite.place]);

  /* eslint-disable react-hooks/set-state-in-effect -- Hydrate the device-persistent pilot after the client mounts. */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PILOT_STORAGE_KEY) ?? window.localStorage.getItem(LEGACY_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as { version: number; sites: MapSite[]; evidence?: Record<string, EvidenceRecord>; reviewDecisions?: Record<string, "open" | "approved" | "request-photo"> };
        if ([1, 2, 3].includes(saved.version) && saved.sites.length > 0) {
          setSites(saved.sites);
          setEvidenceBySite(saved.evidence ?? {});
          setReviewDecisions(saved.reviewDecisions ?? {});
          const first = saved.sites[0];
          setSelectedSite(first);
          const record = saved.evidence?.[first.id];
          if (record) {
            setImageUrl(record.beforeImage);
            setFileName(record.beforeName);
            setAnalysis(record.beforeAnalysis);
            setVerificationImageUrl(record.afterImage ?? null);
            setVerificationFileName(record.afterName ?? "");
            setVerificationResult(record.verification ?? null);
            setCleaned(Boolean(record.verification?.verified));
          }
          const ids = saved.sites.map((site) => Number(site.id.replace(/\D/g, ""))).filter(Number.isFinite);
          nextLocationId.current = Math.max(104, ...ids) + 1;
        }
      }
    } catch {
      window.localStorage.removeItem(PILOT_STORAGE_KEY);
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } finally {
      setPersistenceReady(true);
    }
  }, []);

  useEffect(() => {
    if (!persistenceReady) return;
    const payload: PersistedPilot = { version: 3, sites, evidence: evidenceBySite, reviewDecisions };
    try {
      window.localStorage.setItem(PILOT_STORAGE_KEY, JSON.stringify(payload));
      window.localStorage.removeItem(LEGACY_STORAGE_KEY);
    } catch {
      // Storage can be full or disabled; the live session remains usable.
    }
  }, [evidenceBySite, persistenceReady, reviewDecisions, sites]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    return () => {
      if (imageUrl.startsWith("blob:")) URL.revokeObjectURL(imageUrl);
    };
  }, [imageUrl]);

  useEffect(() => {
    return () => {
      if (verificationImageUrl?.startsWith("blob:")) URL.revokeObjectURL(verificationImageUrl);
    };
  }, [verificationImageUrl]);

  function selectSite(site: MapSite, suppliedRecord?: EvidenceRecord) {
    const record = suppliedRecord ?? evidenceBySite[site.id];
    setImageError("");
    if (!site.isDemo) setMode("live");
    setSelectedSite(site);
    setWeatherStatus(site.weatherStatus ?? `Loading forecast · ${site.place}`);
    setWaterwayContext(site.isDemo ? waterwayContextForSite(site) : {
      status: "loading",
      distanceMeters: null,
      source: "OpenStreetMap / Overpass",
      message: "Checking mapped waterways near this report…",
    });
    if (record) {
      setImageUrl(record.beforeImage);
      setFileName(record.beforeName);
      setAnalysis(record.beforeAnalysis);
      setVerificationImageUrl(record.afterImage ?? null);
      setVerificationFileName(record.afterName ?? "");
      setVerificationResult(record.verification ?? null);
      setVerificationStage(record.verification ? "done" : "idle");
      setCleaned(Boolean(record.verification?.verified));
    } else {
      setImageUrl("/demo-drain.jpg");
      setFileName("EGLE stormwater sample");
      setAnalysis(SAMPLE_ANALYSIS);
      setVerificationImageUrl(null);
      setVerificationFileName("");
      setVerificationResult(null);
      setVerificationStage("idle");
      setCleaned(false);
    }
  }

  async function chooseImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    if (!file.type.startsWith("image/")) {
      setImageError("Please choose a JPG, PNG, WEBP, or HEIC image.");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setImageError("That image is larger than 12 MB. Choose a smaller photo so the on-device model can process it.");
      return;
    }
    setImageError("");
    setStage("loading");
    try {
      const nextUrl = await fileToStoredImage(file);
      setImageUrl(nextUrl);
      setFileName(file.name);
      setAnalysis({ blockage: 0, litter: 0, confidence: 0, drainConfidence: 0, objects: [], signal: "Starting drain-domain scan" });
      setVerificationImageUrl(null);
      setVerificationFileName("");
      setVerificationResult(null);
      setVerificationStage("idle");
      setCleaned(false);
      await runAnalysis(nextUrl, file.name);
    } catch {
      setAnalysis((current) => ({ ...current, signal: "Could not prepare this image" }));
      setImageError("This image could not be decoded. Try exporting it as JPG or PNG and upload again.");
      setStage("idle");
    }
  }

  function selectQueueSite(site: MapSite) {
    const persistedSite = sites.find((item) => item.id === site.id);
    selectSite(persistedSite ?? site);
  }

  async function chooseVerificationImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    event.target.value = "";
    if (!file.type.startsWith("image/")) {
      setImageError("Please choose an image for the after-cleanup evidence.");
      return;
    }
    if (file.size > 12 * 1024 * 1024) {
      setImageError("That after photo is larger than 12 MB. Choose a smaller image and try again.");
      return;
    }
    setImageError("");
    setVerificationStage("loading");
    try {
      const nextUrl = await fileToStoredImage(file);
      setVerificationImageUrl(nextUrl);
      setVerificationFileName(file.name);
      setVerificationResult(null);
      setCleaned(false);
      await verifyCleanup(nextUrl, file.name);
    } catch {
      setImageError("This after photo could not be decoded. Try a JPG or PNG export.");
      setVerificationStage("idle");
    }
  }

  async function verifyCleanup(source: string, sourceName = verificationFileName) {
    const targetSiteId = selectedSite.id;
    const beforeBlockage = analysis.blockage;
    setVerificationStage("loading");
    try {
      const image = await loadImage(source);
      const visual = extractVisualSignals(image);
      const beforeImage = await loadImage(imageUrl);
      const beforeFingerprint = analysis.fingerprint ?? extractVisualSignals(beforeImage).fingerprint;
      const { blockage: baseBlockage, litter: baseLitter } = calculateBaseVisionScores(visual);
      const blockageClassificationPromise = classifyBlockage(image).catch(() => null);
      setVerificationStage("detecting");

      let predictions: Detection[] = [];
      let modelUsed = false;
      try {
        const detector = await getDetector();
        const raw = await detector.detect(image);
        predictions = raw
          .filter((item) => item.score >= 0.34)
          .slice(0, 5)
          .map((item) => ({
            class: item.class,
            score: item.score,
            bbox: [
              (item.bbox[0] / image.naturalWidth) * 100,
              (item.bbox[1] / image.naturalHeight) * 100,
              (item.bbox[2] / image.naturalWidth) * 100,
              (item.bbox[3] / image.naturalHeight) * 100,
            ],
          }));
        modelUsed = true;
      } catch {
        modelUsed = false;
      }

      const litterObjects = predictions.filter((item) =>
        ["bottle", "cup", "book", "handbag", "backpack", "umbrella"].includes(item.class),
      ).length;
      const blockageClassification = await blockageClassificationPromise;
      const blockage = blockageClassification
        ? clamp(Math.round(blockageClassification.probability * 100), 14, 94)
        : clamp(baseBlockage + litterObjects * 5, 14, 94);
      const litter = clamp(baseLitter + litterObjects * 18, 8, 96);
      const reduction = Math.max(0, beforeBlockage - blockage);
      const drainConfidence = combineDrainConfidence(calculateDrainConfidence(visual, predictions), blockageClassification);
      const sceneMatch = compareSceneFingerprints(beforeFingerprint, visual.fingerprint);
      const sameDrain = sceneMatch >= SAME_DRAIN_THRESHOLD;
      const verified = passesCleanupVerification({ sameDrain, drainConfidence, blockage, litter, reduction });
      const confidence = Math.min(
        drainConfidence,
        clamp(Math.round((modelUsed ? 78 : 59) + Math.min(predictions.length, 4) * 3), 0, 94),
      );
      const result: VerificationResult = {
        blockage,
        litter,
        confidence,
        drainConfidence,
        fingerprint: visual.fingerprint,
        objects: predictions,
        reduction,
        sceneMatch,
        sameDrain,
        verified,
        signal: sameDrain ? "Same-drain evidence comparison" : "Scene mismatch · human review",
      };
      setVerificationResult(result);
      setCleaned(verified);
      setEvidenceBySite((current) => ({
        ...current,
        [targetSiteId]: {
          beforeImage: current[targetSiteId]?.beforeImage ?? imageUrl,
          beforeName: current[targetSiteId]?.beforeName ?? fileName,
          beforeAnalysis: current[targetSiteId]?.beforeAnalysis ?? analysis,
          afterImage: source,
          afterName: sourceName,
          verification: result,
          updatedAt: new Date().toISOString(),
        },
      }));

      if (verified) {
        const residualRisk = scoreRisk(blockage, litter, rainfall);
        setSites((current) => current.map((site) => (
          site.id === targetSiteId ? { ...site, risk: residualRisk, status: "Verified clear", blockage, litter, photo: source, recommendedAction: recommendedAction(residualRisk, true) } : site
        )));
        setSelectedSite((current) => (
          current.id === targetSiteId ? { ...current, risk: residualRisk, status: "Verified clear", blockage, litter, photo: source, recommendedAction: recommendedAction(residualRisk, true) } : current
        ));
      } else {
        const originalRisk = scoreRisk(analysis.blockage, analysis.litter, rainfall);
        const originalStatus = "Needs review";
        setSites((current) => current.map((site) => (
          site.id === targetSiteId ? { ...site, risk: originalRisk, status: originalStatus } : site
        )));
        setSelectedSite((current) => (
          current.id === targetSiteId ? { ...current, risk: originalRisk, status: originalStatus } : current
        ));
      }
      setVerificationStage("done");
    } catch {
      const failedResult: VerificationResult = {
        blockage: analysis.blockage,
        litter: analysis.litter,
        confidence: 0,
        drainConfidence: 0,
        objects: [],
        reduction: 0,
        sceneMatch: 0,
        sameDrain: false,
        verified: false,
        signal: "Could not read the after photo",
      };
      setVerificationResult(failedResult);
      setEvidenceBySite((current) => ({
        ...current,
        [targetSiteId]: {
          beforeImage: current[targetSiteId]?.beforeImage ?? imageUrl,
          beforeName: current[targetSiteId]?.beforeName ?? fileName,
          beforeAnalysis: current[targetSiteId]?.beforeAnalysis ?? analysis,
          afterImage: source,
          afterName: sourceName,
          verification: failedResult,
          updatedAt: new Date().toISOString(),
        },
      }));
      const originalRisk = scoreRisk(analysis.blockage, analysis.litter, rainfall);
      const originalStatus = "Needs review";
      setSites((current) => current.map((site) => (
        site.id === targetSiteId ? { ...site, risk: originalRisk, status: originalStatus } : site
      )));
      setSelectedSite((current) => (
        current.id === targetSiteId ? { ...current, risk: originalRisk, status: originalStatus } : current
      ));
      setVerificationStage("done");
    }
  }

  async function runAnalysis(source = imageUrl, sourceName = fileName) {
    const targetSiteId = selectedSite.id;
    setStage("loading");
    setCleaned(false);
    try {
      const image = await loadImage(source);
      const visual = extractVisualSignals(image);
      const { blockage: baseBlockage, litter: baseLitter } = calculateBaseVisionScores(visual);
      const blockageClassificationPromise = classifyBlockage(image).catch(() => null);

      setAnalysis({
        blockage: baseBlockage,
        litter: baseLitter,
        confidence: 59,
        objects: [],
        signal: "Visual scan complete · refining objects",
      });
      setStage("detecting");

      let predictions: Detection[] = [];
      let modelUsed = false;
      try {
        const detector = await getDetector();
        const raw = await detector.detect(image);
        predictions = raw
          .filter((item) => item.score >= 0.34)
          .slice(0, 5)
          .map((item) => ({
            class: item.class,
            score: item.score,
            bbox: [
              (item.bbox[0] / image.naturalWidth) * 100,
              (item.bbox[1] / image.naturalHeight) * 100,
              (item.bbox[2] / image.naturalWidth) * 100,
              (item.bbox[3] / image.naturalHeight) * 100,
            ],
          }));
        modelUsed = true;
      } catch {
        modelUsed = false;
      }

      const litterObjects = predictions.filter((item) =>
        ["bottle", "cup", "book", "handbag", "backpack", "umbrella"].includes(item.class),
      ).length;
      const blockageClassification = await blockageClassificationPromise;
      const blockage = blockageClassification
        ? clamp(Math.round(blockageClassification.probability * 100), 14, 94)
        : clamp(baseBlockage + litterObjects * 5, 14, 94);
      const litter = clamp(baseLitter + litterObjects * 18, 8, 96);
      const drainConfidence = combineDrainConfidence(calculateDrainConfidence(visual, predictions), blockageClassification);
      const confidence = Math.min(
        drainConfidence,
        clamp(Math.round((modelUsed ? 78 : 59) + Math.min(predictions.length, 4) * 3), 0, 94),
      );
      const nextStatus = inspectionDecision({ drainConfidence, risk: scoreRisk(blockage, litter, rainfall) });
      const drainConfirmed = nextStatus !== "Needs review";

      const finalAnalysis: Analysis = {
        blockage,
        litter,
        confidence,
        drainConfidence,
        fingerprint: visual.fingerprint,
        objects: predictions,
        signal: drainConfirmed
          ? (blockageClassification
            ? (modelUsed ? "Research ResNet-50 + COCO litter" : "Research ResNet-50 · litter fallback")
            : (modelUsed ? "Visual fallback + COCO litter detector" : "Offline visual fallback"))
          : "Drain not confirmed · human review",
      };
      setAnalysis(finalAnalysis);
      setEvidenceBySite((current) => ({
        ...current,
        [targetSiteId]: {
          beforeImage: source,
          beforeName: sourceName,
          beforeAnalysis: finalAnalysis,
          updatedAt: new Date().toISOString(),
        },
      }));
      const resultRisk = scoreRisk(blockage, litter, rainfall);
      setSites((current) => current.map((site) => (
        site.id === targetSiteId ? { ...site, risk: resultRisk, status: nextStatus, blockage, litter, photo: source, recommendedAction: recommendedAction(resultRisk) } : site
      )));
      setSelectedSite((current) => (
        current.id === targetSiteId ? { ...current, risk: resultRisk, status: nextStatus, blockage, litter, photo: source, recommendedAction: recommendedAction(resultRisk) } : current
      ));
      setStage("done");
    } catch {
      setAnalysis((current) => ({ ...current, signal: "Could not read this image" }));
      setImageError("The image could not be analyzed in this browser. Try another clear drain photo.");
      setStage("idle");
    }
  }

  async function locateGarbage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = locationInput.trim();
    if (!query) return;

    setLocating(true);
    setLocationStatus("Finding that location…");
    try {
      let result: { lat: number; lon: number; place: string } | null = null;
      const nominatimResponse = await fetch(
        `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&addressdetails=1&q=${encodeURIComponent(query)}`,
        { headers: { "Accept-Language": "en" } },
      ).catch(() => null);
      if (nominatimResponse?.ok) {
        const matches = await nominatimResponse.json() as Array<{ lat: string; lon: string; display_name: string }>;
        const match = matches[0];
        if (match) {
          result = {
            lat: Number(match.lat),
            lon: Number(match.lon),
            place: match.display_name.split(",").slice(0, 3).join(" · "),
          };
        }
      }

      if (!result) {
        const fallbackResponse = await fetch(
          `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(query)}&count=1&language=en&format=json`,
        );
        if (fallbackResponse.ok) {
          const data = await fallbackResponse.json() as {
            results?: Array<{ latitude: number; longitude: number; name: string; admin1?: string; country?: string }>;
          };
          const match = data.results?.[0];
          if (match) {
            result = {
              lat: match.latitude,
              lon: match.longitude,
              place: [match.name, match.admin1, match.country].filter(Boolean).join(" · "),
            };
          }
        }
      }

      if (!result || !Number.isFinite(result.lat) || !Number.isFinite(result.lon)) {
        setLocationStatus("Location not found. Try a neighborhood plus city.");
        return;
      }

      const locationRisk = scoreRisk(analysis.blockage, analysis.litter, null);
      const site: MapSite = {
        id: `DG-${nextLocationId.current++}`,
        place: result.place,
        risk: locationRisk,
        status: priorityAction(locationRisk),
        lat: result.lat,
        lon: result.lon,
        weatherStatus: `Loading live rainfall · ${result.place}`,
        blockage: analysis.blockage,
        litter: analysis.litter,
        environmentalContext: "Checking mapped waterways near this report…",
        environmentalDistanceMeters: null,
        recommendedAction: recommendedAction(locationRisk),
        photo: imageUrl,
        isDemo: false,
      };
      const evidence: EvidenceRecord = {
        beforeImage: imageUrl,
        beforeName: fileName,
        beforeAnalysis: analysis,
        updatedAt: new Date().toISOString(),
      };
      setSites((current) => [site, ...current]);
      setEvidenceBySite((current) => ({ ...current, [site.id]: evidence }));
      selectSite(site, evidence);
      setLocationStatus(`Garbage marker added at ${site.place} (${result.lat.toFixed(4)}, ${result.lon.toFixed(4)}). Live rainfall and nearby-waterway context are loading for this coordinate.`);
    } catch {
      setLocationStatus("Could not reach the location service. Please try again.");
    } finally {
      setLocating(false);
    }
  }

  function openReview(site: MapSite) {
    selectSite(site);
    window.requestAnimationFrame(() => document.getElementById("verify")?.scrollIntoView({ behavior: "smooth" }));
  }

  function keepReportOpen(site: MapSite) {
    const status = priorityAction(site.risk);
    setSites((current) => current.map((item) => item.id === site.id ? { ...item, status } : item));
    setSelectedSite((current) => current.id === site.id ? { ...current, status } : current);
  }

  function restoreSample() {
    setImageError("");
    setImageUrl("/demo-drain.jpg");
    setFileName("EGLE stormwater sample");
    setAnalysis(SAMPLE_ANALYSIS);
    setMode("surge");
    setScenarioRainfall(64);
    setWaterwayContext(waterwayContextForSite(INITIAL_SITES[0]));
    setVerificationImageUrl(null);
    setVerificationFileName("");
    setVerificationResult(null);
    setVerificationStage("idle");
    setCleaned(false);
    setStage("idle");
    setRippleVersion((current) => current + 1);
  }

  function applyRainfallScenario(rainfallMm: number) {
    setScenarioRainfall(rainfallMm);
    setMode("surge");
    setRippleVersion((current) => current + 1);
  }

  function loadDemoScenario(scenario: DemoScenario, shouldScroll = true) {
    const demoWaterway: WaterwayContext = scenario.environmentalDistanceMeters === null
      ? UNAVAILABLE_WATERWAY
      : {
        status: "available",
        distanceMeters: scenario.environmentalDistanceMeters,
        source: "OpenStreetMap / Overpass",
        message: `Demo scenario: mapped water feature approximately ${scenario.environmentalDistanceMeters} m away.`,
      };
    const demoAnalysis: Analysis = {
      ...SAMPLE_ANALYSIS,
      blockage: scenario.blockage,
      litter: scenario.litter,
      confidence: scenario.id === "review" ? 55 : 88,
      drainConfidence: scenario.id === "review" ? 55 : 86,
      signal: "Demo scenario · controlled evidence",
    };
    const demoPriority = calculatePriorityScore({
      blockage: scenario.blockage,
      litter: scenario.litter,
      rainfallMm: scenario.rainfallMm,
      evidenceConfidence: demoAnalysis.confidence,
    });
    const demoEnvironmental = calculateEnvironmentalRisk({
      blockage: scenario.blockage,
      litter: scenario.litter,
      rainfallMm: scenario.rainfallMm,
      waterway: demoWaterway,
      evidenceConfidence: demoAnalysis.confidence,
    });
    const demoSite: MapSite = {
      ...INITIAL_SITES[0],
      id: `DEMO-${scenario.id.toUpperCase()}`,
      place: `${scenario.title} · Demo scenario`,
      risk: demoPriority.score,
      status: scenario.status,
      rainfall: scenario.rainfallMm,
      blockage: scenario.blockage,
      litter: scenario.litter,
      environmentalRisk: demoEnvironmental.score,
      environmentalLevel: demoEnvironmental.level,
      environmentalContext: demoWaterway.message,
      environmentalDistanceMeters: demoWaterway.distanceMeters,
      recommendedAction: recommendedAction(demoPriority.score, scenario.status === "Verified clear"),
      isDemo: true,
    };
    setAnalysis(demoAnalysis);
    setImageError("");
    setSelectedSite(demoSite);
    setSites((current) => [demoSite, ...current.filter((site) => !site.id.startsWith("DEMO-"))]);
    setWaterwayContext(demoWaterway);
    setScenarioRainfall(scenario.rainfallMm);
    setMode("surge");
    setImageUrl("/demo-drain.jpg");
    setFileName(`${scenario.title} · sample data`);
    setVerificationImageUrl(null);
    setVerificationResult(null);
    setVerificationStage("idle");
    setCleaned(scenario.status === "Verified clear");
    setRippleVersion((current) => current + 1);
    if (shouldScroll) window.requestAnimationFrame(() => document.getElementById("inspect")?.scrollIntoView({ behavior: "smooth" }));
  }

  function applyJudgeStep(stepIndex: number) {
    const nextStep = Math.max(0, Math.min(JUDGE_STEPS.length - 1, stepIndex));
    const step = JUDGE_STEPS[nextStep];
    setJudgeStep(nextStep);
    if (step.id === "detect") {
      loadDemoScenario(DEMO_SCENARIOS.find((item) => item.id === "litter") ?? DEMO_SCENARIOS[2], false);
    } else if (step.id === "prioritize") {
      loadDemoScenario(DEMO_SCENARIOS.find((item) => item.id === "litter") ?? DEMO_SCENARIOS[2], false);
    } else if (step.id === "shock") {
      loadDemoScenario(DEMO_SCENARIOS.find((item) => item.id === "rainfall") ?? DEMO_SCENARIOS[3], false);
    } else if (step.id === "act") {
      loadDemoScenario(DEMO_SCENARIOS.find((item) => item.id === "waterway") ?? DEMO_SCENARIOS[4], false);
    }
    window.requestAnimationFrame(() => {
      document.getElementById(step.id === "act" ? "queue" : step.id === "verify" || step.id === "close" ? "verify" : "inspect")?.scrollIntoView({ behavior: "smooth", block: "start" });
      document.getElementById("judge-demo-title")?.focus();
    });
  }

  function runJudgeDemo() {
    const scenario = DEMO_SCENARIOS.find((item) => item.id === "litter") ?? DEMO_SCENARIOS[2];
    setJudgeMode(true);
    setJudgeStep(0);
    setPitchMode(false);
    setComparisonMode("side-by-side");
    setComparisonSplit(50);
    loadDemoScenario(scenario, false);
    window.setTimeout(() => document.getElementById("judge-demo")?.scrollIntoView({ behavior: "smooth" }), 120);
  }

  function setReviewDecision(site: MapSite, decision: "open" | "approved" | "request-photo") {
    setReviewDecisions((current) => ({ ...current, [site.id]: decision }));
    if (decision === "approved") {
      setSites((current) => current.map((item) => item.id === site.id ? {
        ...item,
        status: "Verified clear",
        recommendedAction: "Human-approved closure. Continue routine monitoring.",
      } : item));
      setSelectedSite((current) => current.id === site.id ? {
        ...current,
        status: "Verified clear",
        recommendedAction: "Human-approved closure. Continue routine monitoring.",
      } : current);
    } else if (decision === "request-photo") {
      setSites((current) => current.map((item) => item.id === site.id ? { ...item, status: "Needs review", recommendedAction: "Request a clearer same-drain after photo." } : item));
      setSelectedSite((current) => current.id === site.id ? { ...current, status: "Needs review", recommendedAction: "Request a clearer same-drain after photo." } : current);
    } else {
      keepReportOpen(site);
    }
  }

  const report = `DRAINGUARD FIELD BRIEF · ${selectedSite.id}\nCleanup priority: ${band.label.toUpperCase()} (${risk}/100) · queue position #${selectedRank}\nEnvironmental impact risk: ${environmentalResult.score}/100 (${environmentalResult.confidence} confidence · ${environmentalResult.coverage}% coverage)\nLocation: ${selectedSite.place} · ${selectedSite.lat.toFixed(4)}, ${selectedSite.lon.toFixed(4)}\nObserved blockage: ${effectiveAnalysis.blockage}%\nLitter signal: ${effectiveAnalysis.litter}%\nEnvironmental context: ${waterwayContext.message}\nVerification: ${cleaned ? `Passed · ${verificationResult?.reduction ?? 0} point obstruction reduction` : "Pending field evidence"}\nRainfall input: ${rainfall === null ? "Unavailable (not estimated)" : `${rainfall.toFixed(1)} mm / 24h`}\n\nRecommended action: ${action}\n\nDecision-support estimate only. This is not a flood prediction, hydrological model, pollution-volume estimate, or emergency alert.`;

  async function copyReport() {
    await navigator.clipboard.writeText(report);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  const activeJudgeStep = JUDGE_STEPS[judgeStep];

  return (
    <main className={pitchMode ? "pitch-mode" : undefined}>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="DrainGuard home">
          <span className="brand-mark">DG</span>
          <span>DrainGuard <i>AI</i></span>
        </a>
        <div className="pilot-pill"><span /> Environmental decision-support prototype</div>
        <nav aria-label="Primary navigation">
          <button className="nav-demo-tab" type="button" onClick={runJudgeDemo}>🎬 90-sec Demo</button>
          <a href="#inspect">🔍 Inspect</a>
          <a href="#queue">📍 Prioritize</a>
          <a href="#verify">✓ Verify</a>
          <a href="#dashboard">📊 Impact</a>
        </nav>
        <button className={`button button-small pitch-toggle ${pitchMode ? "active" : ""}`} onClick={() => setPitchMode((current) => !current)}>{pitchMode ? "Exit pitch mode" : "🎤 Pitch Mode"}</button>
        <button className="button button-small" onClick={() => fileInput.current?.click()}>+ New inspection</button>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <div className="eyebrow"><span>Street-to-waterway monitoring</span><span>Decision support</span></div>
          <h1>Which drain should your crew inspect before the <em>storm?</em></h1>
          <p>DrainGuard turns visible street evidence and changing conditions into explainable inspection priorities—then verifies whether cleanup worked.</p>
          <div className="hero-actions">
            <button className="button" type="button" onClick={runJudgeDemo}>Run the 90-second judge demo <span>→</span></button>
            <a className="text-button" href="#inspect">Inspect a drain <span>↘</span></a>
          </div>
          <div className="hero-flow" aria-label="DrainGuard product flow"><span>DETECT</span><i>→</i><span>PRIORITIZE</span><i>→</i><span>ALLOCATE</span><i>→</i><span>ACT</span><i>→</i><span>VERIFY</span></div>
          <div className="resource-pulse" aria-label="Current operational constraint"><div><strong>{crewCount}</strong><span>{crewCount === 1 ? "crew" : "crews"}</span></div><div><strong>{inspectionCapacity}</strong><span>inspections available</span></div><div><strong>{sortedSites.filter((site) => site.status !== "Verified clear").length}</strong><span>reports competing</span></div><p>A decision has to be made.</p></div>
        </div>
        <div className="hero-proof impact-chain" aria-label="Potential street-to-waterway impact chain">
          <div className="proof-head"><span>Why intervene before rainfall?</span><span className="live-dot">Potential pathway</span></div>
          <ol>
            <li><b>01</b><span>Street litter</span></li>
            <li><b>02</b><span>Blocked storm drain</span></li>
            <li><b>03</b><span>Rainfall mobilizes waste</span></li>
            <li><b>04</b><span>Potential transport toward waterways</span></li>
            <li><b>05</b><span>Environmental concern</span></li>
          </ol>
          <p>DrainGuard intervenes through <strong>Detect → Prioritize → Priority Shock → Allocate → Verify → Close</strong>.</p>
        </div>
      </section>

      {judgeMode && (
        <section className="judge-narrator" id="judge-demo" aria-labelledby="judge-demo-title">
          <div className="judge-narrator-topline"><span>🎬 90-second judge demo</span><strong>Controlled demonstration data</strong></div>
          <div className="judge-stepper" aria-label="Judge demo progress">
            {JUDGE_STEPS.map((step, index) => (
              <button key={step.id} type="button" className={index === judgeStep ? "active" : index < judgeStep ? "complete" : ""} onClick={() => applyJudgeStep(index)}><b>{String(index + 1).padStart(2, "0")}</b><span>{step.label}</span></button>
            ))}
          </div>
          <div className="judge-narrator-body">
            <div><span className="kicker">Step {judgeStep + 1} of {JUDGE_STEPS.length} · {activeJudgeStep.label}</span><h2 id="judge-demo-title" tabIndex={-1}>{activeJudgeStep.title}</h2><p>{activeJudgeStep.copy}</p><strong>{activeJudgeStep.hint}</strong></div>
            <div className="judge-narrator-actions">
              <button className="button button-outline" type="button" onClick={() => applyJudgeStep(judgeStep - 1)} disabled={judgeStep === 0}>← Previous</button>
              <button className="button button-dark" type="button" onClick={() => applyJudgeStep(judgeStep + 1)} disabled={judgeStep === JUDGE_STEPS.length - 1}>{judgeStep === JUDGE_STEPS.length - 1 ? "Demo complete ✓" : "Next step →"}</button>
              <button className="text-button" type="button" onClick={() => applyJudgeStep(0)}>Restart</button>
              <button className="text-button" type="button" onClick={() => setJudgeMode(false)}>Exit demo ×</button>
            </div>
          </div>
        </section>
      )}

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
              <NextImage id="inspection-image" src={imageUrl} alt="Storm drain submitted for inspection" fill sizes="(max-width: 1000px) 100vw, 62vw" loading="eager" unoptimized />
              <div className="scan-grid" aria-hidden="true" />
              {analysis.objects.map((object, index) => {
                return (
                  <div
                    className="detection-box"
                    key={`${object.class}-${index}`}
                    style={{
                      left: `${object.bbox[0]}%`,
                      top: `${object.bbox[1]}%`,
                      width: `${object.bbox[2]}%`,
                      height: `${object.bbox[3]}%`,
                    }}
                  >
                    <span>{object.class} · {Math.round(object.score * 100)}%</span>
                  </div>
                );
              })}
              <span className="photo-location">{selectedSite.place}</span>
              <span className="photo-time">{selectedSite.isDemo ? "Demo scenario" : "Device report"}</span>
            </div>
            <div className="photo-actions">
              <input ref={fileInput} onChange={chooseImage} type="file" accept="image/*" hidden aria-label="Upload a drain photo" />
              <button className="button button-outline" onClick={() => fileInput.current?.click()}>Choose a photo</button>
              <button className="button button-dark" disabled={stage === "loading" || stage === "detecting"} onClick={() => void runAnalysis()}>
                {stage === "loading" ? "Reading image…" : stage === "detecting" ? "Refining with AI…" : "Analyze again"}
              </button>
              <button className="sample-link" onClick={restoreSample}>Reset sample</button>
              <p className={`analysis-progress stage-${stage}`} aria-live="polite">
                {stage === "idle" && "Choose a photo — analysis starts automatically."}
                {stage === "loading" && "Reading pixels and drain texture…"}
                {stage === "detecting" && "Preliminary score ready. Object detector is refining it…"}
                {stage === "done" && "✓ Analysis complete"}
              </p>
              {imageError && <p className="image-error" role="alert">{imageError}</p>}
              <div className="evidence-strip" aria-label="Visual evidence summary">
                <div><span>Evidence gate</span><strong>{confidenceLabel(analysis.drainConfidence ?? analysis.confidence)}</strong></div>
                <div><span>Detected objects</span><strong>{analysis.objects.length} {analysis.objects.length === 1 ? "box" : "boxes"}</strong></div>
                <div><span>Model path</span><strong>{modelLabel(analysis.signal)}</strong></div>
              </div>
            </div>
          </div>

          <aside className="result-panel" aria-live="polite">
            <div className="result-topline"><span>Risk assessment</span><span>{analysis.signal}</span></div>
            <div className={`risk-score ${band.tone}`}>
              <div><strong>{risk}</strong><span>/100</span></div>
              <div><span className="risk-label">{band.label}</span><small>cleanup priority</small></div>
            </div>
            <div className="risk-meter"><span style={{ width: `${risk}%` }} /></div>
            <div className="decision-path" aria-label="DrainGuard decision path">
              <span className="decision-done">1 · See</span>
              <span className="decision-done">2 · Understand</span>
              <span className="decision-done">3 · Adapt</span>
              <span className={stage === "done" ? "decision-active" : ""}>4 · Decide</span>
              <span className={stage === "done" ? "decision-active" : ""}>5 · Act</span>
              <span className={verificationResult ? "decision-active" : ""}>6 · Verify</span>
            </div>

            <div className="signal-list">
              <div className="signal-row">
                <div><span className="signal-icon">◩</span><span>Drain obstruction<small>Visual occlusion estimate</small></span></div>
                <strong>{effectiveAnalysis.blockage}%</strong>
              </div>
              <div className="signal-row">
                <div><span className="signal-icon">⌁</span><span>Rainfall exposure<small>{mode === "surge" ? "Demo monsoon scenario" : weatherStatus}</small></span></div>
                <strong>{rainfall === null ? "—" : rainfall.toFixed(1)}<small>{rainfall === null ? " unavailable" : " mm"}</small></strong>
              </div>
              <div className="signal-row">
                <div><span className="signal-icon">◇</span><span>Litter signal<small>Objects + visual texture</small></span></div>
                <strong>{effectiveAnalysis.litter}%</strong>
              </div>
              <div className="signal-row">
                <div><span className="signal-icon">≈</span><span>Environmental context<small>{waterwayContext.message}</small></span></div>
                <strong>{waterwayContext.status === "available" && waterwayContext.distanceMeters !== null ? `${waterwayContext.distanceMeters}m` : "—"}</strong>
              </div>
            </div>

            <div className="scenario-control">
              <span>Weather scenario</span>
              <div>
                <button className={mode === "live" ? "active" : ""} onClick={() => setMode("live")}>Live</button>
                <button className={mode === "surge" ? "active" : ""} onClick={() => applyRainfallScenario(64)}>Scenario</button>
              </div>
            </div>

            <div className="recommendation">
              <span>Recommended next step</span>
              <p>{action}</p>
            </div>
            <div className="impact-strip" aria-label="Operational impact snapshot">
              <div><span>Queue position</span><strong>#{selectedRank}</strong><small>of {sortedSites.length} reports</small></div>
              <div><span>Response target</span><strong>{selectedSite.status === "Dispatch now" ? "Now" : selectedSite.status === "Inspect today" ? "24h" : selectedSite.status === "Verified clear" ? "Routine" : "Review"}</strong><small>{selectedSite.status}</small></div>
              <div><span>Risk delta</span><strong>{verifiedRiskReduction === null ? "—" : `−${verifiedRiskReduction}`}</strong><small>{verifiedRiskReduction === null ? "after verification" : "priority points"}</small></div>
            </div>
            <button className="button button-full" onClick={() => setReportOpen(true)}>Generate field brief <span>→</span></button>
            <p className="confidence">Drain presence {analysis.drainConfidence ?? analysis.confidence}% · evidence confidence {analysis.confidence}% · environmental coverage {environmentalResult.coverage}% · human verification required</p>
            <div className="confidence-explainer" aria-label="AI evidence explanation">
              <div className="confidence-explainer-head"><span>Why this score?</span><strong>{confidenceLabel(analysis.confidence)}</strong></div>
              <p>{modelLabel(analysis.signal)} combines the blockage estimate with visible scene evidence. The score is decision support, not a claim that the image proves flooding or pollution volume.</p>
              <div className="confidence-factors">
                <span><b>{analysis.drainConfidence ?? analysis.confidence}%</b> drain gate</span>
                <span><b>{analysis.objects.length}</b> detected objects</span>
                <span><b>{environmentalResult.coverage}%</b> context coverage</span>
              </div>
            </div>
          </aside>
        </div>
        <PriorityExplanation priority={priorityResult} environmental={environmentalResult} action={action} />
        <PriorityShockPanel
          sites={queueSites}
          rainfall={mode === "surge" ? scenarioRainfall : (selectedSite.rainfall ?? 0)}
          crews={crewCount}
          capacity={inspectionCapacity}
          rippleVersion={rippleVersion}
          onRainfallChange={applyRainfallScenario}
        />
        <RainfallScenarioExplorer scenarios={scenarios} onApply={applyRainfallScenario} />
      </section>

      <EnvironmentalDashboard records={dashboardRecords} />

      <div id="demo">
        <DemoMode scenarios={DEMO_SCENARIOS} onSelect={loadDemoScenario} />
      </div>

      <section className="queue-section" id="queue">
        <div className="section-intro compact">
          <div>
            <span className="kicker">02 · Prioritize</span>
            <h2>What should crews inspect next?</h2>
          </div>
          <p>Crews see cleanup priority, environmental concern, evidence status, and the recommended action—not simply the newest report.</p>
        </div>

        <div className="persistence-note">
          <span className={persistenceReady ? "saved" : ""} />
          <strong>{persistenceReady ? "Device-persistent pilot" : "Loading saved reports"}</strong>
          <p>Reports, scores, and compressed before/after evidence survive refreshes on this inspection device. Shared multi-user storage requires a connected municipal database.</p>
        </div>

        <form className="location-search" onSubmit={locateGarbage}>
          <label htmlFor="garbage-location">
            <span>Where is the garbage?</span>
            <input
              id="garbage-location"
              value={locationInput}
              onChange={(event) => setLocationInput(event.target.value)}
              placeholder="e.g. Whitefield, Bengaluru"
              autoComplete="street-address"
            />
          </label>
          <button className="button button-dark" disabled={locating || !locationInput.trim()}>
            {locating ? "Finding location…" : "Show garbage on map →"}
          </button>
          <p aria-live="polite">{locationStatus || "Enter a street, neighborhood, landmark, or city to place a garbage report."}</p>
        </form>

        <div className="queue-grid">
          <div className="map-card" aria-label="Priority map of inspected drains">
            <div className="map-top"><span>{selectedSite.place}</span><span>{sites.length} mapped reports · symbols + labels</span></div>
            <DrainMap sites={queueSites} selectedId={selectedSite.id} onSelect={selectQueueSite} />
          </div>

          <div className="queue-card">
            <div className="queue-heading"><span>Cleanup queue</span><span>Sorted by cleanup priority</span></div>
            {sortedSites.map((site, index) => (
              <button className={`queue-row ${selectedSite.id === site.id ? "active" : ""}`} key={site.id} onClick={() => selectQueueSite(site)}>
                <span className="queue-rank">{String(index + 1).padStart(2, "0")}</span>
                <span className="queue-place"><strong>{site.place}</strong><small>{site.id} · {site.status}{site.isDemo ? " · Demo scenario" : ""}<br />{queueReason(site)}</small></span>
                <span className={`queue-risk ${riskBand(site.environmentalRisk ?? site.risk).tone}`} aria-label={`Environmental concern ${site.environmentalRisk ?? site.risk} out of 100`}>{site.status === "Verified clear" ? "✓" : site.status === "Needs review" ? "!" : site.environmentalRisk ?? site.risk}</span>
              </button>
            ))}
            <div className="selected-summary">
              <span>Selected</span>
              <strong>{selectedSite.id}</strong>
              <p>{selectedSite.status}. Cleanup priority {selectedSite.risk}/100 · environmental concern {selectedSite.environmentalRisk ?? "unavailable"}{typeof selectedSite.environmentalRisk === "number" ? "/100" : ""}.</p>
            </div>
          </div>
        </div>

        <div className="review-board" aria-label="Human review queue">
          <div className="review-board-head">
            <div><span className="kicker">Human review</span><h3>Evidence that needs a person.</h3></div>
            <strong>{reviewSites.length} waiting</strong>
          </div>
          <div className="review-list">
            {reviewSites.length === 0 && <p className="review-empty">No uncertain reports. Failed or low-confidence checks will appear here automatically.</p>}
            {reviewSites.map((site) => {
              const verification = evidenceBySite[site.id]?.verification;
              const reviewDecision = reviewDecisions[site.id] ?? "open";
              return (
                <article className="review-item" key={site.id}>
                  <div><span>{site.id}</span><strong>{site.place}</strong><em className={`review-status review-status-${reviewDecision}`}>{reviewDecision === "request-photo" ? "Photo requested" : reviewDecision === "approved" ? "Human approved" : "Open"}</em></div>
                  <p>{verification
                    ? (!verification.sameDrain
                      ? `Scene match ${verification.sceneMatch ?? 0}%—the system could not prove this is the same drain.`
                      : `After-photo comparison reduced obstruction by ${verification.reduction} points—below the automatic-clear threshold.`)
                    : "Low-confidence or non-drain evidence requires a field officer to check the inlet."}</p>
                  <div className="review-actions">
                    <button className="button button-outline" onClick={() => openReview(site)}>Open evidence</button>
                    <button className="review-approve" onClick={() => setReviewDecision(site, "approved")}>Approve closure</button>
                    <button className="review-keep" onClick={() => setReviewDecision(site, "request-photo")}>Request photo</button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>

        <ActionPlanner
          sites={sortedSites}
          crews={crewCount}
          capacity={inspectionCapacity}
          onCrewsChange={setCrewCount}
          onCapacityChange={setInspectionCapacity}
          rippleVersion={rippleVersion}
        />
        <WorkflowComparison />
      </section>

      <section className="verification-section" id="verify">
        <div className="verification-copy">
          <span className="kicker">03 · Verify</span>
          <h2>Close the loop,<br />not just the ticket.</h2>
          <p>After the crew cleans this drain, upload a second photo. The AI compares obstruction and litter with the original evidence before closing the report.</p>
          <p className="verification-principle"><strong>Detection alone does not prove the problem was solved.</strong> DrainGuard verifies the cleanup evidence.</p>
          <div className="verify-flow" aria-label="Verification steps">
            <span><b>1</b> Upload after photo</span>
            <span><b>2</b> AI compares evidence</span>
            <span><b>3</b> Map status updates</span>
          </div>
          <input ref={verificationInput} onChange={chooseVerificationImage} type="file" accept="image/*" hidden aria-label="Upload after-cleanup photo" />
          <button
            className={`button ${cleaned ? "button-success" : ""}`}
            disabled={verificationStage === "loading" || verificationStage === "detecting"}
            onClick={() => verificationInput.current?.click()}
          >
            {verificationStage === "loading" ? "Reading after photo…" : verificationStage === "detecting" ? "Comparing with AI…" : cleaned ? "✓ Verified · upload another" : "Upload after-cleanup photo →"}
          </button>
          <p className={`verification-message ${verificationResult?.verified ? "passed" : verificationResult ? "review" : ""}`} aria-live="polite">
            {!verificationResult && (verificationFileName ? `Analyzing ${verificationFileName}…` : `Selected report: ${selectedSite.id} · ${selectedSite.place}`)}
            {verificationResult?.verified && verificationReveal === "checking" && "Checking the same scene…"}
            {verificationResult?.verified && verificationReveal === "measuring" && "Measuring improvement…"}
            {verificationResult?.verified && verificationReveal === "verified" && `Verified: ${verificationResult.sceneMatch ?? 0}% same-drain match and visible obstruction fell by ${verificationResult.reduction ?? 0} points. ${selectedSite.id} is now marked clear.`}
            {verificationResult && !verificationResult.verified && `Human review required. ${verificationFailureReason || "The evidence could not be evaluated reliably."}`}
          </p>
          {verificationResult?.verified && verificationReveal !== "verified" && (
            <div className="verification-reveal" aria-live="polite">
              {verificationReveal === "checking" && <><strong>Checking the same scene</strong><span>✓ Same-drain evidence matched</span></>}
              {verificationReveal === "measuring" && <><strong>Measuring improvement</strong><div><span>Obstruction <b>{analysis.blockage}% → {verificationResult.blockage}%</b></span><span>Visible litter <b>{analysis.litter}% → {verificationResult.litter}%</b></span></div></>}
            </div>
          )}
          {verificationResult && (!verificationResult.verified || verificationReveal === "verified") && (
            <div className={`verification-outcome ${verificationResult.verified ? "passed" : "needs-review"}`} aria-label="Cleanup outcome">
              <div><span>{verificationResult.verified ? "✓ VERIFIED CLEAR" : "! HUMAN REVIEW"}</span><strong>{verificationResult.verified ? "Cleanup evidence passed" : "Cleanup evidence is not conclusive"}</strong></div>
              <div><small>Priority risk</small><b>{verificationBeforeRisk}/100 → {verificationAfterRisk ?? "—"}/100</b></div>
              <div><small>Visible litter</small><b>{analysis.litter}% → {verificationResult.litter}%</b></div>
            </div>
          )}
          {verificationResult?.verified && verificationReveal === "verified" && (
            <div className="verification-finale" aria-label="DrainGuard final decision story">
              <p>One photo found the problem.</p><p>Changing conditions changed the decision.</p><p>One crew received the plan.</p><p>One more photo proved it was solved.</p>
              <strong>DRAINGUARD AI</strong><span>Detect the problem. Decide what to do. Prove it was solved.</span>
              <b>DETECT → PRIORITIZE → ALLOCATE → ACT → VERIFY</b>
            </div>
          )}
          <VerificationChecklist checks={verificationChecks} />
        </div>
        <div className={`verification-card ${cleaned ? "is-clean" : ""}`}>
          <div className="comparison-toolbar" role="group" aria-label="Before and after comparison view">
            <span>Evidence comparison</span>
            <div>
              <button type="button" className={comparisonMode === "side-by-side" ? "active" : ""} onClick={() => setComparisonMode("side-by-side")}>Side by side</button>
              <button type="button" className={comparisonMode === "slider" ? "active" : ""} onClick={() => setComparisonMode("slider")} disabled={!verificationImageUrl}>Slider</button>
            </div>
          </div>
          {comparisonMode === "slider" && verificationImageUrl ? (
            <div className="comparison-slider">
              <div className="comparison-slider-layer comparison-slider-before">
                <NextImage src={imageUrl} alt="Drain before cleanup" fill sizes="(max-width: 1000px) 100vw, 54vw" loading="eager" unoptimized />
              </div>
              <div className="comparison-slider-layer comparison-slider-after" style={{ clipPath: `inset(0 ${100 - comparisonSplit}% 0 0)` }}>
                <NextImage src={verificationImageUrl} alt="Drain after cleanup" fill sizes="(max-width: 1000px) 100vw, 54vw" unoptimized />
              </div>
              <span className="comparison-label comparison-label-before">Before · {analysis.blockage}% blocked</span>
              <span className="comparison-label comparison-label-after">After · {verificationResult ? `${verificationResult.blockage}% blocked` : "waiting"}</span>
              <div className="comparison-slider-handle" style={{ left: `${comparisonSplit}%` }} aria-hidden="true"><span>↔</span></div>
              {cleaned && <div className="clean-mask"><span>✓ Evidence passed</span></div>}
            </div>
          ) : (
            <div className="comparison-grid">
              <div className="comparison-pane">
                <NextImage src={imageUrl} alt="Drain before cleanup" fill sizes="(max-width: 1000px) 50vw, 27vw" loading="eager" unoptimized />
                <span className="comparison-label">Before · {analysis.blockage}% blocked</span>
              </div>
              <div className={`comparison-pane after-pane ${verificationImageUrl ? "has-photo" : ""}`}>
                {verificationImageUrl ? (
                  <NextImage src={verificationImageUrl} alt="Drain after cleanup" fill sizes="(max-width: 1000px) 50vw, 27vw" unoptimized />
                ) : (
                  <div className="after-placeholder"><span>+</span><p>After photo appears here</p></div>
                )}
                <span className="comparison-label">After · {verificationResult ? `${verificationResult.blockage}% blocked` : "waiting"}</span>
                {cleaned && <div className="clean-mask"><span>✓ Evidence passed</span></div>}
              </div>
            </div>
          )}
          {comparisonMode === "slider" && verificationImageUrl && (
            <label className="comparison-range">Drag to compare <input type="range" min="5" max="95" value={comparisonSplit} onChange={(event) => setComparisonSplit(Number(event.target.value))} aria-label="Before and after comparison split" /> <span>{comparisonSplit}% after</span></label>
          )}
          <div className="verification-evidence-meta">
            <span><b>Same-drain anchor</b> {selectedSite.lat.toFixed(4)}, {selectedSite.lon.toFixed(4)}</span>
            <span><b>Evidence pair</b> {verificationImageUrl ? `${fileName} + ${verificationFileName}` : "Awaiting after photo"}</span>
            <span><b>Captured</b> {evidenceBySite[selectedSite.id]?.updatedAt ? new Date(evidenceBySite[selectedSite.id].updatedAt).toLocaleString() : "Not yet recorded"}</span>
          </div>
          <div className="verify-stats">
            <div><span>Before</span><strong>{analysis.blockage}<small>% blocked</small></strong></div>
            <div><span>After</span><strong>{verificationResult?.blockage ?? "—"}<small>{verificationResult ? "% blocked" : " awaiting photo"}</small></strong></div>
            <div><span>Change</span><strong>{verificationResult ? (verificationResult.reduction > 0 ? `−${verificationResult.reduction}` : "0") : "—"}<small> points</small></strong></div>
            <div><span>Same drain</span><strong>{verificationResult ? verificationResult.sceneMatch ?? 0 : "—"}<small>{verificationResult ? "% match" : " awaiting photo"}</small></strong></div>
            <div><span>Status</span><strong className={`status-text ${verificationResult && !cleaned ? "needs-review" : ""}`}>{cleaned ? "Verified" : verificationResult ? "Review" : "Open"}</strong></div>
          </div>
        </div>
      </section>

      <section className="method-section" id="method">
        <div className="method-head">
          <span className="kicker">How the intelligence works</span>
          <h2>AI proposes. Evidence explains.<br />People decide.</h2>
        </div>
        <div className="method-grid">
          <article><span>01</span><h3>See</h3><p>A research-backed ResNet-50 classifies blockage locally in the browser. A drain-domain gate rejects uncertain photos; COCO-SSD is used only for visible litter.</p></article>
          <article><span>02</span><h3>Score</h3><p>Central configuration drives cleanup priority and a separate environmental decision-support estimate. Missing waterway context lowers coverage instead of becoming a fake value.</p></article>
          <article><span>03</span><h3>Allocate</h3><p>The system ranks inspections and turns limited capacity into a concise, traceable field plan for cleanup teams.</p></article>
          <article><span>04</span><h3>Verify</h3><p>A normalized scene fingerprint must match the original drain before blockage reduction can close the task. Uncertain pairs go to human review.</p></article>
        </div>
        <div className="model-evaluation-panel" id="model-evaluation">
          <div className="model-evaluation-head">
            <div>
              <span className="kicker">Held-out AI evaluation</span>
              <h3>{(modelEvaluation.test.accuracy * 100).toFixed(1)}% accuracy on unseen cameras.</h3>
              <p>Balanced blocked-versus-clear audit using the four cameras held out by the source research.</p>
            </div>
            <div className="model-audit-badge"><strong>{modelEvaluation.test.samples}</strong><span>labelled test images</span></div>
          </div>
          <div className="model-metrics">
            <div><span>Blocked recall</span><strong>{Math.round(modelEvaluation.test.recall * 100)}%</strong><small>{modelEvaluation.test.confusionMatrix.tp} / {modelEvaluation.test.confusionMatrix.tp + modelEvaluation.test.confusionMatrix.fn} blocked caught</small></div>
            <div><span>Clear specificity</span><strong>{Math.round(modelEvaluation.test.specificity * 100)}%</strong><small>{modelEvaluation.test.confusionMatrix.tn} / {modelEvaluation.test.confusionMatrix.tn + modelEvaluation.test.confusionMatrix.fp} clear correct</small></div>
            <div><span>Precision</span><strong>{Math.round(modelEvaluation.test.precision * 100)}%</strong><small>{modelEvaluation.test.confusionMatrix.fp} false alarms</small></div>
            <div><span>F1 score</span><strong>{modelEvaluation.test.f1.toFixed(2)}</strong><small>balanced classification quality</small></div>
          </div>
          <div className="model-evaluation-body">
            <div>
              <span className="matrix-title">Confusion matrix · held-out audit</span>
              <table className="confusion-matrix">
                <thead><tr><th>Actual</th><th>Predicted blocked</th><th>Predicted clear</th></tr></thead>
                <tbody>
                  <tr><th>Blocked</th><td className="matrix-correct">{modelEvaluation.test.confusionMatrix.tp} <small>TP</small></td><td>{modelEvaluation.test.confusionMatrix.fn} <small>FN</small></td></tr>
                  <tr><th>Clear</th><td>{modelEvaluation.test.confusionMatrix.fp} <small>FP</small></td><td className="matrix-correct">{modelEvaluation.test.confusionMatrix.tn} <small>TN</small></td></tr>
                </tbody>
              </table>
            </div>
            <div className="audit-protocol">
              <span>Audit protocol</span>
              <p>Threshold fixed on 28 images from seven different cameras, then tested once on 40 balanced images from four source-paper test cameras.</p>
              <strong>95% accuracy interval: {(modelEvaluation.test.accuracyWilson95[0] * 100).toFixed(1)}–{(modelEvaluation.test.accuracyWilson95[1] * 100).toFixed(1)}%</strong>
              <a href="https://doi.org/10.17864/1947.000498" target="_blank" rel="noreferrer">Open dataset + research weights ↗</a>
            </div>
          </div>
          <p className="model-limit"><strong>Scope:</strong> this is a reproducible proxy audit on UK trash-screen imagery, not claimed Bengaluru street-drain accuracy and not flood prediction. Uncertain field images still go to human review.</p>
        </div>
        <div className="evaluation-panel workflow-evaluation">
          <div className="evaluation-head">
            <div><span className="kicker">Safety regression</span><h3>Workflow logic also stays tested.</h3></div>
            <strong>12/12 expected decisions</strong>
          </div>
          <div className="evaluation-table-wrap">
            <table>
              <thead><tr><th>Controlled test group</th><th>Cases</th><th>Expected behavior</th><th>Decision</th></tr></thead>
              <tbody>
                <tr><td>Blocked drain controls</td><td>3</td><td>Remain open and ranked</td><td><span className="eval-pass">3/3 pass</span></td></tr>
                <tr><td>Clear drain controls</td><td>3</td><td>Low obstruction signal</td><td><span className="eval-pass">3/3 pass</span></td></tr>
                <tr><td>Same-drain cleaned pairs</td><td>2</td><td>Match scene, then verify reduction</td><td><span className="eval-pass">2/2 pass</span></td></tr>
                <tr><td>Unchanged after evidence</td><td>1</td><td>Reject zero-point reduction</td><td><span className="eval-pass">1/1 pass</span></td></tr>
                <tr><td>Different-scene after photos</td><td>2</td><td>Reject scene mismatch</td><td><span className="eval-pass">2/2 pass</span></td></tr>
                <tr><td>Non-drain input</td><td>1</td><td>Route to human review</td><td><span className="eval-pass">1/1 pass</span></td></tr>
              </tbody>
            </table>
          </div>
          <p className="evaluation-note">Twelve deterministic checks cover ranking, clear evidence, unchanged cleanup, wrong-scene evidence, and non-drain review routing. These verify workflow policy separately from the model audit above.</p>
        </div>
        <TrustPanel />
        <ValidationPanel />
        <JudgeQuestions />
        <div className="responsibility-note">
          <strong>Responsible use</strong>
          <p>DrainGuard supports inspection prioritization. It does not predict floods, measure pollution volume, or replace hydrological and engineering assessment. Scores depend on image quality, rainfall inputs, and available map context.</p>
          <span>Prototype v0.15 · Judge-ready pilot</span>
        </div>
      </section>

      <footer>
        <div className="brand footer-brand"><span className="brand-mark">DG</span><span>DrainGuard <i>AI</i></span></div>
        <p>Detect. Prioritize. Adapt. Allocate. Verify. Close.</p>
        <div><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather: Open-Meteo</a><a href="https://doi.org/10.17864/1947.000498" target="_blank" rel="noreferrer">Model/data: U. Reading</a><a href="https://www.michigan.gov/egle/about/organization/water-resources/stormwater" target="_blank" rel="noreferrer">Sample: Michigan EGLE</a></div>
      </footer>

      {reportOpen && (
        <div className="modal-backdrop" role="presentation">
          <section className="report-modal" role="dialog" aria-modal="true" aria-labelledby="report-title">
            <button className="modal-close" onClick={() => setReportOpen(false)} aria-label="Close field brief">×</button>
            <span className="kicker">Actionable evidence</span>
            <h2 id="report-title">Field brief ready.</h2>
            <pre>{report}</pre>
            <div className="modal-actions">
              <button className="button" onClick={copyReport}>{copied ? "✓ Copied" : "Copy brief"}</button>
              <button className="button button-outline" onClick={() => setReportOpen(false)}>Close</button>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
