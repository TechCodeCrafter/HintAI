import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { SceneCutAsk, SceneCutEnd, SceneCutIntro, SceneCutMike, SceneCutRant, SceneCutTabs } from "./cutaway-shots";
import { Fade, SceneChenEmpty, SceneSave } from "./shots";
import { FPS, T } from "./theme";
import voManifest from "./vo-manifest.json";

/**
 * Cutaway cut — sitcom wrapper, real cockpit in the middle. Voice and clicks only.
 */

export type DemoProps = { narration: string | null };

type VoClip = { file: string; at: number; seconds: number };
const VO_CLIPS = voManifest.clips as VoClip[];

const SCENES = [
  { kind: "intro" as const, duration: 156 },
  { kind: "ask" as const, duration: 228 },
  { kind: "tabs" as const, duration: 102 },
  { kind: "save" as const, duration: 216 },
  { kind: "mike" as const, duration: 60 },
  { kind: "empty" as const, duration: 102 },
  { kind: "rant" as const, duration: 294 },
  { kind: "end" as const, duration: 162 },
];

export const DEMO_DURATION = SCENES.reduce((total, scene) => total + scene.duration, 0);

const SCENE_VIEW = {
  intro: SceneCutIntro,
  ask: SceneCutAsk,
  tabs: SceneCutTabs,
  save: SceneSave,
  mike: SceneCutMike,
  empty: SceneChenEmpty,
  rant: SceneCutRant,
  end: SceneCutEnd,
};

const CLICKS = [12.9, 18.5, 27.3];

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
