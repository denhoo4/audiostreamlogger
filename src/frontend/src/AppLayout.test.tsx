import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, screen, waitFor } from "@testing-library/react";
import { renderWithMantine } from "./test/render-with-mantine";
import AppLayout from "./AppLayout";
import { DEFAULT_APP_TITLE, useBrandTitle } from "./useAppTitle";

// Mock getPublicConfig so useBrandTitle resolves against fixed data without
// touching the network. Only the title field matters for the brand.
const getPublicConfig = vi.fn();

vi.mock("./api", () => ({
  getPublicConfig: () => getPublicConfig(),
}));

// Root-style wrapper mirroring main.tsx: calls the hook and feeds the resolved
// brand title into AppLayout so we can assert a configured title reaches the
// header.
function BrandedLayout() {
  const title = useBrandTitle();
  return (
    <AppLayout title={title}>
      <div />
    </AppLayout>
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AppLayout", () => {
  it("shows an explicit title prop as the level-1 brand heading", () => {
    renderWithMantine(
      <AppLayout title="My Station">
        <div />
      </AppLayout>,
    );
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent("My Station");
  });

  it("falls back to the default brand when no title prop is given", () => {
    renderWithMantine(
      <AppLayout>
        <div />
      </AppLayout>,
    );
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading).toHaveTextContent(DEFAULT_APP_TITLE);
  });

  it("flows a configured title from getPublicConfig into the header", async () => {
    getPublicConfig.mockResolvedValue({
      title: "Configured Radio",
      default_stream_folder: "",
      country_order: [],
    });
    renderWithMantine(<BrandedLayout />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        "Configured Radio",
      );
    });
  });

  it("falls back to the default brand when the config fetch fails", async () => {
    getPublicConfig.mockRejectedValue(new Error("network"));
    renderWithMantine(<BrandedLayout />);
    await waitFor(() => {
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(
        DEFAULT_APP_TITLE,
      );
    });
  });
});
