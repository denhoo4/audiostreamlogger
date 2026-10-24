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
  type StreamInput,
  type StreamRecord,
  type StreamTestResult,
} from "../api";
import { COUNTRIES_BY_NAME, countryName } from "./countries";

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

/** Empty add/edit form state. */
const EMPTY_FORM: StreamInput = {
  country: "",
  name: "",
  folder: "",
  url: "",
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
    });
    setFormError(null);
    clearTest();
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
