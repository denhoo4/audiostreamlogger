import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  renderWithMantine,
  screen,
  waitFor,
  within,
} from "../test/render-with-mantine";
import SchedulerConfig from "./SchedulerConfig";
import type { ScheduleRecord } from "../api";

/**
 * Documents reconcile parity and the moved log-retention field (FEAT-002 2c).
 * The api.ts clients are mocked so the component renders against fixed data:
 * listSchedules resolves one row per type (cleaner, peakfilegenerator,
 * reconcile), getLogRetention resolves { hours: 24 }, and the mutating clients
 * are vi.fn() spies we can assert on.
 */
const listSchedules = vi.fn<() => Promise<ScheduleRecord[]>>();
const getLogRetention = vi.fn<() => Promise<{ hours: number | null }>>();
const runJobNow = vi.fn();
const updateSchedule = vi.fn();
const setLogRetention = vi.fn();

vi.mock("../api", () => ({
  ApiError: class ApiError extends Error {},
  listSchedules: () => listSchedules(),
  getLogRetention: () => getLogRetention(),
  runJobNow: (type: string) => runJobNow(type),
  updateSchedule: (type: string, input: unknown) => updateSchedule(type, input),
  setLogRetention: (hours: number) => setLogRetention(hours),
}));

function makeSchedule(
  overrides: Partial<ScheduleRecord> & { type: ScheduleRecord["type"] },
): ScheduleRecord {
  return {
    enabled: 1,
    frequency: "daily",
    minute: 0,
    hour: 0,
    day_of_week: 0,
    last_run_at: null,
    ...overrides,
  };
}

const SCHEDULES: ScheduleRecord[] = [
  makeSchedule({ type: "cleaner", frequency: "hourly", minute: 10 }),
  makeSchedule({ type: "peakfilegenerator", frequency: "hourly", minute: 5 }),
  makeSchedule({ type: "reconcile", frequency: "daily", minute: 30, hour: 3 }),
];

/** Return the Panel (Mantine Card) whose <h3> title matches the job type. */
function cardFor(type: string): HTMLElement {
  const heading = screen.getByRole("heading", { name: type, level: 3 });
  const card = heading.closest<HTMLElement>(".mantine-Card-root");
  if (!card) throw new Error(`No card found for type "${type}"`);
  return card;
}

describe("SchedulerConfig", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  async function renderReady() {
    listSchedules.mockResolvedValue(SCHEDULES);
    getLogRetention.mockResolvedValue({ hours: 24 });
    renderWithMantine(<SchedulerConfig />);
    // Wait until the cards have rendered (loading text gone).
    await screen.findByRole("heading", { name: "cleaner", level: 3 });
  }

  it("renders a card for each of the three job types", async () => {
    await renderReady();
    for (const type of ["cleaner", "peakfilegenerator", "reconcile"]) {
      expect(
        screen.getByRole("heading", { name: type, level: 3 }),
      ).toBeInTheDocument();
    }
  });

  it("gives each card exactly one Enabled switch, one Save button and one Run now button", async () => {
    await renderReady();
    // Three Enabled switches (one per card). Mantine's Switch exposes
    // role="switch".
    expect(screen.getAllByRole("switch", { name: "Enabled" })).toHaveLength(3);
    // Each card has a single Save button and a single Run now button. There are
    // three Run now buttons and three Save buttons (one per card) — the cleaner
    // card no longer carries a separate log-retention Save.
    expect(screen.getAllByRole("button", { name: "Run now" })).toHaveLength(3);
    expect(screen.getAllByRole("button", { name: "Save" })).toHaveLength(3);
    for (const type of ["cleaner", "peakfilegenerator", "reconcile"]) {
      const card = cardFor(type);
      expect(
        within(card).getByRole("button", { name: "Run now" }),
      ).toBeInTheDocument();
      expect(
        within(card).getAllByRole("button", { name: "Save" }),
      ).toHaveLength(1);
    }
  });

  it("persists both the schedule and the log retention from the single cleaner Save", async () => {
    await renderReady();
    updateSchedule.mockResolvedValue(SCHEDULES[0]);
    setLogRetention.mockResolvedValue({ hours: 48 });

    const cleanerCard = cardFor("cleaner");

    // Change the retention Hours value.
    const hoursInput = within(cleanerCard).getByRole("textbox", {
      name: "Hours",
    });
    fireEvent.change(hoursInput, { target: { value: "48" } });

    // One Save button, one click — both writes fire.
    fireEvent.click(within(cleanerCard).getByRole("button", { name: "Save" }));

    await waitFor(() =>
      expect(updateSchedule).toHaveBeenCalledWith(
        "cleaner",
        expect.any(Object),
      ),
    );
    expect(setLogRetention).toHaveBeenCalledWith(48);
  });

  it("does not persist log retention from the non-cleaner card Saves", async () => {
    await renderReady();
    updateSchedule.mockResolvedValue(SCHEDULES[2]);

    const reconcileCard = cardFor("reconcile");
    fireEvent.click(
      within(reconcileCard).getByRole("button", { name: "Save" }),
    );

    await waitFor(() =>
      expect(updateSchedule).toHaveBeenCalledWith(
        "reconcile",
        expect.any(Object),
      ),
    );
    expect(setLogRetention).not.toHaveBeenCalled();
  });

  it("enqueues a reconcile job when reconcile's Run now is clicked", async () => {
    await renderReady();
    const reconcileCard = cardFor("reconcile");
    const runNow = within(reconcileCard).getByRole("button", {
      name: "Run now",
    });
    fireEvent.click(runNow);
    await waitFor(() => expect(runJobNow).toHaveBeenCalledWith("reconcile"));
  });

  it("renders the log-retention Hours field inside the cleaner card, not as a separate bottom panel", async () => {
    await renderReady();
    // Exactly one Hours input, and it lives inside the cleaner card. Mantine's
    // NumberInput renders a type="text" input, exposed as role="textbox".
    const hoursInputs = screen.getAllByRole("textbox", { name: "Hours" });
    expect(hoursInputs).toHaveLength(1);

    const cleanerCard = cardFor("cleaner");
    expect(
      within(cleanerCard).getByRole("textbox", { name: "Hours" }),
    ).toBeInTheDocument();

    // No standalone "Log retention" panel remains.
    expect(
      screen.queryByRole("heading", { name: "Log retention" }),
    ).not.toBeInTheDocument();

    // The non-cleaner cards carry no Hours field.
    expect(
      within(cardFor("reconcile")).queryByRole("textbox", { name: "Hours" }),
    ).not.toBeInTheDocument();
  });
});
