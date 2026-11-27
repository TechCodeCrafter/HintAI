import { ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SCORE_PARTS, stageLabel, type SearchDetails, type SearchDetailsHit } from "@/lib/search/search-debug";
import { useMeetHint } from "@/lib/store";
import { cn } from "@/lib/cn";

/**
 * The switch for the Search details panel. It sits in the Answer head, so it
 * is one click away in the overlay and in the full cockpit alike.
 *
 * Off is the default. While it is off the search path builds no record and
 * the panel is not mounted, so the only thing on screen is this button.
 */
export function SearchDetailsToggle() {
  const on = useMeetHint((s) => s.searchDetailsOn);
  const setOn = useMeetHint((s) => s.setSearchDetailsOn);
  const label = on ? "Hide search details" : "Show search details";
  return (
    <Button
      type="button"
      variant="quiet"
      size="sm"
      data-testid="search-details-toggle"
      aria-pressed={on}
      aria-label={label}
      title={label}
      className={cn(on && "bg-accent-soft text-fg")}
      onClick={() => setOn(!on)}
    >
      <ScanSearch className="size-3.5" aria-hidden="true" />
    </Button>
  );
}

/**
 * Why the last question got the card it got: how much was searched, which
 * stage answered or what kind of silence it was, and the three chunks that
 * ranked highest, each with its score split into lexical, semantic, structural
 * and symbol and one line of its text.
 *
 * Mount it only while the switch is on. It reads the record straight from the
 * store so the Answer pane does not re-render when a record lands.
 */
export function SearchDetailsPanel() {
  const details = useMeetHint((s) => s.searchDetails);
  return (
    <section className="search-details" aria-label="Search details" data-testid="search-details">
      <p className="receipt-kicker">Search details</p>
      {details ? (
        <Details details={details} />
      ) : (
        <p className="search-details-empty" data-testid="search-details-empty">
          Nothing searched yet. Details appear with the next question.
        </p>
      )}
    </section>
  );
}

function Details({ details }: { details: SearchDetails }) {
  const stage = stageLabel(details.stage);
  const named = [...details.namedSymbols, ...details.namedPaths];
  return (
    <>
      <p className="search-details-query" data-testid="search-details-query">
        “{details.query}”
      </p>
      <dl className="search-details-facts">
        <div>
          <dt>Index</dt>
          <dd className="tabular-nums" data-testid="search-details-index">
            {count(details.filesIndexed, "file")}, {count(details.chunksIndexed, "chunk")}
          </dd>
        </div>
        <div>
          <dt>Answered by</dt>
          <dd data-testid="search-details-stage" data-stage={stage}>
            <span className="search-details-stage" data-silent={stage === "silence" ? "true" : undefined}>
              {stage}
            </span>
            {stage === "silence" ? (
              <span className="search-details-kind" data-testid="search-details-silence">
                {details.silence ?? "kind not recorded"}
              </span>
            ) : null}
            {details.totalMs != null ? (
              <span className="search-details-ms tabular-nums">{Math.round(details.totalMs)} ms</span>
            ) : null}
          </dd>
        </div>
        {named.length > 0 ? (
          <div>
            <dt>Names</dt>
            <dd className="break-all font-mono" data-testid="search-details-named">
              {named.join(", ")}
            </dd>
          </div>
        ) : null}
      </dl>
      {details.topHits.length > 0 ? (
        <ol className="search-details-hits" data-testid="search-details-hits">
          {details.topHits.map((hit) => (
            <li key={`${hit.rank}:${hit.path}:${hit.line ?? hit.page ?? 0}`} data-testid="search-details-hit">
              <div className="search-details-hit-head">
                <span className="search-details-rank tabular-nums">{hit.rank}</span>
                <span className="search-details-path" title={where(hit)}>
                  <bdi>{where(hit)}</bdi>
                </span>
                {hit.kind === "why" ? <span className="search-details-tag">commit</span> : null}
                <span className="search-details-score tabular-nums" title="Retrieval score">
                  {hit.score.toFixed(2)}
                </span>
              </div>
              <ScoreBreakdown hit={hit} />
              {hit.snippet ? <p className="search-details-snippet">{hit.snippet}</p> : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="search-details-empty" data-testid="search-details-no-hits">
          {details.chunksIndexed === 0 ? "Nothing is indexed, so nothing was ranked." : "No chunk scored for this question."}
        </p>
      )}
    </>
  );
}

const PART_MEANS: Record<(typeof SCORE_PARTS)[number], string> = {
  lexical: "The question's words in the chunk's text, heading and path",
  semantic: "Closeness of meaning, from the vectors. 0 when the search ran on words only",
  structural: "File names and headings the question names",
  symbol: "The chunk declares, or is the file of, a symbol the question names",
};

/**
 * The hit's score as the four amounts that add up to it. Each is already
 * weighted, so the row reads as a sum. See `ScoreParts`.
 */
function ScoreBreakdown({ hit }: { hit: SearchDetailsHit }) {
  if (!hit.parts) return null;
  return (
    <dl
      className="search-details-parts"
      data-testid="search-details-breakdown"
      aria-label={`Score ${hit.score.toFixed(2)}, by part`}
    >
      {SCORE_PARTS.map((part) => {
        const value = hit.parts[part];
        return (
          <div
            key={part}
            data-testid="search-details-part"
            data-part={part}
            data-zero={value === 0 ? "true" : undefined}
            title={PART_MEANS[part]}
          >
            <dt>{part}</dt>
            <dd className="tabular-nums">{value.toFixed(2)}</dd>
          </div>
        );
      })}
    </dl>
  );
}

function where(hit: SearchDetailsHit): string {
  if (hit.line != null) return `${hit.path}:${hit.line}`;
  if (hit.page != null) return `${hit.path} p.${hit.page}`;
  return hit.path;
}

function count(value: number, noun: string): string {
  return `${value.toLocaleString("en-US")} ${noun}${value === 1 ? "" : "s"}`;
}
