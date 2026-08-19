# Evaluation protocol

## What is currently measured

DrainGuard has a deterministic regression suite for decision policy and product wiring. The suite runs after a production Next.js build and checks that the deployed source contains the expected explainability, map, weather, persistence, verification, and human-review paths.

The decision cases call the same pure functions used by the interface.

## Twelve decision cases

| # | Case | Inputs | Expected result |
| ---: | --- | --- | --- |
| 1 | Blocked control A | drain 81%, risk 88 | Dispatch now |
| 2 | Blocked control B | drain 74%, risk 72 | Inspect today |
| 3 | Blocked control C | drain 66%, risk 54 | Monitor |
| 4 | Clear control A | drain 79%, risk 34 | Monitor |
| 5 | Clear control B | drain 71%, risk 25 | Monitor |
| 6 | Clear control C | drain 63%, risk 18 | Monitor |
| 7 | Same-drain cleanup A | match true, drain 82%, blocked 31%, litter 28%, reduction 41 | Verified |
| 8 | Same-drain cleanup B | match true, drain 75%, blocked 44%, litter 39%, reduction 18 | Verified |
| 9 | Unchanged after | match true, drain 82%, blocked 76%, litter 62%, reduction 0 | Review |
| 10 | Different scene A | match false, drain 81%, blocked 22%, litter 20%, reduction 60 | Review |
| 11 | Different scene B | match false, drain 76%, blocked 35%, litter 31%, reduction 36 | Review |
| 12 | Non-drain input | drain 55%, risk 84 | Review |

Run the suite with:

```bash
npm test
```

## Environmental scoring checks

The separate scoring suite executes the same centralized TypeScript functions used by the interface. It checks:

- priority and environmental weights sum to 100%;
- exact factor contributions remain explainable;
- mapped waterway proximity contributes only when data is available;
- unavailable context remains `null`, reduces evidence coverage, and is never fabricated as low risk;
- the published 250 m and 750 m proximity thresholds behave at their boundaries;
- cleanup priority increases monotonically across controlled dry, moderate, and heavy rainfall inputs.

Run these checks with:

```bash
npm run test:scoring
```

## Manual browser checks

The current production release has also been manually checked for:

- same-image after evidence: 100% scene match and rejected for zero improvement;
- different-scene after evidence: low scene match and routed to review;
- non-drain control: confidence below the 60% threshold and routed to review;
- no console errors in the tested production flow.

## What these results do not establish

The fixtures are policy-regression cases. They do not establish model accuracy, environmental-risk calibration, generalization, pollution volume, or real-world flood reduction. They must not be reported as precision, recall, detection accuracy, or environmental impact avoided.

## Field-evaluation plan

A stronger study will use a held-out, independently labelled set containing:

- blocked and clear drains;
- multiple inlet and grate designs;
- day, night, rain and shadow conditions;
- urban litter, leaves, silt and vegetation;
- deliberately difficult non-drain negatives;
- matched and mismatched before/after pairs.

The report will include:

- drain-presence precision and recall;
- blocked/clear confusion matrix;
- false-negative rate for high-obstruction drains;
- same-drain verification false-accept and false-reject rates;
- confidence calibration;
- results by lighting, camera angle and drain type.
