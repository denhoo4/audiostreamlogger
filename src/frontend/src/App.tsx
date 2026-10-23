import { useCallback, useEffect, useRef, useState } from "react";
import {
  audioJsonUrl,
  audioMp3Url,
  exportSelection,
  getPublicConfig,
  getSettings,
  type Stream,
} from "./api";
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

/** Hours "00".."23" for the 24-hour selector. */
const HOURS: string[] = Array.from({ length: 24 }, (_, i) =>
  String(i).padStart(2, "0"),
);

export default function App() {
  const ws = useWavesurfer();
  const [streams, setStreams] = useState<Stream[]>([]);
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
      .then((data) => {
        if (cancelled) return;
        setStreams(data);
        if (data.length > 0) setSelectedFolder(data[0].folder);
      })
      .catch((err) => {
        console.error("Kon streams niet laden:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Set the page title at runtime from the public branding config, falling
  // back to the bundled default on error.
  useEffect(() => {
    let cancelled = false;
    getPublicConfig()
      .then(({ title }) => {
        if (!cancelled && title) document.title = title;
      })
      .catch(() => {
        if (!cancelled) document.title = "Dé radiologger";
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
    const mp3Url = audioMp3Url(selectedFolder, year, month, day, h);
    const jsonUrl = audioJsonUrl(selectedFolder, year, month, day, h);

    setDownloadHref(mp3Url);
    setDownloadName(`${selectedFolder}-${year}-${month}-${day}-${h}.mp3`);

    ws.reset();

    try {
      const res = await fetch(jsonUrl);
      if (!res.ok) throw new Error(`peaks ${res.status}`);
      const json = (await res.json()) as { data: number[][] };
      ws.load(mp3Url, json.data);
    } catch {
      ws.load(mp3Url);
    }
  }, [date, hour, selectedFolder, ws]);

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
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "Leuk fragmentje.mp3";
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Download selectie mislukt:", err);
    } finally {
      setDownloadWaiting(false);
    }
  }, [selectedFolder, ws]);

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
          {HOURS.map((h) => (
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
