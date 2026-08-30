# Phase 4A.7 release decision table

| Area | Metric | Result | Gate |
|---|---|---|---|
| Code wrong-intent | 0% | 0% (4A.4.1 rerun) | PASS |
| Code unsupported | 0% | 0% | PASS |
| PDF wrong-intent (dev fixtures) | 0% | 0% | PASS |
| PDF unsupported (dev fixtures) | 0% | 0% | PASS |
| PDF fabricated provenance (dev) | 0 | 0 | PASS |
| PDF page accuracy (dev) | 100% | 100% | PASS |
| PDF evidence-location (dev) | 100% | 100% | PASS |
| Viewer wrong-page (dev) | 0 | 0 | PASS |
| Viewer wrong-text (dev) | 0 | 0 | PASS |
| **Real-world wrong-intent** | **0%** | **54% (68/126)** | **FAIL** |
| **Real-world unsupported** | **0%** | **0% (0/82)** | PASS |
| **Real-world fabricated provenance** | **0** | **0** | PASS |
| **Real-world page accuracy** | **100%** | **100%** | PASS |
| **Real-world evidence-location** | **100%** | **100%** | PASS |
| Viewer wrong-page (release, Node) | 0 | 0 | PASS |
| Viewer wrong-text (release, Node) | 0 | 0 | PASS |
| Readable Hint rate | ≥95% | 100% automated; hyphenation fragments on spot-check | PASS* |
| PDF answerable hit rate | ~75% | **16% (14/89)** | **FAIL** |
| PDF false silence | report | 30% (27/89) | REPORT |
| PDF Top-1 | report | 75% | REPORT |
| PDF Top-3 | report | 84% | REPORT |
| PDF Top-6 | report | 88% | REPORT |
| Exact viewer highlight | report | 100% (Node synthetic layer) | REPORT |
| Parse/classification success | ready vs scanned/unreadable/refused | 12 ready / 1 scanned / 2 unreadable / 3 refused; 8 of 12 ready would refuse at 200-chunk ingest | **FAIL for usefulness** |
| Student flow | pass | 1 useful / 17 wrong / 2 silence | **FAIL** |
| Meeting flow | pass | 4 useful / 11 wrong / 7 silence | **FAIL** |
| Reload recovery | pass | 4A.6 coverage unchanged | PASS |
| Mixed Context | pass | chunk explosion / 200-chunk refuse | **FAIL** |
| Large Context | pass | 7616 uncapped chunks vs 800 cap | **FAIL** |
| Privacy | pass | 0 craftCard on document Cards | PASS |
| Mobile | pass | not re-run after safety stop | NOT RUN |
| Console | 0 unexplained | unchanged from 4A.6 | UNCHANGED |
| Build/tests | pass | test 195, lint 0 errors, typecheck, build | PASS |

\* Automated readable-Hint only. Do not treat as permission to ship.

**Decision: KEEP COMING SOON**
