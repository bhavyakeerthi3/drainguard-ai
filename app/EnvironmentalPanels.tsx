"use client";

import { useMemo, useState } from "react";
import type { MapSite } from "./DrainMap";
import type { ExplainedScore } from "../lib/scoring/priority.ts";
import type { RainfallScenario } from "../lib/scoring/rainfallScenarios.ts";

export type DashboardRecord = MapSite & {
  verifiedReduction?: number;
};

export type DemoScenario = {
  id: string;
  title: string;
  description: string;
  blockage: number;
  litter: number;
  rainfallMm: number;
  status: string;
  environmentalDistanceMeters: number | null;
};

export type VerificationCheck = {
  label: string;
  detail: string;
  state: "pass" | "fail" | "waiting";
};

function levelLabel(level: ExplainedScore["level"]) {
  return level === "moderate" ? "Moderate" : `${level[0].toUpperCase()}${level.slice(1)}`;
}

export function PriorityExplanation({
  priority,
  environmental,
  action,
}: {
  priority: ExplainedScore;
  environmental: ExplainedScore;
  action: string;
}) {
  return (
    <section className="explanation-panel" aria-labelledby="priority-explanation-title">
      <div className="explanation-heading">
        <div>
          <span className="kicker">Why this priority?</span>
          <h3 id="priority-explanation-title">Every point has a visible reason.</h3>
        </div>
        <div className={`explanation-score level-${priority.level}`}>
          <span>Cleanup priority</span>
          <strong>{priority.score}<small>/100</small></strong>
          <b>{levelLabel(priority.level)}</b>
        </div>
      </div>
      <div className="factor-grid">
        {environmental.factors.map((factor) => (
          <article key={factor.key} className={factor.rawValue === null ? "factor-unavailable" : ""}>
            <div className="factor-topline">
              <span>{factor.name}</span>
              <b>{factor.rawValue === null ? "Unavailable" : `${Math.round(factor.rawValue)}/100`}</b>
            </div>
            <div className="factor-bar" aria-label={`${factor.name}: ${factor.rawValue === null ? "unavailable" : `${Math.round(factor.rawValue)} out of 100`}`}>
              <span style={{ width: `${factor.rawValue ?? 0}%` }} />
            </div>
            <p>{factor.explanation}</p>
            <small>{factor.contribution === null ? "Not included" : `${Math.round(factor.weight * 100)}% weight · ${factor.contribution.toFixed(1)} points`}</small>
          </article>
        ))}
      </div>
      <div className="environmental-result">
        <div>
          <span>Environmental impact risk</span>
          <strong>{environmental.score}/100 · {levelLabel(environmental.level)}</strong>
        </div>
        <div>
          <span>Evidence coverage</span>
          <strong>{environmental.coverage}% · {environmental.confidence} confidence</strong>
        </div>
        <p><b>Recommended action:</b> {action}</p>
      </div>
      <p className="decision-disclaimer">Environmental decision-support estimate. This helps prioritize inspection using visible blockage, litter evidence, rainfall conditions, and mapped environmental context. It is not a hydrological model or a prediction of pollution volume.</p>
    </section>
  );
}

export function RainfallScenarioExplorer({
  scenarios,
  onApply,
}: {
  scenarios: RainfallScenario[];
  onApply: (rainfallMm: number) => void;
}) {
  return (
    <section className="scenario-explorer" aria-labelledby="scenario-title">
      <div className="scenario-heading">
        <div><span className="kicker">Rainfall scenario explorer</span><h3 id="scenario-title">One drain. Three operating conditions.</h3></div>
        <p>Scenario exploration for decision support. These are controlled inputs, not a weather forecast or a prediction of flooding or pollution volume.</p>
      </div>
      <div className="scenario-grid">
        {scenarios.map((scenario) => (
          <button key={scenario.key} type="button" onClick={() => onApply(scenario.rainfallMm)}>
            <span>{scenario.label}</span>
            <strong>{scenario.priority}<small>/100 cleanup</small></strong>
            <div className="scenario-bar"><i style={{ width: `${scenario.priority}%` }} /></div>
            <p>{scenario.rainfallMm} mm input · environmental concern {scenario.environmentalRisk}/100</p>
            <b>Apply scenario →</b>
          </button>
        ))}
      </div>
    </section>
  );
}

