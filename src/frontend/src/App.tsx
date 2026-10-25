import { useCallback, useEffect, useRef, useState } from "react";
import {
  audioJsonUrl,
  audioUrl,
  currentAmsterdamSlot,
  exportSelection,
  getPublicConfig,
  getSettings,
  getSettings2,
  isLiveHour,
  type Codec,
  type Settings2,
  type Stream,
} from "./api";
import { displayNameForFolder, existingHoursFor } from "./player-hours";
import { sortStreamsByCountryOrder } from "./settings/country-order";
import { useAppTitle } from "./useAppTitle";
import { formatTime, useWavesurfer } from "./useWavesurfer";

// Skip buttons: label + data-value (seconds), 1:1 with the legacy UI.
const SKIP_BUTTONS: { label: string; value: number }[] = [
  { label: "-1m", value: -60 },
  { label: "-10s", value: -10 },
  { label: "-1s", value: -1 },
  { label: "+1s", value: 1 },
  { label: "+10s", value: 10 },
  { label: "+1m", value: 60 },
];

/** Round to one decimal (replaces lodash round(10*x)/10). */
function round1(x: number): number {
  return Math.round(x * 10) / 10;
}

// How often the player reloads the LIVE (current Amsterdam hour) recording so
// the mp3 + regenerated peaks keep growing in the UI. Past hours never poll.
const LIVE_POLL_MS = 30000;

/** The folder + date/hour parts of a loaded recording (for live detection). */
interface LoadedSelection {
  folder: string;
  year: string;
  month: string;
  day: string;
  hour: string;
  ext: Codec;
}

/**
 * Choose which stream folder the player should preselect: the configured
 * default_stream_folder when it matches a loaded stream, otherwise the first
 * stream's folder (the long-standing fallback), or "" when there are none.
 */
export function pickInitialFolder(
  streams: Stream[],
  defaultFolder: string,
): string {
  if (streams.length === 0) return "";
  if (defaultFolder && streams.some((s) => s.folder === defaultFolder)) {
    return defaultFolder;
  }
  return streams[0].folder;
}

/**
 * Build Y / M(2) / D(2) / H(2) parts from a date-input value ("YYYY-MM-DD")
 * and an hour string ("00".."23", 24-hour clock). Returns null if either is
 * missing or malformed.
 */
function parseDateParts(
  date: string,
  hour: string,
): {
  year: string;
  month: string;
  day: string;
  hour: string;
} | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  if (!/^\d{2}$/.test(hour)) return null;
  const h = Number(hour);
  if (h < 0 || h > 23) return null;
  return { year: m[1], month: m[2], day: m[3], hour };
}

