# Devpost submission copy

## Project title

DrainGuard AI

## Tagline

Stop street waste before the next storm moves it downstream.

## Short description

DrainGuard AI is an AI-assisted environmental monitoring prototype that helps identify blocked, litter-filled storm drains, prioritize cleanup using visible evidence, rainfall, and mapped waterway context, and verify the work with before-and-after evidence.

## Inspiration

Municipal crews cannot inspect every drain before rainfall. Cleanup is often reactive and driven by the latest complaint instead of consistent evidence. Street litter can collect around blocked drains, and rainfall may transport visible waste toward waterways. We wanted to build something narrower and more actionable than a flood predictor: a tool that answers, **“Which reported drain should we inspect first, and can we prove it was cleaned?”**

## What it does

DrainGuard follows a **Detect → Prioritize → Act → Verify** workflow:

1. A worker uploads a street photo.
2. The app checks whether it contains credible drain-like evidence.
3. Client-side analysis estimates visible obstruction and litter.
4. Rainfall is fetched using the report coordinates.
5. OpenStreetMap / Overpass is queried for nearby mapped water features.
6. Central scoring modules calculate cleanup priority and a separate environmental decision-support estimate.
7. A prominent explanation shows every factor, weight, contribution, confidence, limitation, and recommended action.
8. Reports appear on an accessible map and in a highest-priority-first queue.
9. A second photo must pass same-scene, drain-evidence, obstruction-improvement, and litter checks before the report closes.
10. Failed or uncertain evidence stays visible in a human-review queue.

The rainfall explorer uses controlled scenarios to show sensitivity. It does not present them as forecasts.

## How we built it

The application uses Next.js, React, TypeScript, Leaflet, OpenStreetMap, Open-Meteo, TensorFlow.js, and COCO-SSD, and is deployed on Vercel.

The client-side vision pipeline derives grate-like edge structure, natural-scene colour, debris tones, and texture. COCO-SSD is used only for visible litter classes; it is not presented as a storm-drain model.

Cleanup priority is:

```text
55% blockage + 30% rainfall index + 15% litter
```

The environmental decision-support estimate is:

```text
40% blockage + 30% rainfall index + 20% litter + 10% mapped waterway proximity
```

If waterway data is unavailable, DrainGuard keeps the factor null, lowers evidence coverage, normalizes across available evidence, and explains the limitation. It never invents proximity.

Before/after verification uses a normalized 12 × 8 scene fingerprint. A report can close only when the scene match, drain confidence, residual obstruction, residual litter, and improvement thresholds pass.

## Challenges

- General object detectors do not contain a storm-drain blockage class.
- Lighting and camera angles make before/after comparisons difficult.
- An unrelated clean-drain photo must never close another report.
- Environmental map services can be incomplete or temporarily unavailable.
- Demo statistics can easily be mistaken for real-world impact.

We addressed these by separating drain evidence from litter detection, adding a same-scene gate, exposing each verification check, treating unavailable context explicitly, routing uncertainty to people, and labelling all sample content as demo data.

## Accomplishments

- Working public application deployed on Vercel
- Automatic analysis for user-uploaded images
- Location-specific weather for mapped reports
- Mapped waterway proximity with graceful failure handling
- Centralized, configurable scoring weights
- Dynamic “Why this priority?” explanations
- Rainfall scenario explorer
- Environmental dashboard with empty and demo states
- Accessible environmental risk map using symbols, labels, and colour
- Persistent before/after evidence on the inspection device
- Same-drain mismatch protection and visible human review
- 12 executable decision-policy cases plus 6 environmental-scoring tests
- Clean strict TypeScript, lint, production build, dependency audit, and GitHub CI

## What we learned

The most useful AI system is not always the one making the biggest prediction. A focused tool that recommends a clear action, exposes its assumptions, and knows when to involve a human can be more practical for public infrastructure.

We also learned that missing data must remain visible. Treating an unavailable waterway lookup as “low risk” would create false confidence, so DrainGuard reports reduced evidence coverage instead.

## What's next

- Shared authenticated Postgres and object storage for municipal teams
- A field-labelled Bengaluru drain dataset
- A drain-specific model for grates, silt, vegetation, and litter
- Precision, recall, calibration, and subgroup reporting
- Validation of the environmental-risk policy with domain experts
- Ward dashboards, crew assignment, and an immutable audit trail

## Links

- Live application: <https://drainguard-ai-earth.vercel.app>
- Source code: <https://github.com/bhavyakeerthi3/drainguard-ai>
- Demo video: **add the final YouTube URL before submitting**

## Suggested tags

Environmental Technology, AI/ML, Climate Tech, Sustainability, Smart Cities, Computer Vision, Waterway Protection, Waste Reduction, Civic Tech, Next.js, React, TypeScript, TensorFlow.js, Leaflet, OpenStreetMap, Open-Meteo, Vercel
