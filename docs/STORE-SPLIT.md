# store.ts split map

`src/lib/store.ts` (~1,827 lines) is the Zustand root. Split here first — extractions are pure logic, testable in isolation, and define seams for `cockpit.tsx` panes later.

## Already extracted

| Module | Responsibility |
|--------|----------------|
| `src/lib/store/session-wire.ts` | Relay session persistence (`SESSION_KEY`, `SessionWire`, `readRelaySession`) |

## Planned slices (in order)

### 1. `store/material.ts` — pack & corpus loading

**State:** `pack`, `chunks`, `vocab`, `sources`, `loadingFolder`, `folderError`, `packNotice`, `ingestProgress`

**Actions:** `loadFolder`, `attachFolderToContext`, PDF ingest helpers, `noticesFromFolderLoad`, `packWarning`

**Tests:** folder load notices, weak-pack warning, office parse integration

### 2. `store/space.ts` — Knowledge Space lifecycle

**State:** `contexts`, `activeSpaceId`, `activeContextId`, `memberContextIds`, `authorizedSourceIds`, `contextStatus`, `contextError`, `hydrationEpoch`, `spaceCatalogEpoch`, `contextUpdating`

**Actions:** `boot`, `activateSpace`, `activateContext`, `createNamedContext`, `deleteSpace`, `refreshContexts`, `spaceMaterialPatch`

**Tests:** space activation patches, authorized source scoping

### 3. `store/search.ts` — answer routing & card assembly

**State:** `searching`, `refining`, `card`, `answerHistory`, `thread`, `typedQuery`, `heardQuestion`, `handledId`, `openFile`, `openDocument`

**Actions:** `search`, `refine`, `clearCard`, `openDocumentCitation`, `openPdfSource`, history helpers

**Deps:** `routeSearchAnswer`, `buildSearchRetrievalScope`, flight recorder hooks

**Tests:** search epoch cancellation, thread continuity, history append

### 4. `store/listen.ts` — transcript & live draft

**State:** `armed`, `listening`, `playing`, `liveDraft`, `draftRole`, `hearLevel`, `asrStatus`, `asrNote`, `listenError`, `listenBlocked`, `utterances`, `autoAnswer`, `overlay`, `sharingCall`

**Actions:** `arm`, `disarm`, `setLiveDraft`, `onHeard` / gate pipeline, ASR status setters

**Tests:** arm/disarm session wire, thread reset on disarm

### 5. `store/billing.ts` — quota & subscription UX

**State:** `subscription`, `selectedModelId`, `extractRemaining`, `upgradeFeature`

**Actions:** `setSubscription`, `setSelectedModelId`, `requestUpgrade`, `clearUpgrade`, extract quota consumption at search time

**Tests:** tier gates, extract exhaustion messaging

### 6. `store/audit.ts` — claim audit session

**State:** `auditOpen`, `currentMeeting`, `meetingHistory`, `selectedClaimId`, `claimReport`

**Actions:** `startClaimAudit`, `endClaimAudit`, claim report download, contradiction detection hooks

## cockpit.tsx alignment

After store slices land, split `src/components/cockpit.tsx` (~1,854 lines) one pane per slice:

| Pane | Store slice | Rough lines |
|------|-------------|-------------|
| Listen controls + transcript | `listen` | arm bar, ASR status, utterance list |
| Search / card / citations | `search` | card panel, history, open-file |
| Material / space chrome | `material` + `space` | context picker, ingest progress |
| Audit drawer | `audit` | meeting log, claim report |

Do not split cockpit until the corresponding store module exists and exports typed selectors.
