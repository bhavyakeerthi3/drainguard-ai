# 90-second hackathon demo script

**Start:** Open the deployed site and click **Run the 90-second judge demo**. The guided narrator now uses the same six-stage story as this script: See → Understand → Adapt → Decide → Verify → Close the loop.

## 0:00–0:10 — Hook

**Screen:** DrainGuard hero and environmental pathway.

> Street litter does not stay on the street. When a drain is blocked, rainfall can move visible waste toward waterways. DrainGuard helps teams decide where to act first.

## 0:10–0:24 — See and inspect

**Screen:** Select “Heavy blockage + litter” in Demo Mode, then show the photo result.

> A field worker uploads one photo. A domain-specific ResNet-50 estimates blockage locally in the browser, while COCO-SSD is used separately for visible litter. Uncertain or unrelated photos go to review.

## 0:24–0:40 — Understand and adapt

**Screen:** Show “Why this priority?” and apply the heavy-rain scenario.

> Every score is explainable. Cleanup priority combines blockage, rainfall, and litter. A separate environmental estimate adds mapped waterway proximity. If that context is unavailable, the app says so and lowers evidence coverage. The scenario explorer shows sensitivity; it does not predict flooding.

## 0:40–0:54 — Decide with limited capacity

**Screen:** Show the environmental risk map and Demo preview dashboard.

> Set Available crews to 1 and Inspection capacity to 2. The Action Planner selects the highest-priority reports and explains why another report waits. This is capacity allocation, not route optimization.

## 0:54–1:14 — Verify

**Screen:** Show before/after verification and its four checks.

> Cleanup is not complete until evidence passes. DrainGuard checks the same scene, drain confidence, obstruction improvement, and residual litter. Any failed check explains exactly why a person must review it.

## 1:14–1:30 — Close

**Screen:** Held-out AI evaluation, then Validation & Limitations.

> DrainGuard does not stop at detection. It connects evidence to priority, priority to a limited-resource decision, and action to verification. The final memory is: the drains did not change, the conditions did, so the decision changed—and the cleanup was proved with evidence.
