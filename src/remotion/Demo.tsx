import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { FPS, T } from "./theme";
import voManifest from "./vo-manifest.json";
import {
  Fade,
  SceneAsk,
  SceneEmpty,
  SceneEnd,
  SceneHook,
  SceneIntro,
  SceneLive,
  SceneLoad,
} from "./shots";

/**
 * Cite or Silence — problem, then the sell. Voice and UI clicks only.
 */

export type DemoProps = { narration: string | null };

type VoClip = { file: string; at: number; seconds: number };
const VO_CLIPS = voManifest.clips as VoClip[];

const SCENES = [
  { kind: "hook" as const, duration: 375 },
  { kind: "intro" as const, duration: 160 },
  { kind: "load" as const, duration: 240 },
  { kind: "ask" as const, duration: 450 },
  { kind: "empty" as const, duration: 240 },
  { kind: "live" as const, duration: 180 },
  { kind: "end" as const, duration: 195 },
];

export const DEMO_DURATION = SCENES.reduce((total, scene) => total + scene.duration, 0);

const SCENE_VIEW = {
  hook: SceneHook,
  intro: SceneIntro,
  load: SceneLoad,
  ask: SceneAsk,
  empty: SceneEmpty,
  live: SceneLive,
  end: SceneEnd,
};

const CLICKS = [18.6, 31.2, 49.4, 50.2, 51.0];

export function Demo({ narration }: DemoProps) {
  let at = 0;
  return (
    <AbsoluteFill style={{ backgroundColor: T.bg }}>
      {SCENES.map((scene, i) => {
        const from = at;
        at += scene.duration;
        const View = SCENE_VIEW[scene.kind];
        return (
          <Sequence key={i} from={from} durationInFrames={scene.duration}>
            <Fade duration={scene.duration}>
              <View />
            </Fade>
          </Sequence>
        );
      })}

      {CLICKS.map((second) => (
        <Sequence key={second} from={Math.round(second * FPS)}>
          <Audio src={staticFile("click.wav")} volume={0.45} />
        </Sequence>
      ))}
      {narration ? <Audio src={staticFile(narration)} /> : null}
      {!narration
        ? VO_CLIPS.map((clip) => (
            <Sequence key={clip.file} from={Math.round(clip.at * FPS)}>
              <Audio src={staticFile(clip.file)} />
            </Sequence>
          ))
        : null}
    </AbsoluteFill>
  );
}
