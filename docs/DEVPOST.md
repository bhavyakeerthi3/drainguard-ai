# Devpost submission copy

## Project title

DrainGuard AI

## Tagline

Turn one street photo into an explainable drain-cleanup priority—then verify the cleanup with evidence.

## Short description

DrainGuard AI helps municipal teams decide which reported storm drain to inspect first. It combines on-device visual analysis, location-specific rainfall, a transparent priority formula, a mapped cleanup queue, and before/after verification with human review.

## Inspiration

Before monsoon rain, municipal crews face a simple but difficult problem: they cannot inspect every drain. Cleanup is often reactive, based on the latest complaint rather than consistent evidence. A visibly blocked inlet surrounded by litter may need urgent attention, but teams rarely have one ranked list that also accounts for local rainfall.

We wanted to build something narrower and more actionable than a flood prediction: a tool that helps answer, **“Which reported drain should we clean first?”**

## What it does

DrainGuard follows an Inspect → Prioritize → Act → Verify workflow:

1. A field worker uploads a street photo.
2. The app checks whether the image contains credible drain-like evidence.
3. It estimates visible obstruction and litter.
4. It fetches rainfall using that report's coordinates.
5. A transparent formula calculates the cleanup priority.
6. The report appears on a map and in a highest-risk-first queue.
7. After cleanup, the worker uploads another photo.
8. DrainGuard confirms that it appears to be the same drain and checks whether obstruction fell enough.
9. Failed, uncertain, unchanged, or mismatched evidence enters a visible human-review queue.

DrainGuard prioritizes inspections. It does not claim to predict floods or replace engineering assessment.

## How we built it

The application is built with Next.js, React, TypeScript, Leaflet, OpenStreetMap and Open-Meteo, and is deployed on Vercel.

The client-side vision pipeline extracts grate-like edge structure, natural-scene colour and debris-tone evidence to gate uncertain inputs. TensorFlow.js COCO-SSD is then used only for visible litter classes—not presented as a drain-specific model. Texture and image features estimate obstruction.

The public priority formula is:

```text
55% blockage + 30% rainfall index + 15% litter
```

Before/after verification uses a normalized 12 × 8 scene fingerprint. A report can close only when the scene match, drain confidence, residual obstruction, residual litter and improvement thresholds all pass. Those policy rules live in a small auditable module shared with the automated tests.

## AI usage

AI and computer vision are core to the workflow:

- on-device COCO-SSD identifies visible litter objects;
- image features estimate drain evidence and visible obstruction;
- a scene-fingerprint comparison protects before/after verification;
- confidence gates route uncertain cases to a person instead of silently accepting them.

The AI reduces the manual effort required to turn unstructured street photos into a consistent, ranked inspection queue. The product also exposes its formula and confidence limits so crews can understand why a report was prioritized.

## Challenges

- Generic object detectors do not contain a storm-drain blockage class.
- Different lighting and camera angles can make before/after comparisons unreliable.
- A convincing but unrelated clean-drain photo must never close another report.
- Hackathon prototypes can look accurate while hiding very small evaluations.

We addressed these by separating drain evidence from litter detection, adding a same-scene gate, keeping uncertain cases in human review, and publishing exactly what our 12-case regression suite does and does not prove.

## Accomplishments

- Working public application deployed on Vercel
- Automatic photo analysis for user-uploaded images
- Location-specific weather for every mapped report
- Explainable priority score and sorted cleanup queue
- Persistent before/after evidence on the inspection device
- Same-drain mismatch protection
- Visible human-review queue
- 12 executable decision-regression cases
- Clean production build, lint, and dependency audit

## What we learned

The most useful AI system is not always the one making the biggest prediction. A focused tool that prioritizes action, exposes its assumptions, and knows when to ask a human can be more practical for public infrastructure.

We also learned that verification deserves as much design attention as detection. Closing the evidence loop changes the product from a reporting demo into an accountable workflow.

## What's next

- shared authenticated Postgres and object storage for multi-user municipal teams;
- a field-labelled Bengaluru dataset;
- a trained drain-specific model for grates, silt, vegetation and litter;
- precision, recall, calibration and false-positive reporting;
- ward dashboards, crew assignment and an immutable audit trail.

## Links

- Live application: <https://drainguard-ai-earth.vercel.app>
- Source code: <https://github.com/bhavyakeerthi3/drainguard-ai>
- Demo video: **add the final YouTube URL here before submitting**

## Suggested categories and tags

AI/ML, Climate Tech, Sustainability, Smart Cities, Computer Vision, Waste Reduction, Flood Resilience, Civic Tech

## Final submission checklist

- [ ] Add the YouTube demo URL above.
- [ ] Confirm the GitHub repository is public.
- [ ] Open the live demo in an incognito window.
- [ ] Upload one blocked-drain photo during the video.
- [ ] Show a different-scene after photo entering human review.
- [ ] Show the map, live rainfall, ranked queue and 12-case evaluation.
- [ ] State clearly that DrainGuard prioritizes cleanup and does not predict floods.
