import { useEffect, useState, type FormEvent } from "react";
import {
  ApiError,
  createStream,
  deleteStream,
  getPublicConfig,
  getStreams,
  reorderStreams,
  setDefaultStream,
  testStreamUrl,
  updateStream,
  type Codec,
  type StreamInput,
  type StreamRecord,
  type StreamTestResult,
} from "../api";
import { COUNTRIES_BY_NAME, countryName } from "./countries";

/**
 * Valid recording-quality combinations per codec, mirroring the api allowlist
 * (src/api/lib/validate-stream.js CODECS). A lossy codec carries a bitrate from
 * its set and no bit-depth; a lossless codec carries a bit-depth and no
 * bitrate. The form only ever offers combos from this table, so it can never
 * submit a combination the backend would reject (AC-10).
 */
const CODEC_OPTIONS: {
  codec: Codec;
  kind: "lossy" | "lossless";
  bitrates: number[];
  bitDepths: number[];
}[] = [
  {
    codec: "mp3",
    kind: "lossy",
    bitrates: [96, 128, 160, 192, 256, 320],
    bitDepths: [],
  },
  {
    codec: "opus",
    kind: "lossy",
    bitrates: [64, 96, 128, 160, 192],
    bitDepths: [],
  },
  { codec: "flac", kind: "lossless", bitrates: [], bitDepths: [16, 24] },
];

/** Look up a codec's option descriptor (defaults to mp3 for an unknown codec). */
function codecOption(codec: Codec) {
  return (
    CODEC_OPTIONS.find((c) => c.codec === codec) ?? CODEC_OPTIONS[0]
  );
}

/**
 * Bucket the (already sort_order-ordered) rows by country, preserving each
 * country's first-appearance order and the row order within it. Returns a flat
 * list of [countryCode, rows] groups so the table can render a section header
 * per country while the underlying global order stays intact.
 */
function groupByCountry(
  rows: StreamRecord[],
): { country: string; rows: StreamRecord[] }[] {
  const groups: { country: string; rows: StreamRecord[] }[] = [];
  const index = new Map<string, number>();
  for (const row of rows) {
    let at = index.get(row.country);
    if (at === undefined) {
      at = groups.length;
      index.set(row.country, at);
      groups.push({ country: row.country, rows: [] });
    }
    groups[at].rows.push(row);
  }
  return groups;
}

/** Empty add/edit form state (behaviour-preserving mp3@160 quality default). */
const EMPTY_FORM: StreamInput = {
  country: "",
  name: "",
  folder: "",
  url: "",
  codec: "mp3",
  bitrate_kbps: 160,
  bit_depth: null,
};

/**
 * Admin stream CRUD table. Lists getStreams(); an add/edit form renders country
 * as a <select> of ISO 3166-1 countries (option value = alpha-2 code, label =
 * full name) and name/folder/url as text inputs. The table read view maps the
 * stored code to its full name. create/update/delete call the api.ts functions
 * and surface the backend's 400/409 error messages.
 */