export default function App() {
  const ws = useWavesurfer();
  const [streams, setStreams] = useState<Stream[]>([]);
  // Explicit admin-chosen country order (app_config `country_order`); drives the
  // stream selector's country grouping. Empty -> pure alphabetical-by-name.
  const [countryOrder, setCountryOrder] = useState<string[]>([]);
  const [tree, setTree] = useState<Settings2>({});
  const [selectedFolder, setSelectedFolder] = useState("");
  const [date, setDate] = useState("");
  const [hour, setHour] = useState("");
  const [downloadWaiting, setDownloadWaiting] = useState(false);

  // The folder + date/hour parts of the currently loaded recording, or null
  // before the first successful load. Drives live-hour detection + polling.
  const [loaded, setLoaded] = useState<LoadedSelection | null>(null);

  // #downloadbutton anchor attributes (set on load).
  const [downloadHref, setDownloadHref] = useState<string | undefined>(
    undefined,
  );
  const [downloadName, setDownloadName] = useState<string | undefined>(
    undefined,
  );

  const selectionEnabled = ws.hasRegion;

  // File extension for the selected stream's recordings == its codec
  // (mp3/opus/flac). Falls back to mp3 when no stream is selected or the codec
  // is somehow absent, matching the recorder's defensive default.
  const selectedCodec: Codec =
    streams.find((s) => s.folder === selectedFolder)?.codec ?? "mp3";

  // Hours that actually have a recording for the selected stream + date, derived
  // from the public /api/settings2 tree. Empty until a valid stream + date are
  // chosen (or when that day has no recordings), so the selector then shows only
  // the "Uur" placeholder.
  const availableHours = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!selectedFolder || !m) return [];
    const displayName = displayNameForFolder(streams, selectedFolder);
    if (displayName === null) return [];
    return existingHoursFor(tree, displayName, m[1], m[2], m[3]);
  })();
  // Keep the latest date/hour available to the download handler without
  // re-creating it on every keystroke.
  const dateHourRef = useRef({ date, hour });
  dateHourRef.current = { date, hour };

  // Populate the stream selector from GET /api/settings (value = folder,
  // text = the stored name verbatim; the old underscore-to-space display
  // workaround has been removed).
  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then(async (data) => {
        if (cancelled) return;
        setStreams(data);
        if (data.length === 0) return;
        // Preselect the configured default stream when it matches a loaded
        // stream, else fall back to the first (of the COUNTRY-ORDERED list).
        // The public config fetch is best-effort: on failure we keep the
        // empty country order (alphabetical fallback) and the first-stream
        // fallback against the then-unsorted list.
        let defaultFolder = "";
        let order: string[] = [];
        try {
          const config = await getPublicConfig();
          defaultFolder = config.default_stream_folder;
          order = config.country_order;
        } catch (err) {
          console.error("Kon standaardstream niet laden:", err);
        }
        if (!cancelled) {
          setCountryOrder(order);
          const ordered = sortStreamsByCountryOrder(data, order);
          setSelectedFolder(pickInitialFolder(ordered, defaultFolder));
        }
      })
      .catch((err) => {
        console.error("Kon streams niet laden:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Load the public browse tree so the hour selector can offer only the hours
  // that actually have a recording for the selected stream + day. Public
  // endpoint, so this works for anonymous users too.
  useEffect(() => {
    let cancelled = false;
    getSettings2()
      .then((data) => {
        if (!cancelled) setTree(data);
      })
      .catch((err) => {
        console.error("Kon opnames niet laden:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Set the page title at runtime from the public branding config (shared with
  // the /settings admin route via useAppTitle).
  useAppTitle();

  // Spacebar toggles play/pause (document keydown).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        // Don't hijack space while typing in a field.
        if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
        e.preventDefault();
        ws.playPause();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [ws]);

  // Core load body, shared by the initial load, the live-poll interval and the
  // manual "Ververs" button. Rebuilds the media + peaks URLs for `sel` (passing
  // an optional cache-busting `?t=` so a grown current-hour file/json is not
  // served stale), updates the download anchor, and tries the peaks JSON before
  // falling back to decoding the audio directly — preserving the graceful
  // missing/partial-peak behaviour (ws.load(mediaUrl) with no peaks).
  const reload = useCallback(
    async (sel: LoadedSelection, cacheBust?: number) => {
      const { folder, year, month, day, hour: h, ext } = sel;
      const mediaUrl = audioUrl(folder, year, month, day, h, ext, cacheBust);
      const jsonUrl = audioJsonUrl(folder, year, month, day, h, cacheBust);

      setDownloadHref(mediaUrl);
      setDownloadName(`${folder}-${year}-${month}-${day}-${h}.${ext}`);

      ws.reset();

      try {
        const res = await fetch(jsonUrl);
        if (!res.ok) throw new Error(`peaks ${res.status}`);
        const json = (await res.json()) as { data: number[][] };
        ws.load(mediaUrl, json.data);
      } catch {
        ws.load(mediaUrl);
      }
    },
    [ws],
  );

  // Load (#load): validate the day/hour (NaN guard with the Dutch alert), record
  // the loaded selection (so the live-hour poll can key off it), then perform
  // the shared load.
  const handleLoad = useCallback(async () => {
    const parts = parseDateParts(date, hour);
    if (!selectedFolder || !parts) {
      alert("Wel ff een dag en uur selecteren hè!");
      return;
    }
    const sel: LoadedSelection = {
      folder: selectedFolder,
      year: parts.year,
      month: parts.month,
      day: parts.day,
      hour: parts.hour,
      ext: selectedCodec,
    };
    setLoaded(sel);
    await reload(sel);
  }, [date, hour, selectedFolder, selectedCodec, reload]);

  // Keep the latest loaded selection available to the manual refresh button
  // without re-creating the handler on every state change.
  const loadedRef = useRef<LoadedSelection | null>(loaded);
  loadedRef.current = loaded;

  // Manual "Ververs" fallback: reload the currently loaded recording right away
  // with a fresh cache-busting param. No-op before anything is loaded.
  const handleRefresh = useCallback(() => {
    const sel = loadedRef.current;
    if (!sel) return;
    void reload(sel, Date.now());
  }, [reload]);

  // Live-hour auto-refresh: only when the loaded selection IS the current
  // Amsterdam hour-slot, poll every LIVE_POLL_MS and reload with a cache-busting
  // param so the grown mp3 + regenerated peaks show up. The interval is cleared
  // when the selection changes, when a past hour is loaded, when the slot rolls
  // past the loaded hour, and on unmount. Nothing is polled before a load.
  useEffect(() => {
    if (!loaded) return;
    if (!isLiveHour(currentAmsterdamSlot(), loaded)) return;
    const id = setInterval(() => {
      // Stop once the live slot has rolled past the loaded hour.
      if (!isLiveHour(currentAmsterdamSlot(), loaded)) {
        clearInterval(id);
        return;
      }
      void reload(loaded, Date.now());
    }, LIVE_POLL_MS);
    return () => clearInterval(id);
  }, [loaded, reload]);

  // Download Selection (#downloadRegionButton): show wait message, POST the
  // selection, trigger a browser download of the returned mp3, hide the message.
  const handleDownloadSelection = useCallback(async () => {
    const region = ws.getRegion();
    const { date: d, hour: h } = dateHourRef.current;
    const parts = parseDateParts(d, h);
    if (!region || !selectedFolder || !parts) return;

    setDownloadWaiting(true);
    try {
      const blob = await exportSelection({
        station_id: selectedFolder,
        year: parts.year,
        month: parts.month,
        day: parts.day,
        hour: parts.hour,
        startTime: round1(region.start),
        endTime: round1(region.end),
        ext: selectedCodec,
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `Leuk fragmentje.${selectedCodec}`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download selectie mislukt:", err);
    } finally {
      setDownloadWaiting(false);
    }
  }, [selectedFolder, selectedCodec, ws]);

  return (
    <>
      <div style={{ textAlign: "center" }}>
        <span id="time-total">
          {formatTime(ws.currentTime)} / {formatTime(ws.duration)}
        </span>
        <br />
      </div>
      <div id="waveform" ref={ws.containerRef}></div>

      <div style={{ textAlign: "center", marginTop: "10px" }}>
        {SKIP_BUTTONS.slice(0, 3).map((b) => (
          <button
            key={b.label}
            data-value={b.value}
            className="skip-button"
            onClick={() => ws.skip(b.value)}
          >
            {b.label}
          </button>
        ))}
        <button id="playPauseButton" onClick={() => ws.playPause()}>
          {ws.isPlaying ? "Pause" : "Play"}
        </button>
        {SKIP_BUTTONS.slice(3).map((b) => (
          <button
            key={b.label}
            data-value={b.value}
            className="skip-button"
            onClick={() => ws.skip(b.value)}
          >
            {b.label}
          </button>
        ))}
      </div>

      <div style={{ textAlign: "center", marginTop: "5px" }}>
        <a
          id="downloadbutton"
          className="button"
          href={downloadHref}
          download={downloadName}
        >
          Download uur
        </a>
        <button id="createStartButton" onClick={() => ws.selectionStart()}>
          Selection Start
        </button>
        <button id="createEndButton" onClick={() => ws.selectionEnd()}>
          Selection End
        </button>
        <button id="deleteRegionButton" onClick={() => ws.deleteRegion()}>
          Delete Selection
        </button>
        <button
          id="playRegionButton"
          disabled={!selectionEnabled}
          onClick={() => ws.playRegion()}
        >
          Play Selection
        </button>
        <button
          id="downloadRegionButton"
          disabled={!selectionEnabled}
          onClick={handleDownloadSelection}
        >
          Download Selection
        </button>
      </div>

      <br />
      <div style={{ textAlign: "center", marginTop: "5px" }}>
        <select
          id="stringSelector"
          value={selectedFolder}
          onChange={(e) => setSelectedFolder(e.target.value)}
        >
          {sortStreamsByCountryOrder(streams, countryOrder).map((s) => (
            <option key={s.folder} value={s.folder}>
              {s.name}
            </option>
          ))}
        </select>
        <input
          type="date"
          id="dateSelector"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <select
          id="hourSelector"
          value={hour}
          onChange={(e) => setHour(e.target.value)}
        >
          <option value="">Uur</option>
          {availableHours.map((h) => (
            <option key={h} value={h}>
              {h}:00
            </option>
          ))}
        </select>
        <button id="load" onClick={handleLoad}>
          Inladen!
        </button>
        <button
          id="refresh"
          disabled={loaded === null}
          onClick={handleRefresh}
        >
          Ververs
        </button>
      </div>
      <p
        style={{
          color: "red",
          fontSize: "30px",
          display: downloadWaiting ? "inline" : "none",
        }}
        id="downloadWait"
      >
        Download aan het voorbereiden, even geduld!
      </p>
    </>
  );
}
