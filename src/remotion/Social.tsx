import { AbsoluteFill, Audio, Sequence, staticFile } from "remotion";
import { FPS, T } from "./theme";
import socialManifest from "./vo-social-manifest.json";
import { Caption, Fade, SceneAsk, SceneEmpty, SceneEnd, SceneHook } from "./shots";

/**
 * 15-second social cut. Problem first, then the cite, then the empty card.
 */

type VoClip = { file: string; at: number; seconds: number; text?: string };
const VO_CLIPS = socialManifest.clips as VoClip[];

const SCENES = [
  {
    kind: "hook" as const,
    duration: 150,
    caption: "You ever get asked something on a call and start digging through tabs while everyone waits?",
  },
  { kind: "ask" as const, duration: 150, caption: "MeetHint pulls the exact line, file and range. Nothing uploaded." },
  { kind: "empty" as const, duration: 90, caption: "If it's not in your files, it stays quiet." },
  { kind: "end" as const, duration: 60, caption: "MeetHint. Cite or silence. meethint.ai" },
];

export const SOCIAL_DURATION = SCENES.reduce((total, scene) => total + scene.duration, 0);

const SCENE_VIEW = {
  hook: SceneHook,
  ask: SceneAsk,
  empty: SceneEmpty,
  end: SceneEnd,
};

const CLICKS = [7.4];

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
