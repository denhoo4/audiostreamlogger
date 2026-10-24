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

// Recovered scroll-to-zoom mapping from the old minified bundle
// (frontend/web/main.js): the wheel handler read only the SIGN of deltaY and
// stepped minPxPerSec by a fixed 5 px/sec per event, clamped at a lower bound of
// 0 (fit-to-container), with NO upper clamp:
//   e.deltaY < 0 ? (zoom += 5) : (zoom = Math.max(0, zoom - 5))
export const ZOOM_STEP = 5;
export const ZOOM_MIN = 0;

/**
 * Pure zoom-step helper replicating the old app's wheel mapping. Given the
 * current minPxPerSec and a wheel `deltaY`, return the next minPxPerSec:
 * wheel up (`deltaY < 0`) zooms in (+step); otherwise zoom out (-step) clamped
 * at ZOOM_MIN. Only the sign of `deltaY` matters (magnitude is ignored), exactly
 * like the old bundle.
 */
export function nextZoom(current: number, deltaY: number): number {
  return deltaY < 0
    ? current + ZOOM_STEP
    : Math.max(ZOOM_MIN, current - ZOOM_STEP);
}

/** M:SS formatter matching the old app (rounded seconds). */
export function formatTime(seconds: number): string {
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

export interface UseWavesurfer {
  containerRef: RefObject<HTMLDivElement | null>;
  currentTime: number;
  duration: number;
  isPlaying: boolean;
  hasRegion: boolean;
  load: (audioUrl: string, peaks?: number[][]) => void;
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
    // Mouse-wheel scroll-to-zoom, replicating the old bundle's feel (sign-only
    // deltaY, fixed 5 px/sec step, lower clamp at 0) plus the user's explicit
    // ask to anchor the zoom at the point under the cursor. v7's zoom() throws
    // if no audio is loaded, so guard on getDuration() first.
    const onWheel = (e: WheelEvent) => {
      const duration = ws.getDuration();
      if (!duration) return; // nothing decoded: let the page scroll
      e.preventDefault();

      const scrollEl = ws.getWrapper().parentElement;
      if (!scrollEl) {
        ws.zoom(nextZoom(ws.options.minPxPerSec ?? 0, e.deltaY));
        return;
      }

      // Effective px/sec before zoom (minPxPerSec===0 means fit-to-container,
      // so derive it from the rendered width).
      const oldPx =
        ws.options.minPxPerSec || ws.getWrapper().scrollWidth / duration;
      const newPx = nextZoom(ws.options.minPxPerSec ?? 0, e.deltaY);

      const width = scrollEl.clientWidth;
      const x = e.clientX - scrollEl.getBoundingClientRect().left;
      const pointerTime = (ws.getScroll() + x) / oldPx;
      const newLeftSec = (width / newPx) * (x / width);

      if (newPx * duration < width) {
        // New zoom is narrower than the container: nothing to anchor.
        ws.zoom(width / duration);
        scrollEl.scrollLeft = 0;
      } else {
        ws.zoom(newPx);
        scrollEl.scrollLeft = (pointerTime - newLeftSec) * newPx;
      }
    };
    container.addEventListener("dblclick", onDblClick);
    container.addEventListener("contextmenu", onContextMenu);
    container.addEventListener("wheel", onWheel, { passive: false });

    return () => {
      container.removeEventListener("dblclick", onDblClick);
      container.removeEventListener("contextmenu", onContextMenu);
      container.removeEventListener("wheel", onWheel);
      ws.destroy();
      wsRef.current = null;
      regionsRef.current = null;
      regionRef.current = null;
    };
  }, []);

  const load = useCallback((audioUrl: string, peaks?: number[][]) => {
    const ws = wsRef.current;
    if (!ws) return;
    if (peaks) {
      ws.load(audioUrl, peaks);
    } else {
      ws.load(audioUrl);
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
