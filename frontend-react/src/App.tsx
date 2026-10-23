import { useCallback, useEffect, useRef, useState } from "react";
import {
  audioJsonUrl,
  audioMp3Url,
  exportSelection,
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

/** Extract Y / M(2) / D(2) / H(2) from the datetime input value. */
function parseDateParts(value: string): {
  year: string;
  month: string;
  day: string;
  hour: string;
} | null {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const year = String(d.getFullYear());
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  const hour = String(d.getHours()).padStart(2, "0");
  return { year, month, day, hour };
}

export default function App() {
  const ws = useWavesurfer();
  const [streams, setStreams] = useState<Stream[]>([]);
  const [selectedFolder, setSelectedFolder] = useState("");
  const [dateTime, setDateTime] = useState("");
  const [downloadWaiting, setDownloadWaiting] = useState(false);

  // #downloadbutton anchor attributes (set on load).
  const [downloadHref, setDownloadHref] = useState<string | undefined>(
    undefined,
  );
  const [downloadName, setDownloadName] = useState<string | undefined>(
    undefined,
  );

  const selectionEnabled = ws.hasRegion;
  const dateTimeRef = useRef(dateTime);
  dateTimeRef.current = dateTime;

  // Populate the stream selector from GET /api/settings (value = folder,
  // text = name with underscores replaced by spaces), matching the old app.
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
    const parts = parseDateParts(dateTime);
    if (!selectedFolder || !parts) {
      alert("Wel ff een uur selecteren hè!");
      return;
    }
    const { year, month, day, hour } = parts;
    const mp3Url = audioMp3Url(selectedFolder, year, month, day, hour);
    const jsonUrl = audioJsonUrl(selectedFolder, year, month, day, hour);

    setDownloadHref(mp3Url);
    setDownloadName(`${selectedFolder}-${year}-${month}-${day}-${hour}.mp3`);

    ws.reset();

    try {
      const res = await fetch(jsonUrl);
      if (!res.ok) throw new Error(`peaks ${res.status}`);
      const json = (await res.json()) as { data: number[][] };
      ws.load(mp3Url, json.data);
    } catch {
      ws.load(mp3Url);
    }
  }, [dateTime, selectedFolder, ws]);

  // Download Selection (#downloadRegionButton): show wait message, POST the
  // selection, trigger a browser download of the returned mp3, hide the message.
  const handleDownloadSelection = useCallback(async () => {
    const region = ws.getRegion();
    const parts = parseDateParts(dateTimeRef.current);
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
              {s.name.replace(/_/g, " ")}
            </option>
          ))}
        </select>
        <input
          type="datetime-local"
          id="dateTimeSelector"
          value={dateTime}
          onChange={(e) => setDateTime(e.target.value)}
        />
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
