import { useEffect, useState } from "react";
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
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconPencil,
  IconPlus,
  IconStar,
  IconStarFilled,
  IconX,
} from "@tabler/icons-react";
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
import { deriveFolder } from "./derive-folder";
import { Panel } from "../ui";
import classes from "./StreamTable.module.css";

/**
 * Valid recording-quality combinations per codec, mirroring the api allowlist
 * (src/api/lib/validate-stream.js CODECS). A lossy codec carries a bitrate from
 * its set and no bit-depth; a lossless codec carries a bit-depth and no
 * bitrate. The editor only ever offers combos from this table, so it can never
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
  return CODEC_OPTIONS.find((c) => c.codec === codec) ?? CODEC_OPTIONS[0];
}

/** Compact read-view label for a row's codec + quality, e.g. 'mp3 @ 160' / 'flac 24-bit'. */
function qualityLabel(row: {
  codec: Codec;
  bitrate_kbps: number | null;
  bit_depth: number | null;
}): string {
  if (row.bit_depth != null) return `${row.codec} ${row.bit_depth}-bit`;
  if (row.bitrate_kbps != null) return `${row.codec} @ ${row.bitrate_kbps}`;
  return row.codec;
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

/** Empty draft state (behaviour-preserving mp3@160 quality default). */
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
 * Discriminated inline-edit state. `null` = no row is being edited.
 * `id: "new"` = the blank new-stream row (Save -> createStream with a DERIVED
 * folder). A numeric `id` = that existing row is in edit mode (Save ->
 * updateStream with the ORIGINAL stored folder, never re-derived). `draft`
 * holds the in-progress field values. One row is editable at a time.
 */
type EditState = { id: number | "new"; draft: StreamInput } | null;

/** Column count of the table (used for the full-width new-row + headers). */
const COLSPAN = 6;

/**
 * Admin stream CRUD table with INLINE row editing. Lists getStreams(); clicking
 * the pencil turns that row into inputs in place (name/url TextInput, country +
 * codec + bitrate/bit-depth NativeSelect, inline URL reachability Test). Save
 * commits via createStream (new row, derived folder) or updateStream (existing
 * row, original folder kept verbatim); Cancel reverts. The Folder column is
 * hidden (folder still travels in every payload because the api validator
 * requires it). A '+ New stream' button inserts a blank editable row. Reorder
 * arrows are stacked vertically; set-default is a star toggle. Delete is a
 * typed-confirm Modal. All api.ts calls, accessible names and both light/dark
 * schemes are preserved.
 */
export default function StreamTable() {
  const [streams, setStreams] = useState<StreamRecord[]>([]);
  const [defaultFolder, setDefaultFolder] = useState("");
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  // Single inline-edit state (replaces the old bottom form).
  const [editing, setEditing] = useState<EditState>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Notice shown after a create whose derived folder collided and was suffixed.
  const [folderNotice, setFolderNotice] = useState<string | null>(null);

  // Advisory URL reachability "Test" state (operates on editing.draft.url).
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<StreamTestResult | null>(null);
  const [testError, setTestError] = useState<string | null>(null);

  // Typed-confirm DELETE flow (unchanged from the previous behaviour).
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

  /**
   * Toggle a row's default: clicking an unfilled star sets this folder as the
   * default; clicking the filled (default) star clears it (the backend accepts
   * an empty folder to clear).
   */
  async function handleToggleDefault(folder: string, isDefault: boolean) {
    setListError(null);
    try {
      const { default_stream_folder } = await setDefaultStream(
        isDefault ? "" : folder,
      );
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

  /** Clear the inline editor and its transient Test/error state. */
  function cancelEdit() {
    setEditing(null);
    setFormError(null);
    clearTest();
  }

  /** Enter edit mode for an existing row, seeding the draft from its values. */
  function startEdit(stream: StreamRecord) {
    setEditing({
      id: stream.id,
      draft: {
        country: stream.country,
        name: stream.name,
        folder: stream.folder,
        url: stream.url,
        codec: stream.codec,
        bitrate_kbps: stream.bitrate_kbps,
        bit_depth: stream.bit_depth,
      },
    });
    setFormError(null);
    setFolderNotice(null);
    clearTest();
  }

  /** Open a blank editable "new stream" row. */
  function startNew() {
    setEditing({ id: "new", draft: { ...EMPTY_FORM } });
    setFormError(null);
    setFolderNotice(null);
    clearTest();
  }

  /** Patch the current draft (no-op if nothing is being edited). */
  function patchDraft(patch: Partial<StreamInput>) {
    setEditing((cur) =>
      cur === null ? cur : { ...cur, draft: { ...cur.draft, ...patch } },
    );
  }

  /**
   * Switch the draft's codec and reset the dependent quality fields to a valid
   * combo for the new codec: a lossy codec gets its first bitrate and a null
   * bit-depth; a lossless codec gets its first bit-depth and a null bitrate.
   * This keeps the editor from ever holding (and submitting) an invalid
   * codec/bitrate/bit-depth combination (AC-10).
   */
  function handleCodecChange(codec: Codec) {
    const opt = codecOption(codec);
    patchDraft({
      codec,
      bitrate_kbps: opt.kind === "lossy" ? opt.bitrates[0] : null,
      bit_depth: opt.kind === "lossless" ? opt.bitDepths[0] : null,
    });
  }

  /**
   * Run the advisory reachability probe for the draft's url. NON-BLOCKING:
   * this never saves and never blocks Save; it only shows an inline reachable /
   * not-reachable result. Guards against an empty url.
   */
  async function handleTest() {
    const url = editing?.draft.url.trim() ?? "";
    if (url === "") return;
    setTesting(true);
    clearTest();
    try {
      setTestResult(await testStreamUrl(url));
    } catch (err) {
      setTestError(
        err instanceof ApiError ? err.message : "Could not test the URL",
      );
    } finally {
      setTesting(false);
    }
  }

  /**
   * Commit the inline editor. A NEW row calls createStream with a DERIVED
   * folder (and surfaces a notice when the derivation collided and was
   * suffixed). An EXISTING row calls updateStream with the ORIGINAL stored
   * folder kept verbatim — the folder is never re-derived on a name edit, so
   * existing recordings never move.
   */
  async function handleSave() {
    if (!editing) return;
    setFormError(null);
    setFolderNotice(null);
    setSubmitting(true);
    try {
      if (editing.id === "new") {
        const { folder, collided } = deriveFolder(
          editing.draft.name,
          streams.map((s) => s.folder),
        );
        await createStream({ ...editing.draft, folder });
        if (collided) {
          setFolderNotice(
            `Folder name already in use — saved as “${folder}”.`,
          );
        }
      } else {
        const original = streams.find((s) => s.id === editing.id);
        await updateStream(editing.id, {
          ...editing.draft,
          // Keep the STORED folder verbatim; never re-derive on a name edit.
          folder: original ? original.folder : editing.draft.folder,
        });
      }
      cancelEdit();
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
      if (editing && editing.id === deleteTarget.id) cancelEdit();
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

  /** Country <select> options shared by every editable row. */
  const countryData = [
    { value: "", label: "Select a country…" },
    ...COUNTRIES_BY_NAME.map((c) => ({ value: c.code, label: c.name })),
  ];

  /**
   * Render the inline editor cells for the current draft. Used both for an
   * existing row in edit mode and for the blank new-stream row. `nameLabel`
   * feeds the Save/Cancel accessible names.
   */
  function renderEditorRow(nameLabel: string, isNew: boolean) {
    if (!editing) return null;
    const draft = editing.draft;
    const opt = codecOption(draft.codec);
    return (
      <>
        <Table.Td className={classes.streamNameCell}>
          <TextInput
            aria-label="Name"
            value={draft.name}
            onChange={(e) => patchDraft({ name: e.currentTarget.value })}
          />
        </Table.Td>
        <Table.Td>
          <NativeSelect
            aria-label="Country"
            value={draft.country}
            onChange={(e) => patchDraft({ country: e.currentTarget.value })}
            data={countryData}
          />
        </Table.Td>
        <Table.Td>
          <Stack gap="xs">
            <TextInput
              aria-label="URL"
              value={draft.url}
              onChange={(e) => {
                patchDraft({ url: e.currentTarget.value });
                clearTest();
              }}
            />
            <Group gap="xs" wrap="nowrap">
              <Button
                type="button"
                variant="default"
                size="xs"
                onClick={handleTest}
                disabled={testing || draft.url.trim() === ""}
              >
                {testing ? "Testing…" : "Test"}
              </Button>
              <div role="status" aria-live="polite">
                {testError ? (
                  <Text size="xs" c="red">
                    Not reachable: {testError}
                  </Text>
                ) : testResult ? (
                  testResult.reachable ? (
                    <Text size="xs" c="green">
                      Reachable
                      {testResult.contentType
                        ? ` (${testResult.contentType})`
                        : ""}
                    </Text>
                  ) : (
                    <Text size="xs" c="red">
                      Not reachable: {testResult.detail}
                    </Text>
                  )
                ) : null}
              </div>
            </Group>
          </Stack>
        </Table.Td>
        <Table.Td>
          <Stack gap="xs">
            <NativeSelect
              aria-label="Codec"
              value={draft.codec}
              onChange={(e) =>
                handleCodecChange(e.currentTarget.value as Codec)
              }
              data={CODEC_OPTIONS.map((c) => ({
                value: c.codec,
                label: c.codec,
              }))}
            />
            {opt.kind === "lossy" ? (
              <NativeSelect
                aria-label="Bitrate (kbps)"
                value={draft.bitrate_kbps ?? ""}
                onChange={(e) =>
                  patchDraft({ bitrate_kbps: Number(e.currentTarget.value) })
                }
                data={opt.bitrates.map((b) => ({
                  value: String(b),
                  label: String(b),
                }))}
              />
            ) : (
              <NativeSelect
                aria-label="Bit depth"
                value={draft.bit_depth ?? ""}
                onChange={(e) =>
                  patchDraft({ bit_depth: Number(e.currentTarget.value) })
                }
                data={opt.bitDepths.map((d) => ({
                  value: String(d),
                  label: String(d),
                }))}
              />
            )}
          </Stack>
        </Table.Td>
        {/* No star control while editing. */}
        <Table.Td />
        <Table.Td>
          <Group gap="xs" wrap="nowrap">
            <Tooltip label="Save">
              <ActionIcon
                variant="filled"
                aria-label={isNew ? "Save new stream" : `Save ${nameLabel}`}
                loading={submitting}
                onClick={handleSave}
              >
                <IconCheck size={16} />
              </ActionIcon>
            </Tooltip>
            <Tooltip label="Cancel edit">
              <ActionIcon
                variant="default"
                aria-label="Cancel edit"
                disabled={submitting}
                onClick={cancelEdit}
              >
                <IconX size={16} />
              </ActionIcon>
            </Tooltip>
          </Group>
        </Table.Td>
      </>
    );
  }

  return (
    <section className="settings-section">
      <Group justify="space-between" align="center">
        <Title order={2}>Streams</Title>
        <Button
          leftSection={<IconPlus size={16} />}
          onClick={startNew}
          disabled={editing !== null}
        >
          New stream
        </Button>
      </Group>

      {listError && (
        <Alert color="red" role="alert" mt="md">
          {listError}
        </Alert>
      )}
      {folderNotice && (
        <Alert color="blue" role="status" mt="md" withCloseButton
          onClose={() => setFolderNotice(null)}>
          {folderNotice}
        </Alert>
      )}
      {formError && (
        <Alert color="red" role="alert" mt="md">
          {formError}
        </Alert>
      )}

      <Panel mt="md">
        {loading ? (
          <Text>Loading…</Text>
        ) : streams.length === 0 && editing?.id !== "new" ? (
          <Text>No streams yet.</Text>
        ) : (
          <Table.ScrollContainer minWidth={720} type="native">
            <Table verticalSpacing="sm" horizontalSpacing="md" layout="fixed">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>Name</Table.Th>
                  <Table.Th style={{ width: 160 }}>Country</Table.Th>
                  <Table.Th>URL</Table.Th>
                  <Table.Th style={{ width: 150 }}>Quality</Table.Th>
                  <Table.Th style={{ width: 72 }}>Default</Table.Th>
                  <Table.Th style={{ width: 120 }}>Actions</Table.Th>
                </Table.Tr>
              </Table.Thead>

              {editing?.id === "new" && (
                <Table.Tbody>
                  <Table.Tr>
                    <Table.Th
                      colSpan={COLSPAN}
                      scope="colgroup"
                      className={classes.countryHeaderCell}
                    >
                      New stream
                    </Table.Th>
                  </Table.Tr>
                  <Table.Tr>{renderEditorRow("new stream", true)}</Table.Tr>
                </Table.Tbody>
              )}

              {groupByCountry(streams).map((group) => (
                <Table.Tbody key={group.country}>
                  <Table.Tr>
                    <Table.Th
                      colSpan={COLSPAN}
                      scope="colgroup"
                      className={classes.countryHeaderCell}
                    >
                      {countryName(group.country)}
                    </Table.Th>
                  </Table.Tr>
                  {group.rows.map((s) => {
                    const flatIndex = streams.findIndex((x) => x.id === s.id);
                    const isDefault = s.folder === defaultFolder;
                    const isEditingThis =
                      editing !== null && editing.id === s.id;
                    if (isEditingThis) {
                      return (
                        <Table.Tr key={s.id}>
                          {renderEditorRow(s.name, false)}
                        </Table.Tr>
                      );
                    }
                    return (
                      <Table.Tr key={s.id}>
                        <Table.Td className={classes.streamNameCell}>
                          {s.name}
                        </Table.Td>
                        <Table.Td>{countryName(s.country)}</Table.Td>
                        <Table.Td>
                          <Tooltip label={s.url} multiline maw={520}>
                            <Text truncate title={s.url}>
                              {s.url}
                            </Text>
                          </Tooltip>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">{qualityLabel(s)}</Text>
                        </Table.Td>
                        <Table.Td>
                          <Tooltip
                            label={isDefault ? "Default stream" : "Set as default"}
                          >
                            <ActionIcon
                              variant={isDefault ? "light" : "default"}
                              color={isDefault ? "yellow" : undefined}
                              aria-label={
                                isDefault ? "Default stream" : "Set as default"
                              }
                              onClick={() =>
                                handleToggleDefault(s.folder, isDefault)
                              }
                            >
                              {isDefault ? (
                                <IconStarFilled size={16} />
                              ) : (
                                <IconStar size={16} />
                              )}
                            </ActionIcon>
                          </Tooltip>
                        </Table.Td>
                        <Table.Td>
                          <Group gap="xs" wrap="nowrap" align="center">
                            <Stack gap={0}>
                              <ActionIcon
                                variant="default"
                                size="sm"
                                aria-label={`Move ${s.name} up`}
                                disabled={flatIndex === 0 || editing !== null}
                                onClick={() => handleReorder(s.id, -1)}
                              >
                                <IconChevronUp size={14} />
                              </ActionIcon>
                              <ActionIcon
                                variant="default"
                                size="sm"
                                aria-label={`Move ${s.name} down`}
                                disabled={
                                  flatIndex === streams.length - 1 ||
                                  editing !== null
                                }
                                onClick={() => handleReorder(s.id, 1)}
                              >
                                <IconChevronDown size={14} />
                              </ActionIcon>
                            </Stack>
                            <Tooltip label={`Edit ${s.name}`}>
                              <ActionIcon
                                variant="default"
                                aria-label={`Edit ${s.name}`}
                                disabled={editing !== null}
                                onClick={() => startEdit(s)}
                              >
                                <IconPencil size={16} />
                              </ActionIcon>
                            </Tooltip>
                            <Tooltip label={`Delete ${s.name}`}>
                              <ActionIcon
                                color="red"
                                variant="light"
                                aria-label={`Delete ${s.name}`}
                                disabled={editing !== null}
                                onClick={() => openDeleteConfirm(s)}
                              >
                                <IconX size={16} />
                              </ActionIcon>
                            </Tooltip>
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
    </section>
  );
}
