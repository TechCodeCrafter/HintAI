import { Composition } from "remotion";
import { Demo, DEMO_DURATION } from "./Demo";
import { FPS } from "./theme";

export function RemotionRoot() {
  return (
    <Composition
      id="Demo"
      component={Demo}
      durationInFrames={DEMO_DURATION}
      fps={FPS}
      width={1920}
      height={1080}
      defaultProps={{ narration: null }}
    />
  );
}
