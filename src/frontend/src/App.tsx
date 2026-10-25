import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActionIcon,
  Box,
  Button,
  Group,
  LoadingOverlay,
  NativeSelect,
  Skeleton,
  Stack,
  Text,
  Transition,
} from "@mantine/core";
import { useReducedMotion } from "@mantine/hooks";
import { DatePickerInput } from "@mantine/dates";
import {
  IconDownload,
  IconPlayerPause,
  IconPlayerPlay,
  IconScissors,
  IconZoomScan,
} from "@tabler/icons-react";
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
import {
  displayNameForFolder,
  existingDaysFor,
  existingHoursFor,
} from "./player-hours";
import { sortStreamsByCountryOrder } from "./settings/country-order";
import { countryName } from "./settings/countries";
import { fragmentFilename } from "./player-filename";
import { Panel } from "./ui";
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
// the still-growing mp3 keeps filling the client-decoded waveform in the UI.
// Past hours never poll.
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
 * Build the stream selector's grouped `data` for the Mantine NativeSelect: one
 * optgroup per country, in the SAME country order the player already uses
 * (`sortStreamsByCountryOrder` — listed countries first, then the rest
 * alphabetically by name), with each country's streams kept in their existing
 * relative order. The optgroup label is the full country NAME (falling back to
 * the raw code when unknown); optgroup labels are inherently non-selectable and
 * browsers indent the options beneath them, giving the requested non-selectable
 * header + indented stations. Returns Mantine's grouped-options object format.
 */
