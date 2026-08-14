import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render() {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(
    new Request("http://localhost/", { headers: { accept: "text/html" } }),
    { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the DrainGuard product shell", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /DrainGuard AI/);
  assert.match(html, /Find the drain/);
  assert.match(html, /Photo in\. Priority out\./);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
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
