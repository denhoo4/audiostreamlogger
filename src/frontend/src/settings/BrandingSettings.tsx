import { useEffect, useRef, useState } from "react";
import {
  Alert,
  Button,
  FileInput,
  Group,
  Image,
  Stack,
  Text,
  TextInput,
  Title,
} from "@mantine/core";
import {
  ApiError,
  faviconUrl,
  getPublicConfig,
  putTitle,
  uploadFavicon,
} from "../api";
import { Panel } from "../ui";

/**
 * Branding admin section (task features 1 & 2). Two forms:
 *   - a page-title text input + Save (PUT /api/app-config/title).
 *   - a favicon file picker + Upload (POST /api/branding/favicon) with a live
 *     <img> preview of the current icon (faviconUrl()); after a successful
 *     upload a cache-busting query param forces the browser to refetch it.
 * Validation / conflict messages are surfaced the same way as the other
 * settings components (ApiError.message).
 *
 * Restyled to the Mantine AI-Studio house style (Panel + Mantine
 * TextInput/FileInput/Button/Alert); every api.ts call, the iconVersion
 * cache-bust preview, the file-input ref/reset and the <h2> heading are
 * preserved verbatim.
 */
export default function BrandingSettings() {
  const [title, setTitle] = useState<string>("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [titleStatus, setTitleStatus] = useState<string | null>(null);

  const [file, setFile] = useState<File | null>(null);
  const [iconError, setIconError] = useState<string | null>(null);
  const [iconStatus, setIconStatus] = useState<string | null>(null);
  // Cache-buster appended to the preview src after a successful upload.
  const [iconVersion, setIconVersion] = useState<number>(0);
  // Ref to the Mantine FileInput control; clearing `file` state resets the
  // shown value, and resetValue() clears any residual native input value.
  const fileInputRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    getPublicConfig()
      .then(({ title: t }) => setTitle(t))
      .catch((err) =>
        setTitleError(
          err instanceof ApiError ? err.message : "Could not load title",
        ),
      );
  }, []);

  async function handleSaveTitle() {
    setTitleError(null);
    setTitleStatus("Saving…");
    try {
      const saved = await putTitle(title);
      setTitle(saved.title);
      setTitleStatus("Saved");
    } catch (err) {
      setTitleStatus(null);
      setTitleError(
        err instanceof ApiError ? err.message : "Could not save title",
      );
    }
  }

  async function handleUpload() {
    if (!file) {
      setIconError("Choose a file first");
      return;
    }
    setIconError(null);
    setIconStatus("Uploading…");
    try {
      await uploadFavicon(file);
      setIconStatus("Uploaded");
      setIconVersion((v) => v + 1);
      // Reset the file picker: clearing the controlled value empties the
      // FileInput, and we also clear the native input via the ref for parity
      // with the previous behaviour.
      setFile(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
    } catch (err) {
      setIconStatus(null);
      setIconError(
        err instanceof ApiError ? err.message : "Could not upload favicon",
      );
    }
  }

  const previewSrc =
    iconVersion > 0 ? `${faviconUrl()}?v=${iconVersion}` : faviconUrl();

  return (
    <section className="settings-section">
      <Title order={2}>Branding</Title>

      <Panel mt="md">
        <Stack gap="sm">
          <Title order={3}>Page title</Title>
          <TextInput
            label="Title"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.currentTarget.value)}
          />
          {titleError && (
            <Alert color="red" role="alert">
              {titleError}
            </Alert>
          )}
          {titleStatus && (
            <Text role="status" c="dimmed">
              {titleStatus}
            </Text>
          )}
          <Group>
            <Button type="button" onClick={handleSaveTitle}>
              Save
            </Button>
          </Group>
        </Stack>
      </Panel>

      <Panel mt="md">
        <Stack gap="sm">
          <Title order={3}>Favicon</Title>
          <Image
            src={previewSrc}
            alt="Current favicon"
            w={32}
            h={32}
            fit="contain"
          />
          <FileInput
            ref={fileInputRef}
            label="File"
            placeholder="Choose a file…"
            accept="image/png,image/x-icon,image/vnd.microsoft.icon,image/svg+xml,.png,.ico,.svg"
            value={file}
            onChange={setFile}
          />
          {iconError && (
            <Alert color="red" role="alert">
              {iconError}
            </Alert>
          )}
          {iconStatus && (
            <Text role="status" c="dimmed">
              {iconStatus}
            </Text>
          )}
          <Group>
            <Button type="button" onClick={handleUpload}>
              Upload
            </Button>
          </Group>
        </Stack>
      </Panel>
    </section>
  );
}
