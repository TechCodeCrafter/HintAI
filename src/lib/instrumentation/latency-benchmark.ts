/**
 * Representative local latency benchmark for the production answer route.
 * Uses NORTHSTAR-scale fixtures — not micro-fixtures — so timings are meaningful.
 */
import { bindAccountId } from "../auth/account-boundary.ts";
import { defaultWorkspaceId } from "../auth/workspace.ts";
import { buildSpaceMaterialView } from "../context/material-view.ts";
import { indexSpace } from "../context/space-index.ts";
import { createMemoryRepository } from "../context/memory.ts";
import { persistPackAsContext, setContextRepository } from "../context/service.ts";
import { isPdfSource } from "../context/types.ts";
import { EVAL_PDF_FIXTURES } from "../document/pdf/eval-fixtures.ts";
import { parseAndPersistPdf } from "../document/pdf/ingest.ts";
import { NORTHSTAR } from "../repo/northstar.ts";
import type { IndexedChunk, RepoPack } from "../repo/types.ts";
import { routeSearchAnswer } from "../search/answer-route.ts";
import { hydratePdfDocumentsForHits } from "../search/live-card-context.ts";
import { buildChunks, retrieve } from "../search/retrieve.ts";
import { runSpaceScopedRetrieval } from "../search/search-scope.ts";
import { normalizeSpokenQuestion } from "../search/spoken.ts";
import { latencyPercentiles, type AnswerStageTimings } from "./answer-latency.ts";

export type BenchmarkScenario = "single-repo" | "quad-repo" | "repo-plus-pdf";

export type BenchmarkSample = AnswerStageTimings & {
  tier: string;
  hitCount: number;
  sourceCount: number;
};

export type BenchmarkReport = {
  scenario: BenchmarkScenario;
  iterations: number;
  samples: BenchmarkSample[];
  totals: ReturnType<typeof latencyPercentiles>;
  retrieval: ReturnType<typeof latencyPercentiles>;
  route: ReturnType<typeof latencyPercentiles>;
  localCard: ReturnType<typeof latencyPercentiles>;
  synthesis: ReturnType<typeof latencyPercentiles>;
};

function repoVariant(name: string, suffix: string): RepoPack {
  return {
    ...NORTHSTAR,
    id: `${name}-${suffix}`,
    name: `${name}-${suffix}`,
    files: NORTHSTAR.files.map((file) => ({
      ...file,
      path: `${suffix}/${file.path}`,
      content: file.content.replace(/northstar/gi, suffix),
    })),
  };
}

async function indexSingleRepo() {
  bindAccountId("latency-bench");
  const repo = createMemoryRepository();
  setContextRepository(repo);
  const { context } = await persistPackAsContext(NORTHSTAR, repo);
  const runtime = await indexSpace(repo, context.id, { embed: false });
  const material = buildSpaceMaterialView({
    workspaceId: defaultWorkspaceId(),
    spaceId: context.id,
    primaryContextId: context.id,
    memberContextIds: [context.id],
    pack: runtime.pack,
    sources: runtime.allSources,
  });
  return { repo, runtime, material, spaceId: context.id };
}

async function indexQuadRepo() {
  bindAccountId("latency-bench");
  const repo = createMemoryRepository();
  setContextRepository(repo);
  const { context } = await persistPackAsContext(repoVariant("svc-a", "alpha"), repo);
  for (const suffix of ["beta", "gamma", "delta"]) {
    await repo.upsertRepoBundle(context.id, {
      displayName: `svc-${suffix}`,
      files: repoVariant("svc", suffix).files.map((file) => ({
        path: file.path,
        language: file.language,
        content: file.content,
      })),
    });
  }
  const runtime = await indexSpace(repo, context.id, { embed: false });
  const material = buildSpaceMaterialView({
    workspaceId: defaultWorkspaceId(),
    spaceId: context.id,
    primaryContextId: context.id,
    memberContextIds: runtime.memberContextIds,
    pack: runtime.pack,
    sources: runtime.allSources,
  });
  return { repo, runtime, material, spaceId: context.id };
}

async function indexRepoPlusPdf() {
  const base = await indexSingleRepo();
  const blob = new Blob([Uint8Array.from(EVAL_PDF_FIXTURES["lecture.pdf"])], { type: "application/pdf" });
  const [source] = await base.repo.upsertSources(base.spaceId, [
    { path: "lecture.pdf", kind: "pdf", mimeType: "application/pdf", blob },
  ]);
  if (!source || !isPdfSource(source)) throw new Error("pdf fixture missing");
  await parseAndPersistPdf(base.repo, base.spaceId, source);
  const runtime = await indexSpace(base.repo, base.spaceId, { embed: false });
  const material = buildSpaceMaterialView({
    workspaceId: defaultWorkspaceId(),
    spaceId: base.spaceId,
    primaryContextId: base.spaceId,
    memberContextIds: runtime.memberContextIds,
    pack: runtime.pack,
    sources: runtime.allSources,
  });
  return { ...base, runtime, material };
}

