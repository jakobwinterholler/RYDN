import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import type { ResupplyZone } from "../../api";
import type { VerifiedStopRecord } from "../../planning/stopVerification/types";
import { PlaybackController } from "../../routePreview/core/playback";
import type { RoutePreviewRuntime } from "../../routePreview/core/types";
import { RoutePreviewEngine } from "../../routePreview/engine/RoutePreviewEngine";
import { DEFAULT_VISUAL_STYLE } from "../../routePreview/engine/visualStyles";
import { racePreviewCacheBaseUrl } from "../../races/api";
import RoutePreviewCompanionHud from "./RoutePreviewCompanionHud";
import { RoutePreviewPlayerChrome } from "./RoutePreviewGeneratePanel";
import RoutePreviewPlayer from "./RoutePreviewPlayer";

interface RoutePreviewViewerProps {
  raceId: string;
  runtime: RoutePreviewRuntime;
  zones: ResupplyZone[];
  verifiedStops: Record<string, VerifiedStopRecord>;
  useTileCache?: boolean;
  autoPlay?: boolean;
  showPlayPrompt?: boolean;
  isStale?: boolean;
  onRegenerate?: () => void;
  regenerating?: boolean;
}

export interface RoutePreviewViewerHandle {
  play: () => void;
  pause: () => void;
}

const RoutePreviewViewer = forwardRef<RoutePreviewViewerHandle, RoutePreviewViewerProps>(
  function RoutePreviewViewer(
    {
      raceId,
      runtime,
      zones,
      verifiedStops,
      useTileCache = false,
      autoPlay = false,
      showPlayPrompt = true,
      isStale = false,
      onRegenerate,
      regenerating = false,
    },
    ref,
  ) {
    const shellRef = useRef<HTMLDivElement | null>(null);
    const hostRef = useRef<HTMLDivElement | null>(null);
    const engineRef = useRef<RoutePreviewEngine | null>(null);
    const playbackRef = useRef<PlaybackController | null>(null);
    const [bootMessage, setBootMessage] = useState("Loading preview…");
    const [ready, setReady] = useState(false);
    const [timeS, setTimeS] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const autoPlayedRef = useRef(false);

    useImperativeHandle(ref, () => ({
      play: () => playbackRef.current?.play(),
      pause: () => playbackRef.current?.pause(),
    }));

    useEffect(() => {
      const host = hostRef.current;
      if (!host) {
        return;
      }

      let cancelled = false;
      const engine = new RoutePreviewEngine({
        host,
        runtime,
        visualStyle: DEFAULT_VISUAL_STYLE,
        cacheBaseUrl: useTileCache ? racePreviewCacheBaseUrl(raceId) : undefined,
        onBootProgress: (message) => {
          setBootMessage(message);
        },
      });
      engineRef.current = engine;

      const playback = new PlaybackController({
        runtime,
        onTimeChange: (nextTimeS) => {
          setTimeS(nextTimeS);
          engine.render(nextTimeS);
        },
        onPlayingChange: setIsPlaying,
      });
      playbackRef.current = playback;

      void engine.boot().then(() => {
        if (cancelled) {
          return;
        }
        setReady(true);
        engine.render(0);
        if (autoPlay && !autoPlayedRef.current) {
          autoPlayedRef.current = true;
          playback.play();
        }
      });

      const resizeObserver = new ResizeObserver(() => {
        engine.resize(host.clientWidth, host.clientHeight);
        engine.render(playback.getState().timeS);
      });
      resizeObserver.observe(host);

      return () => {
        cancelled = true;
        resizeObserver.disconnect();
        playback.dispose();
        engine.dispose();
        engineRef.current = null;
        playbackRef.current = null;
      };
    }, [raceId, runtime, useTileCache, autoPlay]);

    useEffect(() => {
      if (!ready || !autoPlay || autoPlayedRef.current) {
        return;
      }
      autoPlayedRef.current = true;
      playbackRef.current?.play();
    }, [autoPlay, ready]);

    const toggleFullscreen = () => {
      const shell = shellRef.current;
      if (!shell) {
        return;
      }
      if (!document.fullscreenElement) {
        void shell.requestFullscreen();
      } else {
        void document.exitFullscreen();
      }
    };

    return (
      <div
        ref={shellRef}
        className="overflow-hidden rounded-2xl border border-line bg-[#050505] shadow-card"
      >
        <div className="relative aspect-video w-full">
          <div ref={hostRef} className="absolute inset-0" />
          {!ready ? (
            <div className="absolute inset-0 flex items-center justify-center bg-[#050505]/90 px-6 text-center">
              <p className="text-sm font-medium text-white/70">{bootMessage}</p>
            </div>
          ) : (
            <>
              {onRegenerate ? (
                <RoutePreviewPlayerChrome
                  isStale={isStale}
                  onRegenerate={onRegenerate}
                  regenerating={regenerating}
                />
              ) : null}
              <RoutePreviewCompanionHud
                runtime={runtime}
                timeS={timeS}
                zones={zones}
                verifiedStops={verifiedStops}
              />
              {showPlayPrompt && !isPlaying ? (
                <div className="absolute inset-0 flex items-center justify-center bg-black/20">
                  <button
                    type="button"
                    onClick={() => playbackRef.current?.play()}
                    className="pointer-events-auto flex h-16 w-16 items-center justify-center rounded-full bg-white text-2xl text-black shadow-xl transition hover:scale-105 hover:bg-white/95"
                    aria-label="Play Route Preview"
                  >
                    ▶
                  </button>
                </div>
              ) : null}
            </>
          )}
        </div>

        {ready && playbackRef.current ? (
          <RoutePreviewPlayer
            isPlaying={isPlaying}
            timeS={timeS}
            totalDurationS={runtime.totalDurationS}
            onPlay={() => playbackRef.current?.play()}
            onPause={() => playbackRef.current?.pause()}
            onSeek={(nextTimeS) => playbackRef.current?.seek(nextTimeS)}
            onFullscreen={toggleFullscreen}
          />
        ) : null}
      </div>
    );
  },
);

export default RoutePreviewViewer;
