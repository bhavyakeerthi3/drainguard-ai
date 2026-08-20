# 90-second hackathon demo script

## 0:00–0:10 — Hook

**Screen:** DrainGuard hero and environmental pathway.

> Street litter does not stay on the street. When a drain is blocked, rainfall can move visible waste toward waterways. DrainGuard helps teams decide where to act first.

## 0:10–0:27 — Inspect

**Screen:** Select “Heavy blockage + litter” in Demo Mode, then show the photo result.

> A field worker uploads one photo. A domain-specific ResNet-50 estimates blockage locally in the browser, while COCO-SSD is used separately for visible litter. Uncertain or unrelated photos go to review.

## 0:27–0:44 — Explain and explore

**Screen:** Show “Why this priority?” and apply the heavy-rain scenario.

> Every score is explainable. Cleanup priority combines blockage, rainfall, and litter. A separate environmental estimate adds mapped waterway proximity. If that context is unavailable, the app says so and lowers evidence coverage. The scenario explorer shows sensitivity; it does not predict flooding.

## 0:44–0:58 — Map and dashboard

**Screen:** Show the environmental risk map and Demo preview dashboard.

> Reports are ranked highest priority first. Map symbols show environmental concern, cleanup status, and human review without relying only on color. The dashboard uses stored reports and clearly labels sample data.

## 0:58–1:16 — Verify

**Screen:** Show before/after verification and its four checks.

> Cleanup is not complete until evidence passes. DrainGuard checks the same scene, drain confidence, obstruction improvement, and residual litter. Any failed check explains exactly why a person must review it.

## 1:16–1:30 — Validation and close

**Screen:** Held-out AI evaluation, then Validation & Limitations.

> On a balanced audit from four held-out cameras, the deployed model reached 92.5% accuracy, caught all 20 blocked examples, and correctly rejected 17 of 20 clear ones. We show the confusion matrix, confidence interval, and scope: this is a UK trash-screen proxy, not Bengaluru field accuracy. DrainGuard is honest decision support—detect, prioritize, act, and verify before waste moves downstream.
