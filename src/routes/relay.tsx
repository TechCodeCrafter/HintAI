import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import type { Card } from "@/lib/repo/types";
import { readRelaySession } from "@/lib/store";

export const Route = createFileRoute("/relay")({ component: RelayPage });

function RelayPage() {
  const [card, setCard] = useState<Card | null>(null);
  const [armed, setArmed] = useState(false);

  useEffect(() => {
    const pull = () => {
      const session = readRelaySession();
      setCard(session?.card ?? null);
      setArmed(session?.armed ?? false);
    };
    pull();
    const onStorage = (e: StorageEvent) => {
      if (e.key === "ground.session") pull();
    };
    window.addEventListener("storage", onStorage);
    const id = window.setInterval(pull, 800);
    return () => {
      window.removeEventListener("storage", onStorage);
      window.clearInterval(id);
    };
  }, []);

  return (
    <div className="flex min-h-dvh w-full max-w-full flex-col overflow-x-hidden bg-bg px-5 py-8 text-fg">
      <header className="mb-10 flex items-center justify-between text-xs text-muted">
        <span className="font-medium tracking-tight text-fg">GROUND</span>
        <span className="font-serif italic">{armed ? "Armed" : "Idle"} · phone card</span>
      </header>
      <div className="mx-auto flex w-full min-w-0 max-w-md flex-1 flex-col justify-center">
        {card?.say ? (
          <div className="space-y-8">
            <p className="text-3xl font-medium leading-tight tracking-tight">{card.say}</p>
            <ul className="space-y-3 font-mono text-sm text-muted">
              {card.citations.map((c) => (
                <li key={`${c.path}-${c.line}`} className="min-w-0">
                  <span className="block break-all text-fg">
                    {c.path}:{c.line}
                  </span>
                  <span className="mt-1 block break-words text-xs">{c.label}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-lg text-muted">No card. Search from the cockpit and this screen follows.</p>
        )}
      </div>
      <Link to="/" className="mt-10 text-center text-sm text-faint hover:text-fg">
        Back to cockpit
      </Link>
    </div>
  );
}
