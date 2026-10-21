import React from "react";
import { Composition, continueRender, delayRender } from "remotion";
import { Film } from "./Film";
import { fontsReady } from "./lib/theme";
import { FPS, TOTAL } from "./lib/time";

const wait = delayRender("fonts");
fontsReady.then(() => continueRender(wait));

export const Root: React.FC = () => (
  <>
    <Composition id="PairUp" component={Film} durationInFrames={TOTAL} fps={FPS} width={1920} height={1080} defaultProps={{ audio: true }} />
    <Composition id="PairUpPicture" component={Film} durationInFrames={TOTAL} fps={FPS} width={1920} height={1080} defaultProps={{ audio: false }} />
  </>
);
