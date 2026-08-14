import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

test("produces a deployable Next.js build", async () => {
  await access(new URL("../.next/BUILD_ID", import.meta.url));
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  assert.match(page, /DrainGuard/);
  assert.match(page, /Find the drain/);
  assert.match(page, /Photo in\. Priority out\./);
  assert.doesNotMatch(page, /codex-preview|Your site is taking shape/);
});

test("ships the explainable risk model and responsible-use language", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const layout = await readFile(new URL("../app/layout.tsx", import.meta.url), "utf8");
  assert.match(page, /blockage \* 0\.55/);
  assert.match(page, /rainfallIndex \* 0\.3/);
  assert.match(page, /litter \* 0\.15/);
  assert.match(page, /does not predict floods/i);
  assert.match(page, /COCO-SSD/);
  assert.match(layout, /See a drain\. Stop a flood\./);
});

test("connects location search to a real garbage-risk map", async () => {
  const page = await readFile(new URL("../app/page.tsx", import.meta.url), "utf8");
  const map = await readFile(new URL("../app/DrainMap.tsx", import.meta.url), "utf8");
  assert.match(page, /Where is the garbage\?/);
  assert.match(page, /nominatim\.openstreetmap\.org\/search/);
  assert.match(page, /geocoding-api\.open-meteo\.com/);
  assert.match(page, /<DrainMap sites=\{sites\}/);
  assert.match(map, /tile\.openstreetmap\.org/);
  assert.match(map, /map\.flyTo/);
});
