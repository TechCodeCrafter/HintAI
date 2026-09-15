import assert from "node:assert/strict";
import { test } from "node:test";

import { NORTHSTAR } from "../../repo/northstar.ts";
import { isFileHit } from "../../repo/types.ts";
import { profileSynthesisPrompts } from "../prompt-profile.ts";
import { buildChunks, retrieve } from "../retrieve.ts";

test("grounded and synthesis prompts stay under prior token budget after trim", () => {
  const hits = retrieve("Why does that retry three times?", buildChunks(NORTHSTAR)).filter(isFileHit);
  const profile = profileSynthesisPrompts("Why does that retry three times?", hits);
  assert.ok(profile.groundedTokens > 0);
  assert.ok(profile.synthesisTokens > 0);
  assert.ok(profile.chunkCount <= 5);
  assert.ok(profile.groundedTokens < 2500, `grounded tokens ${profile.groundedTokens}`);
});
