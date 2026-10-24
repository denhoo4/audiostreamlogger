import { useCallback, useEffect, useRef, useState } from "react";
import {
  audioJsonUrl,
  audioUrl,
  exportSelection,
  getPublicConfig,
  getSettings,
  getSettings2,
  type Codec,
  type Settings2,
  type Stream,
} from "./api";
import { displayNameForFolder, existingHoursFor } from "./player-hours";
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
  const [tree, setTree] = useState<Settings2>({});
  const [selectedFolder, setSelectedFolder] = useState("");
  const [date, setDate] = useState("");
  const [hour, setHour] = useState("");
  const [downloadWaiting, setDownloadWaiting] = useState(false);

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
        // stream, else fall back to the first. The public config fetch is
        // best-effort: on failure we keep the first-stream fallback.
        let defaultFolder = "";
        try {
          defaultFolder = (await getPublicConfig()).default_stream_folder;
        } catch (err) {
          console.error("Kon standaardstream niet laden:", err);
        }
        if (!cancelled) {
          setSelectedFolder(pickInitialFolder(data, defaultFolder));
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

  // Load (#load): build URLs, set download anchor, try peaks JSON then fall back
  // to decoding the mp3. NaN guard with the Dutch alert. Runs the reset routine.
  const handleLoad = useCallback(async () => {
    const parts = parseDateParts(date, hour);
    if (!selectedFolder || !parts) {
      alert("Wel ff een dag en uur selecteren hè!");
      return;
    }
    const { year, month, day, hour: h } = parts;
    const ext = selectedCodec;
    const mediaUrl = audioUrl(selectedFolder, year, month, day, h, ext);
    const jsonUrl = audioJsonUrl(selectedFolder, year, month, day, h);

    setDownloadHref(mediaUrl);
    setDownloadName(`${selectedFolder}-${year}-${month}-${day}-${h}.${ext}`);

    ws.reset();

    try {
      const res = await fetch(jsonUrl);
      if (!res.ok) throw new Error(`peaks ${res.status}`);
      const json = (await res.json()) as { data: number[][] };
      ws.load(mediaUrl, json.data);
    } catch {
      ws.load(mediaUrl);
    }
  }, [date, hour, selectedFolder, selectedCodec, ws]);

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
          {streams.map((s) => (
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
