import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { SKIP_LABEL, describeLimits, truncationNotice } from "../folder.ts";
import {
  DEFAULT_FOLDER_LIMITS,
  FOLDER_LIMIT_FLOOR,
  fileCapLabel,
  folderLimits,
  formatBytes,
  isLimitReason,
  setFolderLimitsForTests,
  totalCapLabel,
} from "../limits.ts";

const MB = 1024 * 1024;

afterEach(() => {
  setFolderLimitsForTests(null);
  delete process.env.VITE_FOLDER_MAX_FILES;
  delete process.env.VITE_FOLDER_MAX_MB;
});

test("the default limits are at least 2,000 files and 50 MB", () => {
  assert.ok(DEFAULT_FOLDER_LIMITS.maxFiles >= 2000);
  assert.ok(DEFAULT_FOLDER_LIMITS.maxTotalBytes >= 50 * MB);
  assert.deepEqual(folderLimits(), DEFAULT_FOLDER_LIMITS);
  assert.ok(DEFAULT_FOLDER_LIMITS.maxFiles >= FOLDER_LIMIT_FLOOR.maxFiles);
  assert.ok(DEFAULT_FOLDER_LIMITS.maxTotalBytes >= FOLDER_LIMIT_FLOOR.maxTotalBytes);
});

test("a deployment can raise the limits and cannot set them below the floor", () => {
  process.env.VITE_FOLDER_MAX_FILES = "12000";
  process.env.VITE_FOLDER_MAX_MB = "200";
  assert.deepEqual(folderLimits(), { maxFiles: 12000, maxTotalBytes: 200 * MB });

  process.env.VITE_FOLDER_MAX_FILES = "500";
  process.env.VITE_FOLDER_MAX_MB = "8";
  assert.deepEqual(folderLimits(), FOLDER_LIMIT_FLOOR);

  // A value that is not a number is ignored, not read as zero.
  process.env.VITE_FOLDER_MAX_FILES = "lots";
  process.env.VITE_FOLDER_MAX_MB = "";
  assert.deepEqual(folderLimits(), DEFAULT_FOLDER_LIMITS);
});

test("the reason a file is listed with names the limit in force", () => {
  assert.equal(fileCapLabel({ maxFiles: 5000, maxTotalBytes: 50 * MB }), "over the 5,000-file limit");
  assert.equal(totalCapLabel({ maxFiles: 5000, maxTotalBytes: 50 * MB }), "over the 50 MB total size limit");
  assert.equal(formatBytes(1.5 * MB), "1.5 MB");
  assert.equal(formatBytes(300 * 1024), "300 KB");

  setFolderLimitsForTests({ maxFiles: 2500 });
  assert.equal(SKIP_LABEL.cap, "over the 2,500-file limit");
  assert.equal(describeLimits(), "2,500 files or 50 MB");
  assert.match(truncationNotice(2500, 12), /^Loaded 2,500 files\. 12 more are over the limit for one selection \(2,500 files or 50 MB\)/);
  assert.match(truncationNotice(2500, 1), /1 more is over the limit/);
});

test("a limit reason is recognised at any setting, and in the wording stored before", () => {
  for (const reason of [
    "over the 5,000-file limit",
    "over the 2,000-file limit",
    "over the 12,000-file limit",
    "over the 50 MB total size limit",
    "over the 1.5 MB total size limit",
    "over the 300 KB total size limit",
    "over the 500-file cap",
    "over the total size limit",
  ]) {
    assert.equal(isLimitReason(reason), true, reason);
  }
  for (const reason of [SKIP_LABEL.size, SKIP_LABEL.vendor, SKIP_LABEL.binaries, SKIP_LABEL.failed, SKIP_LABEL.walk]) {
    assert.equal(isLimitReason(reason), false, reason);
  }
});
