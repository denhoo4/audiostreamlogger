import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import WaveSurfer from "wavesurfer.js";
import RegionsPlugin, {
  type Region,
} from "wavesurfer.js/dist/plugins/regions.esm.js";

// Recovered visual config from the old minified bundle (frontend/web/main.js):
//   WaveSurfer.create({ container: "#waveform", waveColor: "violet",
//     progressColor: "purple", normalize: true }).registerPlugin(RegionsPlugin.create())
// No barWidth/barGap/barHeight/cursorColor/height were set by the old app, so
// wavesurfer v7 defaults apply (continuous waveform, default height 128). Do NOT
// add bar styling: matching the old look means leaving these at default.
export const WAVE_COLOR = "violet";
export const PROGRESS_COLOR = "purple";
export const NORMALIZE = true;

/** M:SS formatter matching the old app (rounded seconds). */
export function formatTime(seconds: number): string {
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

export interface UseWavesurfer {
  containerRef: RefObject<HTMLDivElement>;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  hasRegion: boolean;
  load: (mp3Url: string, peaks?: number[][]) => void;
  playPause: () => void;
  skip: (seconds: number) => void;
  seekTo: (progress: number) => void;
  pause: () => void;
  /** Reset routine (old "st()"): clear region, seek 0, pause. */
  reset: () => void;
  /** Create/extend the selection region from the current playhead (Start button). */
  selectionStart: () => void;
  /** Create/extend the selection region from the current playhead (End button). */
  selectionEnd: () => void;
  /** Remove the selection region (Delete button). */
  deleteRegion: () => void;
  /** Play only the current selection region (Play Selection button). */
  playRegion: () => void;
  /** Current selection region bounds in seconds, or null if none. */
  getRegion: () => { start: number; end: number } | null;
}

/**
 * Creates and manages a single WaveSurfer v7 instance with the Regions plugin,
 * reproducing the behaviors recovered from the legacy bundle. A single region
 * exists at a time (the old "rt" variable).
 */
export function useWavesurfer(): UseWavesurfer {
  const containerRef = useRef<HTMLDivElement>(null);
  const wsRef = useRef<WaveSurfer | null>(null);
  const regionsRef = useRef<ReturnType<typeof RegionsPlugin.create> | null>(
    null,
  );
  const regionRef = useRef<Region | null>(null);

  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [hasRegion, setHasRegion] = useState(false);

  useEffect(() => {
    if (!containerRef.current) return;

    const regions = RegionsPlugin.create();
    const ws = WaveSurfer.create({
      container: containerRef.current,
      waveColor: WAVE_COLOR,
      progressColor: PROGRESS_COLOR,
      normalize: NORMALIZE,
    });
    ws.registerPlugin(regions);

    wsRef.current = ws;
    regionsRef.current = regions;

    const onTimeupdate = (t: number) => setCurrentTime(t);
    const onReady = (d: number) => {
      setDuration(d);
      setCurrentTime(ws.getCurrentTime());
    };
    const onPlay = () => setIsPlaying(true);
    const onPause = () => setIsPlaying(false);
    const onFinish = () => {
      ws.setTime(0);
      setCurrentTime(0);
      setIsPlaying(false);
    };

    ws.on("timeupdate", onTimeupdate);
    ws.on("audioprocess", onTimeupdate);
    ws.on("ready", onReady);
    ws.on("play", onPlay);
    ws.on("pause", onPause);
    ws.on("finish", onFinish);

    // Mouse interactions scoped to the waveform element only (not the page):
    //   double-click  -> play
    //   right-click    -> pause (and suppress the browser context menu)
    const container = containerRef.current;
    const onDblClick = () => ws.play();
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      ws.pause();
    };
    container.addEventListener("dblclick", onDblClick);
    container.addEventListener("contextmenu", onContextMenu);

    return () => {
      container.removeEventListener("dblclick", onDblClick);
      container.removeEventListener("contextmenu", onContextMenu);
      ws.destroy();
      wsRef.current = null;
      regionsRef.current = null;
      regionRef.current = null;
    };
  }, []);

  const load = useCallback((mp3Url: string, peaks?: number[][]) => {
    const ws = wsRef.current;
    if (!ws) return;
    if (peaks) {
      ws.load(mp3Url, peaks);
    } else {
      ws.load(mp3Url);
    }
  }, []);

  const playPause = useCallback(() => {
    wsRef.current?.playPause();
  }, []);

  const skip = useCallback((seconds: number) => {
    wsRef.current?.skip(seconds);
  }, []);

  const seekTo = useCallback((progress: number) => {
    wsRef.current?.seekTo(progress);
  }, []);

  const pause = useCallback(() => {
    wsRef.current?.pause();
  }, []);

  const clearRegions = useCallback(() => {
    regionsRef.current?.clearRegions();
    regionRef.current = null;
    setHasRegion(false);
  }, []);

  const reset = useCallback(() => {
    clearRegions();
    wsRef.current?.seekTo(0);
    wsRef.current?.pause();
    setCurrentTime(0);
  }, [clearRegions]);

  const createRegion = useCallback((start: number, end: number) => {
    const regions = regionsRef.current;
    if (!regions) return;
    const region = regions.addRegion({
      start,
      end,
      drag: true,
      resize: true,
    });
    regionRef.current = region;
    setHasRegion(true);
  }, []);

  // Selection Start (#createStartButton): t = currentTime.
  // If a region exists: if t < region.end set start = t, else set start = t, end = t+10.
  // If no region: create { start: t, end: t+10 }.
  const selectionStart = useCallback(() => {
    const ws = wsRef.current;
    if (!ws) return;
    const t = ws.getCurrentTime();
    const region = regionRef.current;
    if (region) {
      if (t < region.end) {
        region.setOptions({ start: t, end: region.end });
      } else {
        region.setOptions({ start: t, end: t + 10 });
      }
    } else {
      createRegion(t, t + 10);
    }
  }, [createRegion]);

  // Selection End (#createEndButton): t = currentTime.
  // If a region exists: if region.start < t set end = t, else set start = t-10, end = t.
  // If no region: create { start: t-10, end: t }.
  const selectionEnd = useCallback(() => {
    const ws = wsRef.current;
    if (!ws) return;
    const t = ws.getCurrentTime();
    const region = regionRef.current;
    if (region) {
      if (region.start < t) {
        region.setOptions({ start: region.start, end: t });
      } else {
        region.setOptions({ start: t - 10, end: t });
      }
    } else {
      createRegion(t - 10, t);
    }
  }, [createRegion]);

  const deleteRegion = useCallback(() => {
    clearRegions();
  }, [clearRegions]);

  const playRegion = useCallback(() => {
    regionRef.current?.play();
  }, []);

  const getRegion = useCallback(() => {
    const region = regionRef.current;
    if (!region) return null;
    return { start: region.start, end: region.end };
  }, []);

  return {
    containerRef,
    currentTime,
    duration,
    isPlaying,
    hasRegion,
    load,
    playPause,
    skip,
    seekTo,
    pause,
    reset,
    selectionStart,
    selectionEnd,
    deleteRegion,
    playRegion,
    getRegion,
  };
}
