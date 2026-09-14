import { test } from "@playwright/test";

import { runHomeFirstProof } from "./fixtures/funnel";

test("@auth-off first visit proves Search on the demo pack", async ({ page }) => {
  await runHomeFirstProof(page);
});
