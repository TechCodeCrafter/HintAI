import { evidenceCitation } from "@/lib/audit/report";
import type { Claim, ClaimStatus } from "@/lib/audit/types";
import { cn } from "@/lib/cn";
import { useMeetHint } from "@/lib/store";

const STATUS_MARK: Record<ClaimStatus, string> = {
  supported: "🟢",
  unverified: "🟡",
  contradicted: "🔴",
};

function statusLabel(status: ClaimStatus): string {
  if (status === "supported") return "Supported";
  if (status === "contradicted") return "Contradicted";
  return "Unverified";
}

export function ClaimMonitor() {
  const meeting = useMeetHint((s) => s.currentMeeting);
  const selectedId = useMeetHint((s) => s.selectedClaimId);
  const select = useMeetHint((s) => s.selectAuditClaim);
  const report = useMeetHint((s) => s.claimReport);
  const exportReport = useMeetHint((s) => s.exportClaimReport);
  const close = useMeetHint((s) => s.closeClaimAudit);

  if (!meeting) return null;

  const selected = meeting.claims.find((claim) => claim.id === selectedId) ?? null;
  const ended = meeting.endedAt != null;

  return (
    <aside className="claim-monitor ground-panel" data-testid="claim-monitor" aria-label="Claim Monitor">
      <div className="ground-head">
        <span className="ground-head-left">
          <span>Claim Monitor</span>
          <span className="ground-status tabular-nums">{meeting.claims.length}</span>
        </span>
        {ended ? <span className="ground-hint">Ended</span> : <span className="ground-hint">Live</span>}
      </div>

      <div className="claim-monitor-body">
        {meeting.claims.length === 0 ? (
          <p className="ground-hint px-4 py-5">Listening for claims. Search still writes the Card.</p>
        ) : (
          <ul className="claim-monitor-list">
            {meeting.claims.map((claim) => (
              <li key={claim.id}>
                <button
                  type="button"
                  data-testid="claim-row"
                  data-status={claim.status}
                  aria-pressed={selectedId === claim.id}
                  className={cn("claim-row", selectedId === claim.id && "claim-row-active")}
                  onClick={() => select(selectedId === claim.id ? null : claim.id)}
                >
                  <span aria-hidden="true">{STATUS_MARK[claim.status]}</span>
                  <span className="min-w-0">
                    <span className="claim-row-meta">
                      {claim.speaker}
                      <span className="text-faint"> · {statusLabel(claim.status)}</span>
                    </span>
                    <span className="claim-row-text">{claim.text}</span>
                    {claim.status === "supported" && claim.evidence?.[0] ? (
                      <span className="mt-1 block font-mono text-[11px] text-muted">
                        {evidenceCitation(claim.evidence[0])}
                      </span>
                    ) : null}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {selected ? <ClaimDetail claim={selected} /> : null}
      </div>

      {ended ? (
        <div className="claim-monitor-foot">
          {report ? (
            <button type="button" data-testid="claim-audit-export" className="claim-export" onClick={exportReport}>
              Download Claim Audit
            </button>
          ) : null}
          <button type="button" className="claim-export claim-export-quiet" onClick={close}>
            Close
          </button>
        </div>
      ) : null}
    </aside>
  );
}

function ClaimDetail({ claim }: { claim: Claim }) {
  const evidence = claim.evidence?.[0];
  return (
    <div className="claim-detail" data-testid="claim-detail">
      <p className="ground-hint">
        {claim.status === "supported" ? "Citation" : claim.status === "contradicted" ? "Contradicted" : "Unverified"}
      </p>
      {evidence ? (
        <p className="claim-evidence">
          <span className="font-mono text-fg">{evidenceCitation(evidence)}</span>
          <span className="mt-1 block text-muted">{evidence.kind === "document" ? evidence.spokenText : evidence.text}</span>
        </p>
      ) : (
        <p className="text-body">No cited line. Missing evidence is not a contradiction.</p>
      )}
    </div>
  );
}
