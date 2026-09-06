import { useState } from "react";
import { HistoryRow } from "@/components/answer-history";
import { evidenceCitation } from "@/lib/audit/report";
import type { Claim, ClaimStatus, MeetingRecord } from "@/lib/audit/types";
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
  const pastMeetings = useMeetHint((s) => s.meetingHistory);
  const selectedId = useMeetHint((s) => s.selectedClaimId);
  const select = useMeetHint((s) => s.selectAuditClaim);
  const report = useMeetHint((s) => s.claimReport);
  const exportReport = useMeetHint((s) => s.exportClaimReport);
  const close = useMeetHint((s) => s.closeClaimAudit);
  const restoreAnswer = useMeetHint((s) => s.restoreAnswer);
  const reviewMeeting = useMeetHint((s) => s.reviewMeeting);

  if (!meeting) return null;

  const selected = meeting.claims.find((claim) => claim.id === selectedId) ?? null;
  const ended = meeting.endedAt != null;
  const answers = meeting.answerHistory ?? [];
  const past = pastMeetings.filter((row) => row.id !== meeting.id);

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

        {answers.length > 0 ? (
          <section className="claim-answers" data-testid="meeting-answer-history">
            <p className="ground-hint px-4 pt-3">Answers this meeting</p>
            <div className="history-list claim-answers-list">
              {answers.map((item) => (
                <HistoryRow key={item.id} item={item} onRestore={() => restoreAnswer(item.id)} />
              ))}
            </div>
          </section>
        ) : null}

        {past.length > 0 ? (
          <section className="claim-past" data-testid="past-meetings">
            <p className="ground-hint px-4 pt-3">Past meetings</p>
            <ul className="claim-monitor-list">
              {past.map((row) => (
                <PastMeetingRow key={row.id} meeting={row} onOpen={() => void reviewMeeting(row.id)} />
              ))}
            </ul>
          </section>
        ) : null}
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

function PastMeetingRow({ meeting, onOpen }: { meeting: MeetingRecord; onOpen: () => void }) {
  const [open, setOpen] = useState(false);
  const restoreAnswer = useMeetHint((s) => s.restoreAnswer);
  const answers = meeting.answerHistory ?? [];
  const ended = meeting.endedAt ? new Date(meeting.endedAt).toLocaleDateString() : "Open";
  return (
    <li>
      <button
        type="button"
        className="claim-row"
        data-testid="past-meeting"
        aria-expanded={open}
        onClick={() => {
          setOpen((value) => !value);
          onOpen();
        }}
      >
        <span className="min-w-0">
          <span className="claim-row-meta">
            {ended}
            <span className="text-faint">
              {" "}
              · {answers.length} {answers.length === 1 ? "answer" : "answers"}
            </span>
          </span>
          <span className="claim-row-text">{meeting.name}</span>
        </span>
      </button>
      {open && answers.length > 0 ? (
        <div className="history-list claim-answers-list" data-testid="past-meeting-answers">
          {answers.map((item) => (
            <HistoryRow key={item.id} item={item} onRestore={() => restoreAnswer(item.id)} />
          ))}
        </div>
      ) : null}
    </li>
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
