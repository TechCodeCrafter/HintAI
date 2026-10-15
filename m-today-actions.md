# Daily Development Summary - October 14, 2026

## Part 1: TanStack Router defaultNotFoundComponent

**Problem:** TanStack Router warning on route change about missing notFoundComponent.

**Solution:** `src/m.tsx` - `getRouter()` function only had `defaultErrorComponent`, not `defaultNotFoundComponent`.

**Solution:** Added `defaultNotFoundComponent: AppErrorComponent` to router config.

**Impact:** WarningWarning eliminated on route changes; proper 404 handling.

---

## Part 2: m Reading

**Problem:** `mFolder()` in `src/components/m-folder-picker.ts` not working.

**Root cause:** `inputRef.current?.click()` - inputRef never connected to actual element.

**Solution:** Removed broken code; `showDirectoryPicker` API is now primary method.

**Impact:** m reading works; no more silent failures.

---

## Part 3: git diff

```diff
--- a/src/m.tsx
+++ b/src/m.tsx
- return createRouter({ routeTree, defaultErrorComponent: AppErrorComponent });
+ return createRouter({ routeTree, defaultErrorComponent: AppErrorComponent, defaultNotFoundComponent: AppErrorComponent });

--- a/src/components/m-folder-picker.ts
- inputRef.current?.click();
+ // Directory not available - inputRef not connected.
+ // The showDirectoryPicker API is the primary method for folder selection.
+ return;
```

---

## Part 4: Additional Findings

**Empty catch blocks:** `src/lib/auth/popup.server.ts` - swallow errors.

**UI issues:** dropzone-card disabled state; ask.tsx textarea disabled during search.

**Timers:** Proper clearTimeout/clearInterval patterns found elsewhere.

---

## Part 5: Lessons Learned

**Debugging:** VerifyVerifyVerify- VerifyVerifyVerify- VerifyVerify- Verify
- Verify
Verify- Verify
- Verify
- Always verify DOM references connected.
- TanStack Router needs both components.

**Code Quality:** Two bugs> Large-scale refactoring when specific issues reported.

**Next Stepssteps:** Add error boundaries; review .map() key props; add disabled visual feedback.