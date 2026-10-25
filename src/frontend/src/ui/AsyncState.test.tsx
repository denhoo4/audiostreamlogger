import { afterEach, describe, expect, it } from "vitest";
import {
  cleanup,
  renderWithMantine,
  screen,
} from "../test/render-with-mantine";
import { AsyncState } from "./AsyncState";

/**
 * AsyncState is a thin presentational switch over the three transient panel
 * states. We assert behaviour/roles and the user-visible text only (never class
 * names), including the documented precedence (error wins over loading/empty).
 */
describe("AsyncState", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders an alert with the error message and NOT the children", () => {
    renderWithMantine(
      <AsyncState error="Something broke">
        <div>ready content</div>
      </AsyncState>,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("Something broke");
    expect(screen.queryByText("ready content")).not.toBeInTheDocument();
  });

  it("renders the loading message and NOT the children when loading", () => {
    renderWithMantine(
      <AsyncState loading loadingMessage="Loading…">
        <div>ready content</div>
      </AsyncState>,
    );
    expect(screen.getByText("Loading…")).toBeInTheDocument();
    expect(screen.queryByText("ready content")).not.toBeInTheDocument();
  });

  it("renders the empty message when empty", () => {
    renderWithMantine(
      <AsyncState empty emptyMessage="Nothing here yet.">
        <div>ready content</div>
      </AsyncState>,
    );
    expect(screen.getByText("Nothing here yet.")).toBeInTheDocument();
    expect(screen.queryByText("ready content")).not.toBeInTheDocument();
  });

  it("renders the children in the ready state", () => {
    renderWithMantine(
      <AsyncState>
        <div>ready content</div>
      </AsyncState>,
    );
    expect(screen.getByText("ready content")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("gives error precedence over loading and empty", () => {
    renderWithMantine(
      <AsyncState loading empty error="boom">
        <div>ready content</div>
      </AsyncState>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("boom");
    expect(screen.queryByText("ready content")).not.toBeInTheDocument();
  });
});
