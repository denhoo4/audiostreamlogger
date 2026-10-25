import { afterEach, describe, expect, it } from "vitest";
import {
  cleanup,
  renderWithMantine,
  screen,
} from "../test/render-with-mantine";
import { StatusBadge, type StatusKind } from "./StatusBadge";

/**
 * StatusBadge is a theme-driven pill: its contract is that each status renders a
 * badge in the DOM with the expected default label. We assert behaviour (the
 * text shows and the element exists), not class names or exact colours — the
 * colour mapping is a theme concern and stays internal.
 */
describe("StatusBadge", () => {
  afterEach(() => {
    cleanup();
  });

  const CASES: [StatusKind, string][] = [
    ["ok", "OK"],
    ["degraded", "Degraded"],
    ["down", "Down"],
    ["never", "Never"],
    ["recording", "Recording"],
    ["complete", "Complete"],
    ["partial", "Partial"],
  ];

  it.each(CASES)("renders the default label for %s", (status, label) => {
    renderWithMantine(<StatusBadge status={status} />);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it("lets a caller override the label via children", () => {
    renderWithMantine(<StatusBadge status="ok">Default</StatusBadge>);
    expect(screen.getByText("Default")).toBeInTheDocument();
    // The default "OK" label is not rendered when overridden.
    expect(screen.queryByText("OK")).not.toBeInTheDocument();
  });
});
