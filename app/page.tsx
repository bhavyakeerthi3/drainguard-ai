"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import NextImage from "next/image";
import { DrainMap, type MapSite } from "./DrainMap";
import { isDrainConfirmed, passesCleanupVerification, SAME_DRAIN_THRESHOLD } from "../lib/decisions.js";

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
  version: 1;
  sites: MapSite[];
  evidence: Record<string, EvidenceRecord>;
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
  drainConfidence: 94,
  signal: "Drain-domain gate + litter detector",
  objects: [
    { class: "mixed litter", score: 0.91, bbox: [4, 8, 32, 32] },
    { class: "organic debris", score: 0.86, bbox: [20, 2, 29, 34] },
  ],
};

const INITIAL_SITES: MapSite[] = [
  { id: "DG-104", place: "5th Cross · Koramangala", risk: 84, status: "Dispatch now", lat: 12.9352, lon: 77.6245, rainfall: 18 },
  { id: "DG-098", place: "Market Road · Shantinagar", risk: 76, status: "Inspect today", lat: 12.9536, lon: 77.5937, rainfall: 18 },
  { id: "DG-091", place: "1st Main · Indiranagar", risk: 61, status: "Needs review", lat: 12.9784, lon: 77.6408, rainfall: 18 },
  { id: "DG-087", place: "8th Block · Jayanagar", risk: 35, status: "Verified clear", lat: 12.925, lon: 77.5938, rainfall: 18 },
];

const PILOT_STORAGE_KEY = "drainguard-pilot-v1";

let detectorPromise: Promise<Detector> | null = null;

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
  if (!context) return { texture: 0.45, debrisTone: 0.4, naturalColor: 0.35, drainStructure: 0.5, fingerprint: [] as number[] };
  context.drawImage(image, 0, 0, size, size);
  const pixels = context.getImageData(0, 0, size, size).data;
  let dark = 0;
  let earthy = 0;
  let colorful = 0;
  let edge = 0;
  let horizontalEdge = 0;
  let verticalEdge = 0;
  const luminance: number[] = [];

  for (let i = 0; i < pixels.length; i += 4) {
    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    luminance.push(lum);
    if (lum < 72) dark += 1;
    if (r > b * 1.14 && g > b * 1.04 && r < 190) earthy += 1;
    if (Math.max(r, g, b) - Math.min(r, g, b) > 22) colorful += 1;
  }

  for (let y = 1; y < size; y += 1) {
    for (let x = 1; x < size; x += 1) {
      const current = luminance[y * size + x];
      const left = luminance[y * size + x - 1];
      const above = luminance[(y - 1) * size + x];
      const horizontalDelta = Math.abs(current - above);
      const verticalDelta = Math.abs(current - left);
      if (horizontalDelta + verticalDelta > 75) edge += 1;
      if (horizontalDelta > 42) horizontalEdge += 1;
      if (verticalDelta > 42) verticalEdge += 1;
    }
  }

  const gridWidth = 12;
  const gridHeight = 8;
  const fingerprint: number[] = [];
  for (let gy = 0; gy < gridHeight; gy += 1) {
    for (let gx = 0; gx < gridWidth; gx += 1) {
      let total = 0;
      let count = 0;
      const startX = Math.floor((gx / gridWidth) * size);
      const endX = Math.floor(((gx + 1) / gridWidth) * size);
      const startY = Math.floor((gy / gridHeight) * size);
      const endY = Math.floor(((gy + 1) / gridHeight) * size);
      for (let y = startY; y < endY; y += 1) {
        for (let x = startX; x < endX; x += 1) {
          total += luminance[y * size + x];
          count += 1;
        }
      }
      fingerprint.push(total / Math.max(1, count));
    }
  }
  const mean = fingerprint.reduce((sum, value) => sum + value, 0) / fingerprint.length;
  const variance = fingerprint.reduce((sum, value) => sum + (value - mean) ** 2, 0) / fingerprint.length;
  const deviation = Math.max(12, Math.sqrt(variance));
  const normalizedFingerprint = fingerprint.map((value) => clamp((value - mean) / deviation, -2.5, 2.5));
  const edgeSamples = (size - 1) * (size - 1);
  const horizontalDensity = horizontalEdge / edgeSamples;
  const verticalDensity = verticalEdge / edgeSamples;
  const drainStructure = clamp(
    Math.min(horizontalDensity + verticalDensity, 0.34) / 0.34 * 0.62
      + Math.min(horizontalDensity, verticalDensity, 0.1) / 0.1 * 0.38,
    0,
    1,
  );

  return {
    texture: edge / ((size - 1) * (size - 1)),
    debrisTone: (dark + earthy * 0.7) / (size * size),
    naturalColor: colorful / (size * size),
    drainStructure,
    fingerprint: normalizedFingerprint,
  };
}

