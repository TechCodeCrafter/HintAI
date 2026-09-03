import { Composition } from "remotion";
import { Demo, DEMO_DURATION } from "./Demo";
import { Social, SOCIAL_DURATION } from "./Social";
import { FPS } from "./theme";

export function RemotionRoot() {
  return (
    <>
      <Composition
        id="Demo"
        component={Demo}
        durationInFrames={DEMO_DURATION}
        fps={FPS}
        width={1920}
        height={1080}
        defaultProps={{ narration: null }}
      />
      <Composition
        id="Social"
        component={Social}
        durationInFrames={SOCIAL_DURATION}
        fps={FPS}
        width={1080}
        height={1920}
      />
      <Composition
        id="Square"
        component={Social}
        durationInFrames={SOCIAL_DURATION}
        fps={FPS}
        width={1080}
        height={1080}
      />
    </>
  );
}