export function EnvironmentalDashboard({ records }: { records: DashboardRecord[] }) {
  const liveRecords = useMemo(() => records.filter((record) => !record.isDemo), [records]);
  const demoRecords = useMemo(() => records.filter((record) => record.isDemo), [records]);
  const [showDemo, setShowDemo] = useState(false);
  const activeRecords = showDemo ? demoRecords : liveRecords;
  const metrics = useMemo(() => {
    let highConcern = 0;
    let awaitingCleanup = 0;
    let verified = 0;
    let review = 0;
    let reductionTotal = 0;
    let reductionCount = 0;
    const distribution = { low: 0, moderate: 0, high: 0, critical: 0 };

    for (const record of activeRecords) {
      const environmentalRisk = record.environmentalRisk ?? record.risk;
      if (environmentalRisk >= 60) highConcern += 1;
      if (record.status === "Verified clear") verified += 1;
      else awaitingCleanup += 1;
      if (record.status === "Needs review") review += 1;
      if (typeof record.verifiedReduction === "number") {
        reductionTotal += record.verifiedReduction;
        reductionCount += 1;
      }
      if (environmentalRisk >= 80) distribution.critical += 1;
      else if (environmentalRisk >= 60) distribution.high += 1;
      else if (environmentalRisk >= 40) distribution.moderate += 1;
      else distribution.low += 1;
    }
    return {
      total: activeRecords.length,
      highConcern,
      awaitingCleanup,
      verified,
      review,
      averageReduction: reductionCount ? Math.round(reductionTotal / reductionCount) : null,
      distribution,
    };
  }, [activeRecords]);

  return (
    <section className="impact-dashboard" id="dashboard" aria-labelledby="dashboard-title">
      <div className="dashboard-heading">
        <div><span className="kicker">Live impact story</span><h2 id="dashboard-title">What changed because we prioritized these drains?</h2></div>
        <div className="dataset-toggle" role="group" aria-label="Dashboard dataset">
          <button className={!showDemo ? "active" : ""} type="button" onClick={() => setShowDemo(false)}>Live reports</button>
          <button className={showDemo ? "active" : ""} type="button" onClick={() => setShowDemo(true)}>Demo preview</button>
        </div>
      </div>
      <p className="dataset-label">{showDemo ? "Sample data for demonstration — never presented as municipal impact." : "Calculated only from reports added on this device. Demo scenarios are excluded."}</p>
      {metrics.total === 0 ? (
        <div className="dashboard-empty">
          <strong>No live reports yet.</strong>
          <p>Add a location after inspecting a photo, or select Demo preview to see how the dashboard responds.</p>
        </div>
      ) : (
        <>
          <div className="metric-grid">
            <article><span>Total reports</span><strong>{metrics.total}</strong><small>in selected dataset</small></article>
            <article><span>High concern</span><strong>{metrics.highConcern}</strong><small>environmental risk ≥ 60</small></article>
            <article><span>Awaiting cleanup</span><strong>{metrics.awaitingCleanup}</strong><small>not verified clear</small></article>
            <article><span>Verified cleanups</span><strong>{metrics.verified}</strong><small>evidence checks passed</small></article>
            <article><span>Human review</span><strong>{metrics.review}</strong><small>uncertain evidence</small></article>
            <article><span>Avg. improvement</span><strong>{metrics.averageReduction ?? "—"}</strong><small>{metrics.averageReduction === null ? "no verified pairs" : "obstruction points"}</small></article>
          </div>
          <div className="distribution-card">
            <div><span>Reports by environmental risk level</span><strong>{metrics.total} total</strong></div>
            {Object.entries(metrics.distribution).map(([level, count]) => (
              <div className="distribution-row" key={level}>
                <span>{level}</span>
                <div><i className={`distribution-${level}`} style={{ width: `${metrics.total ? (count / metrics.total) * 100 : 0}%` }} /></div>
                <strong>{count}</strong>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}

export function DemoMode({ scenarios, onSelect }: { scenarios: DemoScenario[]; onSelect: (scenario: DemoScenario) => void }) {
  return (
    <section className="demo-mode" aria-labelledby="demo-mode-title">
      <div className="demo-heading"><div><span className="kicker">Two-minute judge walkthrough</span><h3 id="demo-mode-title">Demo mode</h3></div><strong>Sample data for demonstration</strong></div>
      <p>Select a controlled scenario to update the inspection, scoring, explanation, and map workflow. These examples are not real municipal observations.</p>
      <div className="demo-grid">
        {scenarios.map((scenario, index) => (
          <button key={scenario.id} type="button" onClick={() => onSelect(scenario)}>
            <span>{String(index + 1).padStart(2, "0")}</span>
            <strong>{scenario.title}</strong>
            <small>{scenario.description}</small>
          </button>
        ))}
      </div>
    </section>
  );
}

export function VerificationChecklist({ checks }: { checks: VerificationCheck[] }) {
  return (
    <div className="verification-checklist" aria-label="Verification decision checks">
      {checks.map((check) => (
        <div className={`check-${check.state}`} key={check.label}>
          <span aria-hidden="true">{check.state === "pass" ? "✓" : check.state === "fail" ? "!" : "·"}</span>
          <div><strong>{check.label}</strong><small>{check.detail}</small></div>
        </div>
      ))}
    </div>
  );
}

export function ValidationPanel() {
  return (
    <section className="validation-panel" aria-labelledby="validation-title">
      <div className="validation-heading">
        <div><span className="kicker">Validation & limitations</span><h3 id="validation-title">What the prototype proves—and what it does not.</h3></div>
        <strong>Automated decision suite</strong>
      </div>
      <div className="validation-columns">
        <div>
          <h4>Executable checks</h4>
          <ul>
            <li>✓ Cleanup-priority weighting and thresholds</li>
            <li>✓ Environmental-risk weighting and missing-context behavior</li>
            <li>✓ Rainfall sensitivity across controlled scenarios</li>
            <li>✓ Before/after scene mismatch detection</li>
            <li>✓ Human-review routing and cleanup gates</li>
          </ul>
        </div>
        <div>
          <h4>Still requires field validation</h4>
          <ul>
            <li>Drain detection and blockage-estimation accuracy</li>
            <li>Environmental-risk calibration</li>
            <li>Real-world precision, recall, and false-positive rates</li>
            <li>Bias across lighting, devices, seasons, and weather</li>
            <li>Coverage and freshness of mapped water features</li>
          </ul>
        </div>
      </div>
      <p>Passing workflow tests demonstrates deterministic product behavior. It does not establish scientific validity or field-model accuracy.</p>
    </section>
  );
}

export function TrustPanel() {
  return (
    <section className="trust-panel" aria-labelledby="trust-title">
      <div><span className="kicker">Trust principles</span><h3 id="trust-title">Why should you trust this recommendation?</h3></div>
      <div className="trust-grid">
        <article><strong>Evidence, not magic</strong><p>Every priority exposes the blockage, litter, rainfall, and context evidence contributing to it.</p></article>
        <article><strong>Missing data stays missing</strong><p>Unavailable map or weather context lowers coverage instead of becoming a fabricated value.</p></article>
        <article><strong>Humans remain in control</strong><p>Low-confidence images, mismatched scenes, and uncertain cleanup evidence route to review.</p></article>
      </div>
    </section>
  );
}
