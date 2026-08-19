import { SCORING_CONFIG, type RiskLevel } from "./config.ts";

export type ScoreFactor = {
  key: "blockage" | "rainfall" | "litter" | "waterwayProximity";
  name: string;
  rawValue: number | null;
  weight: number;
  contribution: number | null;
  explanation: string;
};

export type ExplainedScore = {
  score: number;
  level: RiskLevel;
  factors: ScoreFactor[];
  confidence: "low" | "medium" | "high";
  coverage: number;
  limitations: string[];
};

export function clampScore(value: number) {
  return Math.min(100, Math.max(0, value));
}

export function rainfallExposureIndex(rainfallMm: number) {
  return clampScore((Math.max(0, rainfallMm) / SCORING_CONFIG.rainfall.fullExposureMm) * 100);
}

export function scoreLevel(score: number): RiskLevel {
  if (score >= 80) return "critical";
  if (score >= 60) return "high";
  if (score >= 40) return "moderate";
  return "low";
}

export function recommendedAction(score: number, verified = false) {
  if (verified) return "Cleanup verified. Continue routine monitoring.";
  if (score >= 80) return "Inspect and clean as soon as operationally practical.";
  if (score >= 60) return "Schedule inspection and cleanup within 24 hours.";
  if (score >= 40) return "Keep on the watchlist and reassess after rainfall.";
  return "Continue routine monitoring.";
}

export function calculatePriorityScore(input: {
  blockage: number;
  litter: number;
  rainfallMm: number;
  evidenceConfidence?: number;
}): ExplainedScore {
  const blockage = clampScore(input.blockage);
  const litter = clampScore(input.litter);
  const rainfall = rainfallExposureIndex(input.rainfallMm);
  const weights = SCORING_CONFIG.priority;
  const factors: ScoreFactor[] = [
    {
      key: "blockage",
      name: "Blockage severity",
      rawValue: blockage,
      weight: weights.blockage,
      contribution: blockage * weights.blockage,
      explanation: blockage >= 70 ? "Visible obstruction is the largest contributor to cleanup urgency." : "Visible obstruction contributes to the cleanup priority.",
    },
    {
      key: "rainfall",
      name: "Rainfall exposure",
      rawValue: rainfall,
      weight: weights.rainfall,
      contribution: rainfall * weights.rainfall,
      explanation: `Based on ${Math.max(0, input.rainfallMm).toFixed(1)} mm in the selected live or scenario context.`,
    },
    {
      key: "litter",
      name: "Visible litter",
      rawValue: litter,
      weight: weights.litter,
      contribution: litter * weights.litter,
      explanation: litter >= 60 ? "Strong visible litter evidence increases cleanup urgency." : "Visible litter evidence contributes to prioritization.",
    },
  ];
  const score = Math.round(factors.reduce((total, factor) => total + (factor.contribution ?? 0), 0));
  const confidence = (input.evidenceConfidence ?? 70) >= 80 ? "high" : (input.evidenceConfidence ?? 70) >= 60 ? "medium" : "low";

  return {
    score,
    level: scoreLevel(score),
    factors,
    confidence,
    coverage: 100,
    limitations: ["Decision-support score; not a flood prediction or emergency alert."],
  };
}

