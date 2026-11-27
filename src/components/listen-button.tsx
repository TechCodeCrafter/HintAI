import { Mic } from "lucide-react";

import { Button } from "@/components/ui/button";
import { useListenGate } from "@/components/use-listen-gate";
import { cn } from "@/lib/cn";
import { useMeetHint } from "@/lib/store";

const LISTEN_TITLE = "Hear you and the computer. The answer is what you say.";

/**
 * Listen, and Stop while a session is live.
 *
 * Starting is off until the index chip reports Ready, so a click always
 * starts a session that is prepared: the files and chunks are known, the
 * word index is built, and the vectors are in memory or search is on the
 * word-search path. Stopping is never off. A re-index that begins while a
 * session is live leaves the button, and the session, as they are.
 */
export function ListenButton({ live, onStart, onStop }: { live: boolean; onStart: () => void; onStop: () => void }) {
  const gate = useListenGate();
  // Armed without being live is a session that hit an error or is playing
  // the demo: a click ends or restarts it, and a restart checks the gate itself.
  const armed = useMeetHint((s) => s.armed);
  const label = live ? "Stop listen" : "Listen";
  const blocked = !live && !armed && !gate.ready;
  const title = blocked ? (gate.reason ?? LISTEN_TITLE) : LISTEN_TITLE;
  return (
    // A disabled button takes no pointer events, so the reason it is off is
    // on the wrapper, where hovering still finds it.
    <span className="inline-flex" title={title}>
      <Button
        variant="primary"
        size="sm"
        aria-label={label}
        title={title}
        data-testid="listen-button"
        data-listen-ready={gate.ready ? "true" : "false"}
        disabled={blocked}
        onClick={() => (live ? onStop() : onStart())}
      >
        <Mic className={cn("size-4", live && "live-dot")} />
        <span className="hidden lg:inline">{label}</span>
      </Button>
    </span>
  );
}