function calculateDrainConfidence(drainStructure: number, debrisTone: number, naturalColor: number, predictions: Detection[]) {
  const unrelatedClasses = new Set(["person", "car", "truck", "bus", "dog", "cat", "chair", "couch", "bed", "tv", "laptop"]);
  const unrelatedArea = predictions.reduce((total, item) => {
    if (!unrelatedClasses.has(item.class)) return total;
    return total + (item.bbox[2] * item.bbox[3]) / 10000;
  }, 0);
  const surfaceEvidence = Math.min(debrisTone / 0.45, 1);
  const naturalSceneEvidence = Math.min(naturalColor / 0.55, 1);
  return clamp(Math.round(18 + drainStructure * 42 + surfaceEvidence * 18 + naturalSceneEvidence * 28 - Math.min(unrelatedArea, 0.7) * 42), 8, 96);
}

function compareSceneFingerprints(before: number[], after: number[]) {
  if (before.length === 0 || before.length !== after.length) return 0;
  let dot = 0;
  let beforeMagnitude = 0;
  let afterMagnitude = 0;
  for (let index = 0; index < before.length; index += 1) {
    dot += before[index] * after[index];
    beforeMagnitude += before[index] ** 2;
    afterMagnitude += after[index] ** 2;
  }
  if (beforeMagnitude === 0 || afterMagnitude === 0) return 0;
  const correlation = dot / Math.sqrt(beforeMagnitude * afterMagnitude);
  return clamp(Math.round(((correlation + 1) / 2) * 100));
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

function actionForRisk(risk: number) {
  if (risk >= 80) return "Dispatch now";
  if (risk >= 60) return "Inspect today";
  return "Monitor";
}

export default function Home() {
  const [imageUrl, setImageUrl] = useState("/demo-drain.jpg");
  const [fileName, setFileName] = useState("EGLE stormwater sample");
  const [analysis, setAnalysis] = useState<Analysis>(SAMPLE_ANALYSIS);
  const [mode, setMode] = useState<"surge" | "live">("live");
  const [weatherStatus, setWeatherStatus] = useState("Loading location forecast");
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
  const [evidenceBySite, setEvidenceBySite] = useState<Record<string, EvidenceRecord>>({});
  const [persistenceReady, setPersistenceReady] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const verificationInput = useRef<HTMLInputElement>(null);
  const nextLocationId = useRef(105);

  const rainfall = mode === "surge" ? 64 : (selectedSite.rainfall ?? 18);
  const effectiveAnalysis = cleaned && verificationResult ? verificationResult : analysis;
  const risk = scoreRisk(effectiveAnalysis.blockage, effectiveAnalysis.litter, rainfall);
  const band = riskBand(risk);
  const sortedSites = useMemo(() => [...sites].sort((a, b) => b.risk - a.risk), [sites]);
  const reviewSites = useMemo(() => sites.filter((site) => site.status === "Needs review"), [sites]);

  useEffect(() => {
    const controller = new AbortController();
    const targetSiteId = selectedSite.id;
    fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${selectedSite.lat}&longitude=${selectedSite.lon}&daily=precipitation_sum,precipitation_probability_max&timezone=auto&forecast_days=1`,
      { signal: controller.signal },
    )
      .then((response) => response.json())
      .then((data) => {
        const precipitation = Number(data?.daily?.precipitation_sum?.[0]);
        const probability = Number(data?.daily?.precipitation_probability_max?.[0]);
        const localRain = Number.isFinite(precipitation) ? Math.max(precipitation, 1) : 18;
        const localStatus = Number.isFinite(probability)
          ? `${probability}% rain probability · ${selectedSite.place}`
          : `Location forecast · ${selectedSite.place}`;
        const locationRisk = scoreRisk(effectiveAnalysis.blockage, effectiveAnalysis.litter, localRain);
        setWeatherStatus(localStatus);
        setSites((current) => current.map((site) => {
          if (site.id !== targetSiteId) return site;
          const status = ["Needs review", "Verified clear"].includes(site.status) ? site.status : actionForRisk(locationRisk);
          return { ...site, risk: locationRisk, status, rainfall: localRain, weatherStatus: localStatus };
        }));
        setSelectedSite((current) => {
          if (current.id !== targetSiteId) return current;
          const status = ["Needs review", "Verified clear"].includes(current.status) ? current.status : actionForRisk(locationRisk);
          return { ...current, risk: locationRisk, status, rainfall: localRain, weatherStatus: localStatus };
        });
      })
      .catch(() => {
        if (!controller.signal.aborted) setWeatherStatus(`Forecast fallback · ${selectedSite.place}`);
      });
    return () => controller.abort();
  }, [effectiveAnalysis.blockage, effectiveAnalysis.litter, selectedSite.id, selectedSite.lat, selectedSite.lon, selectedSite.place]);

  /* eslint-disable react-hooks/set-state-in-effect -- Hydrate the device-persistent pilot after the client mounts. */
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(PILOT_STORAGE_KEY);
      if (raw) {
        const saved = JSON.parse(raw) as PersistedPilot;
        if (saved.version === 1 && saved.sites.length > 0) {
          setSites(saved.sites);
          setEvidenceBySite(saved.evidence ?? {});
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
    } finally {
      setPersistenceReady(true);
    }
  }, []);

  useEffect(() => {
    if (!persistenceReady) return;
    const payload: PersistedPilot = { version: 1, sites, evidence: evidenceBySite };
    try {
      window.localStorage.setItem(PILOT_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // Storage can be full or disabled; the live session remains usable.
    }
  }, [evidenceBySite, persistenceReady, sites]);
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
    setSelectedSite(site);
    setWeatherStatus(site.weatherStatus ?? `Loading forecast · ${site.place}`);
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
    if (!file.type.startsWith("image/")) return;
    event.target.value = "";
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
      setStage("idle");
    }
  }

  async function chooseVerificationImage(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !file.type.startsWith("image/")) return;
    event.target.value = "";
    setVerificationStage("loading");
    try {
      const nextUrl = await fileToStoredImage(file);
      setVerificationImageUrl(nextUrl);
      setVerificationFileName(file.name);
      setVerificationResult(null);
      setCleaned(false);
      await verifyCleanup(nextUrl, file.name);
    } catch {
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
      const baseBlockage = clamp(Math.round(24 + visual.debrisTone * 64 + visual.texture * 88), 14, 94);
      const baseLitter = clamp(Math.round(14 + visual.texture * 105), 8, 96);
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
      const blockage = clamp(baseBlockage + litterObjects * 5, 14, 94);
      const litter = clamp(baseLitter + litterObjects * 18, 8, 96);
      const reduction = Math.max(0, beforeBlockage - blockage);
      const drainConfidence = calculateDrainConfidence(visual.drainStructure, visual.debrisTone, visual.naturalColor, predictions);
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
          site.id === targetSiteId ? { ...site, risk: residualRisk, status: "Verified clear" } : site
        )));
        setSelectedSite((current) => (
          current.id === targetSiteId ? { ...current, risk: residualRisk, status: "Verified clear" } : current
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
      const baseBlockage = clamp(Math.round(24 + visual.debrisTone * 64 + visual.texture * 88), 14, 94);
      const baseLitter = clamp(Math.round(14 + visual.texture * 105), 8, 96);

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
      const blockage = clamp(baseBlockage + litterObjects * 5, 14, 94);
      const litter = clamp(baseLitter + litterObjects * 18, 8, 96);
      const drainConfidence = calculateDrainConfidence(visual.drainStructure, visual.debrisTone, visual.naturalColor, predictions);
      const confidence = Math.min(
        drainConfidence,
        clamp(Math.round((modelUsed ? 78 : 59) + Math.min(predictions.length, 4) * 3), 0, 94),
      );
      const drainConfirmed = isDrainConfirmed(drainConfidence);

      const finalAnalysis: Analysis = {
        blockage,
        litter,
        confidence,
        drainConfidence,
        fingerprint: visual.fingerprint,
        objects: predictions,
        signal: drainConfirmed
          ? (modelUsed ? "Drain gate + COCO litter detector" : "Drain gate · offline litter estimate")
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
      const nextStatus = drainConfirmed ? actionForRisk(resultRisk) : "Needs review";
      setSites((current) => current.map((site) => (
        site.id === targetSiteId ? { ...site, risk: resultRisk, status: nextStatus } : site
      )));
      setSelectedSite((current) => (
        current.id === targetSiteId ? { ...current, risk: resultRisk, status: nextStatus } : current
      ));
      setStage("done");
    } catch {
      setAnalysis((current) => ({ ...current, signal: "Could not read this image" }));
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

      const site: MapSite = {
        id: `DG-${nextLocationId.current++}`,
        place: result.place,
        risk,
        status: actionForRisk(risk),
        lat: result.lat,
        lon: result.lon,
        rainfall,
        weatherStatus,
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
      setLocationStatus(`Garbage marker added at ${site.place}.`);
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
    const status = actionForRisk(site.risk);
    setSites((current) => current.map((item) => item.id === site.id ? { ...item, status } : item));
    setSelectedSite((current) => current.id === site.id ? { ...current, status } : current);
  }

  function restoreSample() {
    setImageUrl("/demo-drain.jpg");
    setFileName("EGLE stormwater sample");
    setAnalysis(SAMPLE_ANALYSIS);
    setMode("surge");
    setVerificationImageUrl(null);
    setVerificationFileName("");
    setVerificationResult(null);
    setVerificationStage("idle");
    setCleaned(false);
    setStage("idle");
  }

  const report = `DRAINGUARD FIELD BRIEF · ${selectedSite.id}\nPriority: ${band.label.toUpperCase()} (${risk}/100)\nLocation: ${selectedSite.place}\nObserved blockage: ${effectiveAnalysis.blockage}%\nLitter signal: ${effectiveAnalysis.litter}%\nVerification: ${cleaned ? `Passed · ${verificationResult?.reduction ?? 0} point obstruction reduction` : "Pending field evidence"}\nRain scenario: ${rainfall.toFixed(1)} mm / 24h\n\nRecommended action: ${cleaned ? "Cleanup verified from the after photo. Continue routine monitoring." : risk >= 80 ? "Dispatch a cleanup crew before the next rainfall window. Photograph the cleared inlet to close the task." : risk >= 60 ? "Inspect and clear within 24 hours." : "Monitor and re-check after rainfall."}\n\nThis is a prioritization aid, not a flood prediction or emergency alert.`;

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
              <NextImage id="inspection-image" src={imageUrl} alt="Storm drain submitted for inspection" fill sizes="(max-width: 1000px) 100vw, 62vw" unoptimized />
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
              <span className="photo-time">14 Aug · 18:42</span>
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
                <strong>{effectiveAnalysis.blockage}%</strong>
              </div>
              <div className="signal-row">
                <div><span className="signal-icon">⌁</span><span>Rainfall exposure<small>{mode === "surge" ? "Demo monsoon scenario" : weatherStatus}</small></span></div>
                <strong>{rainfall.toFixed(1)}<small> mm</small></strong>
              </div>
              <div className="signal-row">
                <div><span className="signal-icon">◇</span><span>Litter signal<small>Objects + visual texture</small></span></div>
                <strong>{effectiveAnalysis.litter}%</strong>
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
            <p className="confidence">Drain presence {analysis.drainConfidence ?? analysis.confidence}% · evidence confidence {analysis.confidence}% · human verification required</p>
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
            <div className="map-top"><span>{selectedSite.place}</span><span>{sites.length} mapped reports</span></div>
            <DrainMap sites={sites} selectedId={selectedSite.id} onSelect={selectSite} />
          </div>

          <div className="queue-card">
            <div className="queue-heading"><span>Cleanup queue</span><span>Sorted by risk</span></div>
            {sortedSites.map((site, index) => (
              <button className={`queue-row ${selectedSite.id === site.id ? "active" : ""}`} key={site.id} onClick={() => selectSite(site)}>
                <span className="queue-rank">{String(index + 1).padStart(2, "0")}</span>
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

        <div className="review-board" aria-label="Human review queue">
          <div className="review-board-head">
            <div><span className="kicker">Human review</span><h3>Evidence that needs a person.</h3></div>
            <strong>{reviewSites.length} waiting</strong>
          </div>
          <div className="review-list">
            {reviewSites.length === 0 && <p className="review-empty">No uncertain reports. Failed or low-confidence checks will appear here automatically.</p>}
            {reviewSites.map((site) => {
              const verification = evidenceBySite[site.id]?.verification;
              return (
                <article className="review-item" key={site.id}>
                  <div><span>{site.id}</span><strong>{site.place}</strong></div>
                  <p>{verification
                    ? (!verification.sameDrain
                      ? `Scene match ${verification.sceneMatch ?? 0}%—the system could not prove this is the same drain.`
                      : `After-photo comparison reduced obstruction by ${verification.reduction} points—below the automatic-clear threshold.`)
                    : "Low-confidence or non-drain evidence requires a field officer to check the inlet."}</p>
                  <div className="review-actions">
                    <button className="button button-outline" onClick={() => openReview(site)}>Open evidence</button>
                    <button className="review-keep" onClick={() => keepReportOpen(site)}>Keep open</button>
                  </div>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      <section className="verification-section" id="verify">
        <div className="verification-copy">
          <span className="kicker">03 · Verify</span>
          <h2>Close the loop,<br />not just the ticket.</h2>
          <p>After the crew cleans this drain, upload a second photo. The AI compares obstruction and litter with the original evidence before closing the report.</p>
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
            {verificationResult?.verified && `Verified: ${verificationResult.sceneMatch}% same-drain match and visible obstruction fell by ${verificationResult.reduction} points. ${selectedSite.id} is now marked clear.`}
            {verificationResult && !verificationResult.verified && (!verificationResult.sameDrain
              ? `Needs review: only ${verificationResult.sceneMatch ?? 0}% scene match. Re-photograph the same drain from a similar angle.`
              : `Needs review: obstruction changed by ${verificationResult.reduction} points. Upload a clearer after photo showing the full drain inlet.`)}
          </p>
        </div>
        <div className={`verification-card ${cleaned ? "is-clean" : ""}`}>
          <div className="comparison-grid">
            <div className="comparison-pane">
              <NextImage src={imageUrl} alt="Drain before cleanup" fill sizes="(max-width: 1000px) 50vw, 27vw" unoptimized />
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
          <div className="verify-stats">
            <div><span>Before</span><strong>{analysis.blockage}<small>% blocked</small></strong></div>
            <div><span>After</span><strong>{verificationResult?.blockage ?? "—"}<small>{verificationResult ? "% blocked" : " awaiting photo"}</small></strong></div>
            <div><span>Change</span><strong>{verificationResult ? (verificationResult.reduction > 0 ? `−${verificationResult.reduction}` : "0") : "—"}<small> points</small></strong></div>
            <div><span>Same drain</span><strong>{verificationResult ? verificationResult.sceneMatch : "—"}<small>{verificationResult ? "% match" : " awaiting photo"}</small></strong></div>
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
          <article><span>01</span><h3>See</h3><p>A drain-domain structure gate first rejects uncertain or non-drain photos. COCO-SSD is used only for visible litter—not as a drain model.</p></article>
          <article><span>02</span><h3>Score</h3><p>A published formula weights blockage 55%, rainfall 30%, and litter 15% into one priority score.</p></article>
          <article><span>03</span><h3>Act</h3><p>The system ranks inspections and generates a concise, traceable field brief for cleanup teams.</p></article>
          <article><span>04</span><h3>Verify</h3><p>A normalized scene fingerprint must match the original drain before blockage reduction can close the task. Uncertain pairs go to human review.</p></article>
        </div>
        <div className="evaluation-panel">
          <div className="evaluation-head">
            <div><span className="kicker">Prototype evaluation</span><h3>Expanded decision regression.</h3></div>
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
          <p className="evaluation-note">Twelve deterministic regression checks across blocked, clear, unchanged, wrong-scene, and non-drain decisions. This tests workflow logic—not field accuracy. The next milestone is an independently labelled Bengaluru set with precision, recall, and false-positive reporting.</p>
        </div>
        <div className="responsibility-note">
          <strong>Responsible use</strong>
          <p>DrainGuard prioritizes inspections; it does not predict floods or replace engineering assessment. Scores depend on image quality and local rainfall data.</p>
          <span>Prototype v0.10</span>
        </div>
      </section>

      <footer>
        <div className="brand footer-brand"><span className="brand-mark">DG</span><span>DrainGuard <i>AI</i></span></div>
        <p>See a drain. Stop a flood.</p>
        <div><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Weather: Open-Meteo</a><a href="https://www.michigan.gov/egle/about/organization/water-resources/stormwater" target="_blank" rel="noreferrer">Sample image: Michigan EGLE</a></div>
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
