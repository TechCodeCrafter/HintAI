import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { FPS, T } from "./theme";
import voManifest from "./vo-manifest.json";
import {
  Fade,
  SceneAudit,
  SceneClose,
  SceneEmpty,
  SceneEnd,
  SceneEngineer,
  SceneHook,
  SceneLawyer,
  SceneLive,
  SceneLoad,
  ScenePromise,
  SceneStudent,
} from "./shots";

/**
 * Everyone cut — your script, cockpit picture, voice and UI clicks.
 */

export type DemoProps = { narration: string | null };

type VoClip = { file: string; at: number; seconds: number };
const VO_CLIPS = voManifest.clips as VoClip[];

const SCENES = [
  { kind: "hook" as const, duration: 156 },
  { kind: "load" as const, duration: 348 },
  { kind: "student" as const, duration: 300 },
  { kind: "lawyer" as const, duration: 345 },
  { kind: "engineer" as const, duration: 276 },
  { kind: "empty" as const, duration: 153 },
  { kind: "promise" as const, duration: 150 },
  { kind: "audit" as const, duration: 210 },
  { kind: "live" as const, duration: 153 },
  { kind: "close" as const, duration: 153 },
  { kind: "end" as const, duration: 186 },
];

export const DEMO_DURATION = SCENES.reduce((total, scene) => total + scene.duration, 0);

const SCENE_VIEW = {
  hook: SceneHook,
  load: SceneLoad,
  student: SceneStudent,
  lawyer: SceneLawyer,
  engineer: SceneEngineer,
  empty: SceneEmpty,
  promise: ScenePromise,
  audit: SceneAudit,
  live: SceneLive,
  close: SceneClose,
  end: SceneEnd,
};

const CLICKS = [5.8, 18.6, 28.6, 40.1, 49.2];

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
