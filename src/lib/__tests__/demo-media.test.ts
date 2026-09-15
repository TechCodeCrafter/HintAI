import assert from "node:assert/strict";
import { test } from "node:test";

import { demoMediaUrl } from "../demo-media.ts";

test("demo videos use first-party /demo path by default", () => {
  const url = demoMediaUrl("meethint-demo-cutaway.mp4");
  assert.equal(url, "/demo/meethint-demo-cutaway.mp4");
  assert.doesNotMatch(url, /^https:\/\//);
  assert.doesNotMatch(url, /jsdelivr/);
});