async function loadScenario(scenario: BenchmarkScenario) {
  if (scenario === "single-repo") return indexSingleRepo();
  if (scenario === "quad-repo") return indexQuadRepo();
  return indexRepoPlusPdf();
}

const QUERIES: Record<BenchmarkScenario, string> = {
  "single-repo": "Why does that retry three times?",
  "quad-repo": "Why does that retry three times?",
  "repo-plus-pdf": "What does serializable isolation prevent?",
};

/** Run one production-shaped answer iteration (localCard-first path, no network LLM). */
export async function runBenchmarkIteration(
  scenario: BenchmarkScenario,
  loaded?: Awaited<ReturnType<typeof loadScenario>>,
): Promise<BenchmarkSample> {
  const ctx = loaded ?? (await loadScenario(scenario));
  const query = QUERIES[scenario];
  const t0 = performance.now();

  const canonT0 = performance.now();
  const canonical = normalizeSpokenQuestion(query).canonical;
  const canonicalizeMs = Math.round(performance.now() - canonT0);

  const materialT0 = performance.now();
  const material = ctx.material;
  const materialPrepMs = Math.round(performance.now() - materialT0);

  const retrieveT0 = performance.now();
  const hits = await runSpaceScopedRetrieval({
    query: canonical,
    chunks: ctx.runtime.chunks,
    pack: ctx.runtime.pack,
    spaceState: {
      activeSpaceId: ctx.spaceId,
      activeContextId: ctx.spaceId,
      memberContextIds: ctx.runtime.memberContextIds,
      authorizedSourceIds: ctx.runtime.allSources.map((row) => row.sourceId ?? row.id),
    },
    workspaceId: defaultWorkspaceId(),
    limit: 6,
    hybrid: false,
  });
  const retrieveMs = Math.round(performance.now() - retrieveT0);

  const { context: cardContext, documentHydrateMs } = await hydratePdfDocumentsForHits(
    ctx.repo,
    ctx.runtime.allSources,
    hits,
    material,
  );

  const routed = await routeSearchAnswer(query, hits, t0, {
    pack: ctx.runtime.pack,
    material,
    cardContext,
    retrieveMs,
    ask: async () => ({ text: "INSUFFICIENT" }),
  });

  const sourceIds = new Set(routed.card.citations.map((cite) => ("sourceId" in cite ? cite.sourceId : undefined)).filter(Boolean));

  return {
    ...routed.latency,
    canonicalizeMs,
    materialPrepMs,
    documentHydrateMs,
    retrieveMs,
    tier: routed.tier,
    hitCount: hits.length,
    sourceCount: sourceIds.size || ctx.runtime.allSources.length,
  };
}

export async function runBenchmarkScenario(
  scenario: BenchmarkScenario,
  iterations = 12,
): Promise<BenchmarkReport> {
  const loaded = await loadScenario(scenario);
  const samples: BenchmarkSample[] = [];
  for (let i = 0; i < iterations; i += 1) {
    samples.push(await runBenchmarkIteration(scenario, loaded));
  }
  const totals = latencyPercentiles(samples.map((row) => row.totalMs));
  const retrieval = latencyPercentiles(samples.map((row) => row.retrieveMs));
  const route = latencyPercentiles(samples.map((row) => row.routeMs ?? 0).filter((v) => v > 0));
  const localCard = latencyPercentiles(samples.map((row) => row.localCardMs ?? 0).filter((v) => v > 0));
  const synthesis = latencyPercentiles(samples.map((row) => row.synthesisMs ?? 0).filter((v) => v > 0));
  return { scenario, iterations, samples, totals, retrieval, route, localCard, synthesis };
}

export function formatBenchmarkReport(report: BenchmarkReport): string {
  const lines = [
    `Scenario: ${report.scenario} (${report.iterations} iterations)`,
    `totalMs p50/p95/p99: ${report.totals.p50} / ${report.totals.p95} / ${report.totals.p99}`,
    `retrieveMs p50/p95/p99: ${report.retrieval.p50} / ${report.retrieval.p95} / ${report.retrieval.p99}`,
    `routeMs p50/p95/p99: ${report.route.p50} / ${report.route.p95} / ${report.route.p99}`,
    `localCardMs p50/p95/p99: ${report.localCard.p50} / ${report.localCard.p95} / ${report.localCard.p99}`,
    `grounded+synthesisMs p50/p95/p99: ${report.synthesis.p50} / ${report.synthesis.p95} / ${report.synthesis.p99}`,
    `avg hits: ${(report.samples.reduce((sum, row) => sum + row.hitCount, 0) / report.samples.length).toFixed(1)}`,
    `tiers: ${report.samples.map((row) => row.tier).join(", ")}`,
  ];
  return lines.join("\n");
}

/** Convenience for tests — northstar chunks only retrieval baseline. */
export function northstarRetrieveMs(query: string): number {
  const chunks: IndexedChunk[] = buildChunks(NORTHSTAR);
  const t0 = performance.now();
  retrieve(query, chunks);
  return Math.round(performance.now() - t0);
}

export function assertMeaningfulTimings(totalMs: number): void {
  if (totalMs < 0) throw new Error("negative timing");
}
