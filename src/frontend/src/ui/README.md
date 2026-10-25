# Shared UI layer (`src/ui/`)

The house component layer for the admin UI, built on Mantine in the AI-Studio
style. As of Phase 3.5 the UI is **scheme-aware**: it follows the device
light/dark setting (`auto`) and the header `ColorSchemeToggle` lets the user
override. Dark remains the design anchor and is visually unchanged; a matching
light theme was added. It is intentionally **thin**: we prefer using Mantine
directly with the theme defaults (see `src/theme.ts`) over wrappers that add
nothing. The pieces that live here earn their keep:

- **`StatusBadge`** — the single place the status→colour mapping lives, so every
  coloured status pill across screens stays consistent. Uses named Mantine
  colours + `variant="light"`, which are scheme-aware out of the box.
- **`Panel`** — the house "surface" (a themed `Card`) so every screen gets one
  panel vocabulary. Its surface colour flips per scheme via `Panel.module.css`
  (`light-dark()`).
- **`ColorSchemeToggle`** — the header control (System/Light/Dark) that sets the
  Mantine color scheme; `System` returns to following the device.

Everything else is used **directly from Mantine** with the house conventions
below. Colours come only from theme tokens; never introduce new hex. Scheme-aware
custom surface colours go in a **CSS Module** using `light-dark(light, dark)`
(resolved by `postcss-preset-mantine`) — not in a React inline `style`, which
PostCSS does not process.

## House conventions (use Mantine directly)

### Buttons

- **Primary** action: `<Button variant="filled">` (uses the theme primary,
  `aiBlue`).
- **Secondary** / neutral action: `<Button variant="default">`.
- **Danger** / destructive action: `<Button color="red">` (or
  `color="red" variant="light"` for a lighter in-row danger action).
- Non-submit buttons inside a `<form>` must set `type="button"` so they never
  submit (e.g. the URL "Test" button).

### Form fields

- Text entry: `<TextInput label="…">`.
- Choice from a fixed list: `<NativeSelect label="…" data={…}>`. We use
  `NativeSelect` (a real `<select>` → `role="combobox"`), **not** Mantine's
  `Select` combobox, so native change events and accessible-name queries stay
  simple and stable.
- Always give a field a `label` so it has an accessible name.

### Table

- Use Mantine `<Table>` (renders a real semantic `<table>`). Group rows with one
  `<Table.Tbody>` per group and a group-header row when sections are needed.

### Surfaces

- Wrap a screen's content in `<Panel>` (from this layer) for the standard
  scheme-aware surface (white in light, `dark-6` in dark).

### Alerts (inline feedback)

- Error: `<Alert color="red">` (keep `role="alert"` where tests/AT rely on it).
- Warning / advisory: `<Alert color="yellow">`.
- Status / neutral info: `<Alert>` with a `role="status"` live region where the
  result updates in place (e.g. the URL reachability result).

### Confirms

- Destructive confirmations use a Mantine `<Modal>` (e.g. the typed-folder
  delete confirm).

### Notifications

- `@mantine/notifications` (toasts) is **intentionally NOT wired** in this phase.
  Current screens surface all feedback **inline** (Alerts / status regions) and
  the tests assert that inline text; moving to toasts would be an un-requested UX
  change and would force a lockfile regen for no behavioural benefit. If a later
  phase wants toasts, add the dependency then.
