# Branch protection for main

This file is the setting to apply in GitHub. Applying it is a repository admin action. This commit does not flip the setting, and it does not include a screenshot of a setting that has not been turned on.

When `test.yml` has been green on `main` often enough to trust, an admin sets:

- Branch: `main`
- Require a pull request before merging
- Require status checks: `test` / `unit`, `test` / `e2e`, `test` / `supply-chain`
- Do not require `flaky` / `quarantined` or `design-detect` (those are non-blocking)
- Require branches to be up to date before merging
- Squash merge only, so history stays linear
- Dismiss stale approvals when new commits are pushed
- Do not allow bypass, including for admins, except a written incident note in the PR

`redteam-nightly.yml` stays scheduled. It is not a merge check.

A red pull request must not merge. Confirm that by opening a PR that fails `unit` and checking the merge button stays disabled. Save that screenshot next to this file only after the setting is actually on.
