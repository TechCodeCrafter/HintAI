import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { FPS, T } from "./theme";
import voManifest from "./vo-manifest.json";
import {
  Fade,
  SceneBroader,
  SceneChenAudit,
  SceneChenEmpty,
  SceneClose,
  SceneEnd,
  SceneFear,
  SceneMoment,
  SceneSave,
} from "./shots";

/**
 * The Question — Dr. Chen. Voice and UI clicks only.
 */

export type DemoProps = { narration: string | null };

type VoClip = { file: string; at: number; seconds: number };
const VO_CLIPS = voManifest.clips as VoClip[];

const SCENES = [
  { kind: "fear" as const, duration: 321 },
  { kind: "moment" as const, duration: 483 },
  { kind: "save" as const, duration: 516 },
  { kind: "empty" as const, duration: 489 },
  { kind: "audit" as const, duration: 402 },
  { kind: "broader" as const, duration: 435 },
  { kind: "close" as const, duration: 279 },
  { kind: "end" as const, duration: 330 },
];

export const DEMO_DURATION = SCENES.reduce((total, scene) => total + scene.duration, 0);

const SCENE_VIEW = {
  fear: SceneFear,
  moment: SceneMoment,
  save: SceneSave,
  empty: SceneChenEmpty,
  audit: SceneChenAudit,
  broader: SceneBroader,
  close: SceneClose,
  end: SceneEnd,
};

const CLICKS = [8.3, 22.8, 29.2, 46.0];

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
