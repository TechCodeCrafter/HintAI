import assert from "node:assert/strict";
import { test } from "node:test";

import { demoMediaUrl } from "../demo-media.ts";

test("demo videos use a hosted URL when no local override is set", () => {
  const url = demoMediaUrl("meethint-demo-cutaway.mp4");
  assert.match(url, /meethint-demo-cutaway\.mp4$/);
  assert.doesNotMatch(url, /^\/demo\//);
  assert.match(url, /^https:\/\//);
});
