import { useEffect, useState, type FormEvent } from "react";
import {
  ActionIcon,
  Alert,
  Button,
  Group,
  Modal,
  NativeSelect,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  ApiError,
  createStream,
  deleteStream,
  getDeletionImpact,
  getPublicConfig,
  getStreams,
  reorderStreams,
  setDefaultStream,
  testStreamUrl,
  updateStream,
  type Codec,
  type DeletionImpact,
  type StreamInput,
  type StreamRecord,
  type StreamTestResult,
} from "../api";
import { COUNTRIES_BY_NAME, countryName } from "./countries";
import { Panel, StatusBadge } from "../ui";

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

/** Human-readable byte size for the advisory deletion-impact display. */
function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i += 1;
  }
  return `${value.toFixed(1)} ${units[i]}`;
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
 *
 * Phase-3 reskin: this screen is rendered with Mantine in the AI-Studio dark
 * style (Table inside a Panel, NativeSelect/TextInput fields, ActionIcon
 * reorder, Alert feedback, a Modal for the typed-confirm delete). All behaviour,
 * accessible names and api.ts calls are preserved — this is a reskin, not a
 * logic change.
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

  // Typed-confirm DELETE flow (TODO item 25). `deleteTarget` is the row being
  // deleted (null when no confirm panel is open); `deleteImpact` is the advisory
  // file/byte snapshot; `deleteTyped` is what the admin has typed to confirm;
  // `deleteError` surfaces a 409 ('recording right now') or other delete error.
  const [deleteTarget, setDeleteTarget] = useState<StreamRecord | null>(null);
  const [deleteImpact, setDeleteImpact] = useState<DeletionImpact | null>(null);
  const [deleteTyped, setDeleteTyped] = useState("");
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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

  /**
   * Open the typed-confirm delete panel for a row and fetch its advisory
   * impact. The actual delete does not fire until the admin types the folder
   * name and clicks Confirm (handleDeleteConfirm).
   */
  async function openDeleteConfirm(stream: StreamRecord) {
    setDeleteTarget(stream);
    setDeleteImpact(null);
    setDeleteTyped("");
    setDeleteError(null);
    try {
      setDeleteImpact(await getDeletionImpact(stream.id));
    } catch (err) {
      // The count is advisory; a failure to load it must not block the typed
      // confirm. Show the reason but keep the panel open.
      setDeleteError(
        err instanceof ApiError
          ? err.message
          : "Could not load deletion impact",
      );
    }
  }

  /** Abort the delete: close the confirm panel, discard the typed value. */
  function cancelDelete() {
    setDeleteTarget(null);
    setDeleteImpact(null);
    setDeleteTyped("");
    setDeleteError(null);
  }

  /**
   * Fire the DELETE once the typed folder name matches. Surfaces a 409
   * ('recording right now') or any other backend error inline without closing
   * the panel so the admin can retry.
   */
  async function handleDeleteConfirm() {
    if (!deleteTarget || deleteTyped !== deleteTarget.folder) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await deleteStream(deleteTarget.id);
      if (editingId === deleteTarget.id) resetForm();
      cancelDelete();
      await refresh();
    } catch (err) {
      setDeleteError(
        err instanceof ApiError ? err.message : "Could not delete stream",
      );
    } finally {
      setDeleting(false);
    }
  }

  const opt = codecOption(form.codec);

  return (
    <section className="settings-section">
      <Title order={2}>Streams</Title>

      {listError && (
        <Alert color="red" role="alert" mt="md">
          {listError}
        </Alert>
      )}

      <Panel mt="md">
        {loading ? (
          <Text>Loading…</Text>
        ) : streams.length === 0 ? (
          <Text>No streams yet.</Text>
        ) : (
          <Table.ScrollContainer minWidth={720} type="native">
          <Table verticalSpacing="sm" horizontalSpacing="md" layout="fixed">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>Name</Table.Th>
                <Table.Th>Folder</Table.Th>
                <Table.Th>URL</Table.Th>
                <Table.Th style={{ width: 120 }}>Default stream</Table.Th>
                <Table.Th style={{ width: 96 }}>Order</Table.Th>
                <Table.Th style={{ width: 160 }} />
              </Table.Tr>
            </Table.Thead>
            {groupByCountry(streams).map((group) => (
              <Table.Tbody key={group.country}>
                <Table.Tr>
                  <Table.Th colSpan={6} scope="colgroup">
                    {countryName(group.country)}
                  </Table.Th>
                </Table.Tr>
                {group.rows.map((s) => {
                  const flatIndex = streams.findIndex((x) => x.id === s.id);
                  const isDefault = s.folder === defaultFolder;
                  return (
                    <Table.Tr key={s.id}>
                      <Table.Td>{s.name}</Table.Td>
                      <Table.Td>{s.folder}</Table.Td>
                      <Table.Td>
                        <Tooltip label={s.url} multiline maw={520}>
                          <Text truncate title={s.url}>
                            {s.url}
                          </Text>
                        </Tooltip>
                      </Table.Td>
                      <Table.Td>
                        {isDefault ? (
                          <StatusBadge status="ok">Default</StatusBadge>
                        ) : (
                          <Button
                            variant="default"
                            size="xs"
                            onClick={() => handleSetDefault(s.folder)}
                          >
                            Set default
                          </Button>
                        )}
                      </Table.Td>
                      <Table.Td>
                        <Group gap="xs" wrap="nowrap">
                          <ActionIcon
                            variant="default"
                            aria-label={`Move ${s.name} up`}
                            disabled={flatIndex === 0}
                            onClick={() => handleReorder(s.id, -1)}
                          >
                            ▲
                          </ActionIcon>
                          <ActionIcon
                            variant="default"
                            aria-label={`Move ${s.name} down`}
                            disabled={flatIndex === streams.length - 1}
                            onClick={() => handleReorder(s.id, 1)}
                          >
                            ▼
                          </ActionIcon>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <Group gap="xs" wrap="nowrap">
                          <Button
                            variant="default"
                            size="xs"
                            onClick={() => startEdit(s)}
                          >
                            Edit
                          </Button>
                          <Button
                            color="red"
                            variant="light"
                            size="xs"
                            onClick={() => openDeleteConfirm(s)}
                          >
                            Delete
                          </Button>
                        </Group>
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            ))}
          </Table>
          </Table.ScrollContainer>
        )}
      </Panel>

      <Modal
        opened={!!deleteTarget}
        onClose={cancelDelete}
        title="Delete stream"
      >
        {deleteTarget && (
          <Stack gap="sm">
            <Alert color="red" role="alert">
              This permanently deletes the <b>{deleteTarget.name}</b> stream, its
              recordings rows and its on-disk folder{" "}
              <code>{deleteTarget.folder}</code>. This cannot be undone.
            </Alert>
            <Text>
              {deleteImpact
                ? `On disk: ${deleteImpact.fileCount} file(s), ${formatBytes(deleteImpact.totalBytes)}.`
                : "Loading impact…"}
            </Text>
            <Text size="sm">
              Type the folder name <code>{deleteTarget.folder}</code> to confirm
            </Text>
            <TextInput
              aria-label="Type folder name to confirm delete"
              value={deleteTyped}
              onChange={(e) => setDeleteTyped(e.currentTarget.value)}
            />
            {deleteError && (
              <Alert color="red" role="alert">
                {deleteError}
              </Alert>
            )}
            <Group justify="flex-end">
              <Button variant="default" onClick={cancelDelete}>
                Cancel
              </Button>
              <Button
                color="red"
                disabled={deleting || deleteTyped !== deleteTarget.folder}
                onClick={handleDeleteConfirm}
              >
                {deleting ? "Deleting…" : "Confirm delete"}
              </Button>
            </Group>
          </Stack>
        )}
      </Modal>

      <form onSubmit={handleSubmit}>
       <Panel mt="md">
        <Stack gap="sm">
          <Title order={3}>
            {editingId === null ? "Add stream" : "Edit stream"}
          </Title>
          <NativeSelect
            label="Country"
            value={form.country}
            onChange={(e) =>
              setForm({ ...form, country: e.currentTarget.value })
            }
            data={[
              { value: "", label: "Select a country…" },
              ...COUNTRIES_BY_NAME.map((c) => ({
                value: c.code,
                label: c.name,
              })),
            ]}
          />
          <TextInput
            label="Name"
            value={form.name}
            onChange={(e) => setForm({ ...form, name: e.currentTarget.value })}
          />
          <TextInput
            label="Folder"
            value={form.folder}
            onChange={(e) =>
              setForm({ ...form, folder: e.currentTarget.value })
            }
          />
          {editingId !== null && (
            <Alert color="yellow" role="note">
              Changing the folder MOVES the existing recordings on disk to the
              new folder. It is refused while the stream is recording the current
              hour.
            </Alert>
          )}
          <TextInput
            label="URL"
            value={form.url}
            onChange={(e) => {
              setForm({ ...form, url: e.currentTarget.value });
              clearTest();
            }}
          />
          <NativeSelect
            label="Codec"
            value={form.codec}
            onChange={(e) => handleCodecChange(e.currentTarget.value as Codec)}
            data={CODEC_OPTIONS.map((c) => ({
              value: c.codec,
              label: c.codec,
            }))}
          />
          {opt.kind === "lossy" ? (
            <NativeSelect
              label="Bitrate (kbps)"
              value={form.bitrate_kbps ?? ""}
              onChange={(e) =>
                setForm({ ...form, bitrate_kbps: Number(e.currentTarget.value) })
              }
              data={opt.bitrates.map((b) => ({
                value: String(b),
                label: String(b),
              }))}
            />
          ) : (
            <NativeSelect
              label="Bit depth"
              value={form.bit_depth ?? ""}
              onChange={(e) =>
                setForm({ ...form, bit_depth: Number(e.currentTarget.value) })
              }
              data={opt.bitDepths.map((d) => ({
                value: String(d),
                label: String(d),
              }))}
            />
          )}
          <Group>
            <Button
              type="button"
              variant="default"
              onClick={handleTest}
              disabled={testing || form.url.trim() === ""}
            >
              {testing ? "Testing…" : "Test"}
            </Button>
          </Group>
          <div role="status" aria-live="polite">
            {testError ? (
              <Alert color="red">Not reachable: {testError}</Alert>
            ) : testResult ? (
              testResult.reachable ? (
                <Alert color="green">
                  Reachable
                  {testResult.contentType
                    ? ` (${testResult.contentType})`
                    : ""}
                </Alert>
              ) : (
                <Alert color="red">
                  Not reachable: {testResult.detail}
                </Alert>
              )
            ) : null}
          </div>
          {formError && (
            <Alert color="red" role="alert">
              {formError}
            </Alert>
          )}
          <Group>
            <Button type="submit" disabled={submitting}>
              {submitting
                ? "Saving…"
                : editingId === null
                  ? "Add stream"
                  : "Save changes"}
            </Button>
            {editingId !== null && (
              <Button type="button" variant="default" onClick={resetForm}>
                Cancel
              </Button>
            )}
          </Group>
        </Stack>
       </Panel>
      </form>
    </section>
  );
}