export function streamSelectGroups(
  orderedStreams: Stream[],
): { group: string; items: { value: string; label: string }[] }[] {
  const groups: { group: string; items: { value: string; label: string }[] }[] =
    [];
  const byCountry = new Map<string, { value: string; label: string }[]>();
  for (const stream of orderedStreams) {
    let items = byCountry.get(stream.country);
    if (!items) {
      items = [];
      byCountry.set(stream.country, items);
      // `orderedStreams` is already country-grouped, so first appearance of a
      // country is its final position in the optgroup order.
      groups.push({ group: countryName(stream.country), items });
    }
    items.push({ value: stream.folder, label: stream.name });
  }
  return groups;
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
  // The calendar date as a "YYYY-MM-DD" string (Mantine 8 DatePickerInput uses
  // the string value format, which maps 1:1 onto the parts parser below). "" is
  // "no date chosen" and renders the picker's placeholder.
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

  // Display name (settings2 tree key) for the selected stream, or null. Shared
  // by the calendar's day-enablement and the hour selector's existing-hours
  // constraint.
  const selectedDisplayName = selectedFolder
    ? displayNameForFolder(streams, selectedFolder)
    : null;

  // The set of "YYYY-MM-DD" days that actually have a recording for the selected
  // stream, so the calendar can enable ONLY those days (every other day is
  // disabled). Empty for a stream with no recordings -> no selectable days.
  const existingDays =
    selectedDisplayName === null
      ? new Set<string>()
      : existingDaysFor(tree, selectedDisplayName);

  // Hours that actually have a recording for the selected stream + date, derived
  // from the public /api/settings2 tree. Empty until a valid stream + date are
  // chosen (or when that day has no recordings), so the selector then shows only
  // the "Hour" placeholder.
  const availableHours = (() => {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    if (!selectedFolder || !m || selectedDisplayName === null) return [];
    return existingHoursFor(tree, selectedDisplayName, m[1], m[2], m[3]);
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
          console.error("Failed to load default stream:", err);
        }
        if (!cancelled) {
          setCountryOrder(order);
          const ordered = sortStreamsByCountryOrder(data, order);
          setSelectedFolder(pickInitialFolder(ordered, defaultFolder));
        }
      })
      .catch((err) => {
        console.error("Failed to load streams:", err);
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
        console.error("Failed to load recordings:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Set the page title at runtime from the public branding config (shared with
  // the /settings admin route via useAppTitle).
  useAppTitle();

  // On a STREAM change, KEEP the current date + hour when they are both still
  // valid for the newly-selected stream, so switching A -> B where B also has
  // that selection leaves it visible. Otherwise fall back: clear the date (and
  // its hour) when the date is not available for the new stream; keep the date
  // but clear only the hour when the date exists but that hour does not. This
  // never leaves a highlighted-but-disabled day or an out-of-range hour behind.
  const prevFolderRef = useRef(selectedFolder);
  useEffect(() => {
    if (prevFolderRef.current === selectedFolder) return;
    prevFolderRef.current = selectedFolder;

    const newName = selectedFolder
      ? displayNameForFolder(streams, selectedFolder)
      : null;
    if (!newName) {
      setDate("");
      setHour("");
      return;
    }

    const parts = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
    const dateAvailable = parts !== null && existingDaysFor(tree, newName).has(date);
    if (!dateAvailable) {
      setDate("");
      setHour("");
      return;
    }

    // Date kept; keep the hour only when it exists for the new stream + date.
    const hoursForDate = existingHoursFor(
      tree,
      newName,
      parts[1],
      parts[2],
      parts[3],
    );
    if (!hoursForDate.includes(hour)) {
      setHour("");
    }
  }, [selectedFolder, streams, tree, date, hour]);

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

  // Core load body, shared by the initial load and the live-poll interval.
  // The CURRENT Amsterdam hour is decoded client-side: its mp3 is still growing
  // and has no stable precomputed peaks, so we always cache-bust the media URL
  // and let WaveSurfer derive the waveform from the audio (no .json fetch). Past
  // hours load the backend peaks JSON (honouring the optional cache-busting
  // `?t=`) and fall back to decoding the audio directly when the .json is
  // missing — preserving the graceful missing/partial-peak behaviour.
  const reload = useCallback(
    async (sel: LoadedSelection, cacheBust?: number) => {
      const { folder, year, month, day, hour: h, ext } = sel;
      const live = isLiveHour(currentAmsterdamSlot(), sel);

      if (live) {
        // Always cache-bust the live hour so pressing Load (or a poll tick)
        // refetches the grown mp3 instead of a stale cached copy.
        const mediaUrl = audioUrl(folder, year, month, day, h, ext, Date.now());
        setDownloadHref(mediaUrl);
        setDownloadName(`${folder}-${year}-${month}-${day}-${h}.${ext}`);
        ws.reset();
        ws.load(mediaUrl);
        return;
      }

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

  // Load (#load): validate the day/hour (NaN guard with an alert), record the
  // loaded selection (so the live-hour poll can key off it), then perform the
  // shared load.
  const handleLoad = useCallback(async () => {
    const parts = parseDateParts(date, hour);
    if (!selectedFolder || !parts) {
      alert("Please select a day and an hour first.");
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

  // Live-hour auto-refresh: only when the loaded selection IS the current
  // Amsterdam hour-slot, poll every LIVE_POLL_MS and reload so the grown mp3 is
  // re-decoded client-side into a fuller waveform. The interval is cleared
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
      // SAVED filename only (the export REQUEST above is unchanged):
      // <streamname>_<start>_<end>.<ext> with absolute wall-clock stamps built
      // from the loaded recording's hour base + the region offsets. The folder
      // is already a safe [a-z0-9_-] slug, so it is the <streamname> base.
      a.download = fragmentFilename(
        selectedFolder,
        { year: parts.year, month: parts.month, day: parts.day, hour: parts.hour },
        round1(region.start),
        round1(region.end),
        selectedCodec,
      );
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Selection download failed:", err);
    } finally {
      setDownloadWaiting(false);
    }
  }, [selectedFolder, selectedCodec, ws]);

  const orderedStreams = sortStreamsByCountryOrder(streams, countryOrder);

  // Gentle first-mount fade for the player surface; honour the OS
  // reduced-motion preference by skipping the JS-driven fade entirely (the
  // panel then renders immediately, fully opaque).
  const reduceMotion = useReducedMotion();

  return (
    <Transition
      mounted
      transition="fade"
      duration={reduceMotion ? 0 : 200}
      timingFunction="ease"
    >
      {(styles) => (
        <Panel style={styles}>
          <Stack gap="md">
        {/* Waveform + time readout. While a load is in flight a LoadingOverlay
            covers the waveform zone and the time readout shows a placeholder,
            so it is clear the player is working; both clear on 'ready'. On an
            error the overlay clears and an inline error message shows. */}
        <Stack gap="xs">
          <Box pos="relative">
            <LoadingOverlay
              visible={ws.isLoading}
              data-testid="waveform-loading"
              zIndex={1}
              overlayProps={{ blur: 1 }}
            />
            <div id="waveform" ref={ws.containerRef}></div>
          </Box>
          {ws.loadError && (
            <Text id="waveform-error" size="sm" c="red" ta="center">
              Failed to load the recording. Please try again.
            </Text>
          )}
          <Group justify="center" gap="xs">
            {ws.isLoading ? (
              <Skeleton
                data-testid="time-loading"
                height={16}
                width={90}
                radius="sm"
              />
            ) : (
              <Text id="time-total" size="sm" c="dimmed" ff="monospace">
                {formatTime(ws.currentTime)} / {formatTime(ws.duration)}
              </Text>
            )}
            <Text size="xs" c="dimmed">
              <IconZoomScan
                size={14}
                style={{ verticalAlign: "-2px", marginRight: 4 }}
              />
              Scroll over the waveform to zoom
            </Text>
          </Group>
        </Stack>

        {/* Transport zone: skip back, play/pause, skip forward. */}
        <Group justify="center" gap="xs" wrap="wrap">
          {SKIP_BUTTONS.slice(0, 3).map((b) => (
            <Button
              key={b.label}
              data-value={b.value}
              className="skip-button"
              variant="default"
              size="xs"
              onClick={() => ws.skip(b.value)}
            >
              {b.label}
            </Button>
          ))}
          <ActionIcon
            id="playPauseButton"
            aria-label={ws.isPlaying ? "Pause" : "Play"}
            variant="filled"
            size="lg"
            radius="xl"
            onClick={() => ws.playPause()}
          >
            {ws.isPlaying ? (
              <IconPlayerPause size={20} />
            ) : (
              <IconPlayerPlay size={20} />
            )}
          </ActionIcon>
          {SKIP_BUTTONS.slice(3).map((b) => (
            <Button
              key={b.label}
              data-value={b.value}
              className="skip-button"
              variant="default"
              size="xs"
              onClick={() => ws.skip(b.value)}
            >
              {b.label}
            </Button>
          ))}
        </Group>

        {/* Selection zone: stream + calendar + hour + load. On narrow widths
            the three selectors grow to full width and stack (wrap); on wider
            screens they sit side-by-side at their natural width. */}
        <Group align="flex-end" gap="sm" wrap="wrap" justify="center">
          <NativeSelect
            id="stringSelector"
            label="Stream"
            w={{ base: "100%", xs: "auto" }}
            value={selectedFolder}
            onChange={(e) => setSelectedFolder(e.currentTarget.value)}
            data={streamSelectGroups(orderedStreams)}
          />
          <DatePickerInput
            id="dateSelector"
            label="Date"
            placeholder="Pick a day"
            w={{ base: "100%", xs: "auto" }}
            firstDayOfWeek={1}
            value={date === "" ? null : date}
            onChange={(value) => setDate(value ?? "")}
            // Only days with a recording for the selected stream are selectable;
            // excludeDate returns true to DISABLE a day. A stream with no
            // recordings yields an empty set, so every day is disabled.
            excludeDate={(value) => !existingDays.has(value)}
          />
          <NativeSelect
            id="hourSelector"
            label="Hour"
            w={{ base: "100%", xs: "auto" }}
            value={hour}
            onChange={(e) => setHour(e.currentTarget.value)}
            data={[
              { value: "", label: "Hour" },
              ...availableHours.map((h) => ({ value: h, label: `${h}:00` })),
            ]}
          />
          <Button id="load" onClick={handleLoad}>
            Load
          </Button>
        </Group>

        {/* Source / actions zone: hour download + selection/fragment tools. */}
        <Group justify="center" gap="sm" wrap="wrap">
          <Button
            id="downloadbutton"
            component="a"
            variant="light"
            leftSection={<IconDownload size={16} />}
            href={downloadHref}
            download={downloadName}
          >
            Download hour
          </Button>
          <Button
            id="createStartButton"
            variant="default"
            size="xs"
            onClick={() => ws.selectionStart()}
          >
            Selection start
          </Button>
          <Button
            id="createEndButton"
            variant="default"
            size="xs"
            onClick={() => ws.selectionEnd()}
          >
            Selection end
          </Button>
          <Button
            id="deleteRegionButton"
            variant="default"
            size="xs"
            onClick={() => ws.deleteRegion()}
          >
            Clear selection
          </Button>
          <Button
            id="playRegionButton"
            variant="default"
            size="xs"
            disabled={!selectionEnabled}
            onClick={() => ws.playRegion()}
          >
            Play selection
          </Button>
          <Button
            id="downloadRegionButton"
            variant="light"
            size="xs"
            leftSection={<IconScissors size={16} />}
            disabled={!selectionEnabled}
            onClick={handleDownloadSelection}
          >
            Download fragment
          </Button>
        </Group>

        <Text
          id="downloadWait"
          c="red"
          fw={700}
          ta="center"
          style={{ display: downloadWaiting ? "block" : "none" }}
        >
          Preparing download, please wait…
        </Text>
          </Stack>
        </Panel>
      )}
    </Transition>
  );
}
