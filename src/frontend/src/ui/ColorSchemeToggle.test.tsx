import { afterEach, describe, expect, it } from "vitest";
import {
  cleanup,
  fireEvent,
  renderWithMantine,
  screen,
} from "../test/render-with-mantine";
import { ColorSchemeToggle } from "./ColorSchemeToggle";

/**
 * The ColorSchemeToggle is the header control that lets the user follow the
 * device (System/'auto') or pin Light/Dark. These tests assert behaviour: the
 * three labelled options render and selecting one is operable (does not throw
 * and updates the control's checked option).
 */
describe("ColorSchemeToggle", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders the three accessible scheme options", () => {
    renderWithMantine(<ColorSchemeToggle />);

    // Each option is a labelled radio (SegmentedControl renders radios) with
    // the visually-hidden text as its accessible name.
    expect(screen.getByRole("radio", { name: "System" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Light" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Dark" })).toBeInTheDocument();
  });

  it("selecting Light then Dark changes the active option", () => {
    renderWithMantine(<ColorSchemeToggle />);

    const light = screen.getByRole("radio", { name: "Light" });
    fireEvent.click(light);
    expect(light).toBeChecked();

    const dark = screen.getByRole("radio", { name: "Dark" });
    fireEvent.click(dark);
    expect(dark).toBeChecked();
  });
});
