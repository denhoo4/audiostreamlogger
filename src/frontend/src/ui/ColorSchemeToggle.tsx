import {
  Center,
  SegmentedControl,
  Tooltip,
  useMantineColorScheme,
  VisuallyHidden,
} from "@mantine/core";
import {
  IconDeviceDesktop,
  IconMoon,
  IconSun,
} from "@tabler/icons-react";

/**
 * A compact 3-option color-scheme control for the app header: System / Light /
 * Dark. It reads the active preference with `useMantineColorScheme()` and sets
 * it with `setColorScheme('auto' | 'light' | 'dark')`:
 *   - System ('auto') follows the device's prefers-color-scheme and returns the
 *     app to live-following the OS setting.
 *   - Light / Dark pin the scheme.
 * Mantine's provider persists the choice in localStorage, so no extra wiring is
 * needed.
 *
 * Accessibility: each option carries an icon plus a visually-hidden text label
 * ("System"/"Light"/"Dark") so the control is labelled for assistive tech, and
 * a Tooltip gives a sighted hover hint.
 */
export function ColorSchemeToggle() {
  const { colorScheme, setColorScheme } = useMantineColorScheme();

  return (
    <SegmentedControl
      size="xs"
      value={colorScheme}
      onChange={(value) =>
        setColorScheme(value as "auto" | "light" | "dark")
      }
      aria-label="Color scheme"
      data={[
        {
          value: "auto",
          label: (
            <Tooltip label="System" withArrow>
              <Center>
                <IconDeviceDesktop size={16} aria-hidden />
                <VisuallyHidden>System</VisuallyHidden>
              </Center>
            </Tooltip>
          ),
        },
        {
          value: "light",
          label: (
            <Tooltip label="Light" withArrow>
              <Center>
                <IconSun size={16} aria-hidden />
                <VisuallyHidden>Light</VisuallyHidden>
              </Center>
            </Tooltip>
          ),
        },
        {
          value: "dark",
          label: (
            <Tooltip label="Dark" withArrow>
              <Center>
                <IconMoon size={16} aria-hidden />
                <VisuallyHidden>Dark</VisuallyHidden>
              </Center>
            </Tooltip>
          ),
        },
      ]}
    />
  );
}