export default function StreamTable() {
  const [streams, setStreams] = useState<StreamRecord[]>([]);
  const [defaultFolder, setDefaultFolder] = useState("");
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // null id => the form is in "add" mode; a number => editing that row.
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<StreamInput>(EMPTY_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Advisory URL reachability "Test" state. Independent of the save path:
  // `testing` drives the pending label, `testResult` holds the probe outcome,
  // and `testError` holds an ApiError message (e.g. the backend's 400 on a
  // malformed url). None of these gate create/update.
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<StreamTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  function clearTest() {
    setTestResult(null);
    setTestError(null);
  }

  async function refresh() {
    setLoading(true);
    setListError(null);
    try {
      const [rows, config] = await Promise.all([
        getStreams(),
        getPublicConfig(),
      ]);
      setStreams(rows);
      setDefaultFolder(config.default_stream_folder);
    } catch (err) {
      setListError(
        err instanceof ApiError ? err.message : "Could not load streams",
      );
    } finally {
      setLoading(false);
    }
  }

  /**
   * Move a stream one position earlier (▲) or later (▼) in the GLOBAL flat
   * order (across country groups). Swaps the row with its neighbour in the
   * current id sequence and persists via reorderStreams, then refreshes.
   */
  async function handleReorder(id: number, direction: -1 | 1) {
    const ids = streams.map((s) => s.id);
    const from = ids.indexOf(id);
    const to = from + direction;
    if (from === -1 || to < 0 || to >= ids.length) return;
    [ids[from], ids[to]] = [ids[to], ids[from]];
    setListError(null);
    try {
      await reorderStreams(ids);
      await refresh();
    } catch (err) {
      setListError(
        err instanceof ApiError ? err.message : "Could not reorder streams",
      );
    }
  }

  /** Mark the clicked stream's folder as the player's default stream. */
  async function handleSetDefault(folder: string) {
    setListError(null);
    try {
      const { default_stream_folder } = await setDefaultStream(folder);
      setDefaultFolder(default_stream_folder);
    } catch (err) {
      setListError(
        err instanceof ApiError ? err.message : "Could not set default stream",
      );
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  function resetForm() {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    clearTest();
  }

  function startEdit(stream: StreamRecord) {
    setEditingId(stream.id);
    setForm({
      country: stream.country,
      name: stream.name,
      folder: stream.folder,
      url: stream.url,
      codec: stream.codec,
      bitrate_kbps: stream.bitrate_kbps,
      bit_depth: stream.bit_depth,
    });
    setFormError(null);
    clearTest();
  }

  /**
   * Switch the form's codec and reset the dependent quality fields to a valid
   * combo for the new codec: a lossy codec gets its first bitrate and a null
   * bit-depth; a lossless codec gets its first bit-depth and a null bitrate.
   * This keeps the form from ever holding (and submitting) an invalid
   * codec/bitrate/bit-depth combination (AC-10).
   */
  function handleCodecChange(codec: Codec) {
    const opt = codecOption(codec);
    setForm({
      ...form,
      codec,
      bitrate_kbps: opt.kind === "lossy" ? opt.bitrates[0] : null,
      bit_depth: opt.kind === "lossless" ? opt.bitDepths[0] : null,
    });
  }

  /**
   * Run the advisory reachability probe for the current url. NON-BLOCKING:
   * this never saves and never blocks the submit button; it only shows an
   * inline reachable / not-reachable result. Guards against an empty url.
   */
  async function handleTest() {
    if (form.url.trim() === "") return;
    setTesting(true);
    clearTest();
    try {
      setTestResult(await testStreamUrl(form.url));
    } catch (err) {
      setTestError(
        err instanceof ApiError ? err.message : "Could not test the URL",
      );
    } finally {
      setTesting(false);
    }
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      if (editingId === null) {
        await createStream(form);
      } else {
        await updateStream(editingId, form);
      }
      resetForm();
      await refresh();
    } catch (err) {
      setFormError(
        err instanceof ApiError ? err.message : "Could not save stream",
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete(id: number) {
    setListError(null);
    try {
      await deleteStream(id);
      if (editingId === id) resetForm();
      await refresh();
    } catch (err) {
      setListError(
        err instanceof ApiError ? err.message : "Could not delete stream",
      );
    }
  }

  return (
    <section className="settings-section">
      <h2>Streams</h2>

      {listError && (
        <p className="settings-error" role="alert">
          {listError}
        </p>
      )}

      {loading ? (
        <p>Loading…</p>
      ) : streams.length === 0 ? (
        <p>No streams yet.</p>
      ) : (
        <table className="settings-table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Folder</th>
              <th>URL</th>
              <th>Default stream</th>
              <th>Order</th>
              <th />
            </tr>
          </thead>
          {groupByCountry(streams).map((group) => (
            <tbody key={group.country}>
              <tr className="settings-group-header">
                <th colSpan={6} scope="colgroup">
                  {countryName(group.country)}
                </th>
              </tr>
              {group.rows.map((s) => {
                const flatIndex = streams.findIndex((x) => x.id === s.id);
                const isDefault = s.folder === defaultFolder;
                return (
                  <tr key={s.id}>
                    <td>{s.name}</td>
                    <td>{s.folder}</td>
                    <td>{s.url}</td>
                    <td>
                      {isDefault ? (
                        <span className="settings-default-badge">Default</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => handleSetDefault(s.folder)}
                        >
                          Set default
                        </button>
                      )}
                    </td>
                    <td>
                      <button
                        type="button"
                        aria-label={`Move ${s.name} up`}
                        disabled={flatIndex === 0}
                        onClick={() => handleReorder(s.id, -1)}
                      >
                        ▲
                      </button>
                      <button
                        type="button"
                        aria-label={`Move ${s.name} down`}
                        disabled={flatIndex === streams.length - 1}
                        onClick={() => handleReorder(s.id, 1)}
                      >
                        ▼
                      </button>
                    </td>
                    <td>
                      <button type="button" onClick={() => startEdit(s)}>
                        Edit
                      </button>
                      <button type="button" onClick={() => handleDelete(s.id)}>
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      )}

      <form onSubmit={handleSubmit} className="settings-form">
        <h3>{editingId === null ? "Add stream" : "Edit stream"}</h3>
        <label>
          Country
          <select
            value={form.country}
            onChange={(e) =>
              setForm({ ...form, country: e.target.value })
            }
          >
            <option value="">Select a country…</option>
            {COUNTRIES_BY_NAME.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Name
          <input
            type="text"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.target.value })}
          />
        </label>
        <label>
          Folder
          <input
            type="text"
            value={form.folder}
            onChange={(e) => setForm({ ...form, folder: e.target.value })}
          />
        </label>
        <label>
          URL
          <input
            type="text"
            value={form.url}
            onChange={(e) => {
              setForm({ ...form, url: e.target.value });
              clearTest();
            }}
          />
        </label>
        <label>
          Codec
          <select
            value={form.codec}
            onChange={(e) => handleCodecChange(e.target.value as Codec)}
          >
            {CODEC_OPTIONS.map((c) => (
              <option key={c.codec} value={c.codec}>
                {c.codec}
              </option>
            ))}
          </select>
        </label>
        {codecOption(form.codec).kind === "lossy" ? (
          <label>
            Bitrate (kbps)
            <select
              value={form.bitrate_kbps ?? ""}
              onChange={(e) =>
                setForm({ ...form, bitrate_kbps: Number(e.target.value) })
              }
            >
              {codecOption(form.codec).bitrates.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            Bit depth
            <select
              value={form.bit_depth ?? ""}
              onChange={(e) =>
                setForm({ ...form, bit_depth: Number(e.target.value) })
              }
            >
              {codecOption(form.codec).bitDepths.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className="settings-form-actions">
          <button
            type="button"
            onClick={handleTest}
            disabled={testing || form.url.trim() === ""}
          >
            {testing ? "Testing…" : "Test"}
          </button>
        </div>
        <p className="settings-url-test" role="status" aria-live="polite">
          {testError ? (
            <span className="settings-error">Not reachable: {testError}</span>
          ) : testResult ? (
            testResult.reachable ? (
              <span className="settings-success">
                Reachable
                {testResult.contentType
                  ? ` (${testResult.contentType})`
                  : ""}
              </span>
            ) : (
              <span className="settings-error">
                Not reachable: {testResult.detail}
              </span>
            )
          ) : null}
        </p>
        {formError && (
          <p className="settings-error" role="alert">
            {formError}
          </p>
        )}
        <div className="settings-form-actions">
          <button type="submit" disabled={submitting}>
            {submitting
              ? "Saving…"
              : editingId === null
                ? "Add stream"
                : "Save changes"}
          </button>
          {editingId !== null && (
            <button type="button" onClick={resetForm}>
              Cancel
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
