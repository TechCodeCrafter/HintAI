import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { SceneCutAsk, SceneCutIntro } from "./cutaway-shots";
import { Caption, Fade, SceneChenEmpty, SceneEnd, SceneSave } from "./shots";
import { FPS, T } from "./theme";
import socialManifest from "./vo-social-manifest.json";

/**
 * 15-second social cut of the cutaway film.
 */

type VoClip = { file: string; at: number; seconds: number; text?: string };
const VO_CLIPS = socialManifest.clips as VoClip[];

const SCENES = [
  {
    kind: "intro" as const,
    duration: 80,
    caption: "Forty students. Then someone asks the thing that isn't in the lecture.",
  },
  { kind: "ask" as const, duration: 60, caption: "Forty students. Then someone asks the thing that isn't in the lecture." },
  { kind: "save" as const, duration: 140, caption: "MeetHint pulls the line from his files. Nothing uploaded." },
  { kind: "empty" as const, duration: 100, caption: "If it's not in the pack, the card stays empty." },
  { kind: "end" as const, duration: 70, caption: "Cite or silence." },
];

export const SOCIAL_DURATION = SCENES.reduce((total, scene) => total + scene.duration, 0);

const SCENE_VIEW = {
  intro: SceneCutIntro,
  ask: SceneCutAsk,
  save: SceneSave,
  empty: SceneChenEmpty,
  end: SceneEnd,
};

const CLICKS = [5.4];

export function Social() {
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
              <Caption text={scene.caption} />
            </Fade>
          </Sequence>
        );
      })}

      {CLICKS.map((second) => (
        <Sequence key={second} from={Math.round(second * FPS)}>
          <Audio src={staticFile("click.wav")} volume={0.45} />
        </Sequence>
      ))}
      {VO_CLIPS.map((clip) => (
        <Sequence key={clip.file} from={Math.round(clip.at * FPS)}>
          <Audio src={staticFile(clip.file)} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
}
