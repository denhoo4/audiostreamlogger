import { useEffect, useRef, useState } from "react";
import {
  ApiError,
  faviconUrl,
  getPublicConfig,
  putTitle,
  uploadFavicon,
} from "../api";

/**
 * Branding admin section (task features 1 & 2). Two forms:
 *   - a page-title text input + Save (PUT /api/app-config/title).
 *   - a favicon file picker + Upload (POST /api/branding/favicon) with a live
 *     <img> preview of the current icon (faviconUrl()); after a successful
 *     upload a cache-busting query param forces the browser to refetch it.
 * Validation / conflict messages are surfaced the same way as the other
 * settings components (ApiError.message).
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
  const fileInputRef = useRef<HTMLInputElement | null>(null);

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
      <h2>Branding</h2>

      <div className="settings-form">
        <h3>Page title</h3>
        <label>
          Title
          <input
            type="text"
            value={title}
            maxLength={200}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        {titleError && (
          <p className="settings-error" role="alert">
            {titleError}
          </p>
        )}
        {titleStatus && <p>{titleStatus}</p>}
        <div className="settings-form-actions">
          <button type="button" onClick={handleSaveTitle}>
            Save
          </button>
        </div>
      </div>

      <div className="settings-form">
        <h3>Favicon</h3>
        <img
          src={previewSrc}
          alt="Current favicon"
          width={32}
          height={32}
        />
        <label>
          File
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/x-icon,image/vnd.microsoft.icon,image/svg+xml,.png,.ico,.svg"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
        </label>
        {iconError && (
          <p className="settings-error" role="alert">
            {iconError}
          </p>
        )}
        {iconStatus && <p>{iconStatus}</p>}
        <div className="settings-form-actions">
          <button type="button" onClick={handleUpload}>
            Upload
          </button>
        </div>
      </div>
    </section>
  );
}
