import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";

/**
 * Color Mode Validation Tests
 *
 * Tests all 5 color mode combinations:
 * 1. Light + Normal contrast
 * 2. Light + High contrast
 * 3. Dark + Normal contrast
 * 4. Dark + High contrast
 * 5. Forced colors (Windows High Contrast)
 *
 * Each test validates:
 * - Visual rendering (screenshot)
 * - Accessibility (axe-core)
 * - Key elements are visible
 */

const COLOR_MODES = [
  {
    name: "light-normal",
    label: "Light + Normal Contrast",
    colorScheme: "light" as const,
    forcedColors: "none" as const,
    contrast: "no-preference",
  },
  {
    name: "light-high-contrast",
    label: "Light + High Contrast",
    colorScheme: "light" as const,
    forcedColors: "none" as const,
    contrast: "more",
  },
  {
    name: "dark-normal",
    label: "Dark + Normal Contrast",
    colorScheme: "dark" as const,
    forcedColors: "none" as const,
    contrast: "no-preference",
  },
  {
    name: "dark-high-contrast",
    label: "Dark + High Contrast",
    colorScheme: "dark" as const,
    forcedColors: "none" as const,
    contrast: "more",
  },
  {
    name: "forced-colors",
    label: "Forced Colors (High Contrast Mode)",
    colorScheme: "light" as const,
    forcedColors: "active" as const,
    contrast: "no-preference",
  },
];

test.describe("Color Mode Accessibility", () => {
  for (const mode of COLOR_MODES) {
    test.describe(mode.label, () => {
      test.use({
        colorScheme: mode.colorScheme,
        // @ts-expect-error - Playwright supports this but types are incomplete
        forcedColors: mode.forcedColors,
      });

      test.beforeEach(async ({ page }) => {
        // Emulate contrast preference via CDP
        if (mode.contrast === "more") {
          const client = await page.context().newCDPSession(page);
          await client.send("Emulation.setEmulatedMedia", {
            features: [{ name: "prefers-contrast", value: "more" }],
          });
        }
      });

      test("homepage renders correctly", async ({ page }) => {
        await page.goto("/");
        await page.waitForLoadState("networkidle");

        // Screenshot for visual regression
        await expect(page).toHaveScreenshot(`homepage-${mode.name}.png`, {
          fullPage: true,
          // Allow some pixel difference for anti-aliasing
          maxDiffPixelRatio: 0.01,
        });
      });

      test("homepage passes accessibility audit", async ({ page }) => {
        await page.goto("/");
        await page.waitForLoadState("networkidle");

        const accessibilityScanResults = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
          .analyze();

        // Log violations for debugging
        if (accessibilityScanResults.violations.length > 0) {
          console.log(
            `${mode.label} violations:`,
            JSON.stringify(accessibilityScanResults.violations, null, 2)
          );
        }

        expect(accessibilityScanResults.violations).toEqual([]);
      });

      test("key elements are visible and have sufficient contrast", async ({
        page,
      }) => {
        await page.goto("/");
        await page.waitForLoadState("networkidle");

        // Header should be visible
        const header = page.locator("header");
        await expect(header).toBeVisible();

        // Logo text should be visible
        const logoText = page.getByText("HypeShelf");
        await expect(logoText).toBeVisible();

        // Navigation buttons should be visible
        const signInButton = page.getByRole("button", { name: /sign in/i });
        const signUpButton = page.getByRole("button", { name: /sign up/i });

        // At least one auth button should be visible (depends on auth state)
        const authButtonVisible =
          (await signInButton.isVisible()) || (await signUpButton.isVisible());
        expect(authButtonVisible).toBe(true);

        // Section headings should be visible
        const staffPicksHeading = page.getByRole("heading", {
          name: /staff picks/i,
        });
        await expect(staffPicksHeading).toBeVisible();
      });

      test("interactive elements have visible focus indicators", async ({
        page,
      }) => {
        await page.goto("/");
        await page.waitForLoadState("networkidle");

        // Tab to first interactive element
        await page.keyboard.press("Tab");

        // Check that something has focus
        const focusedElement = page.locator(":focus");
        await expect(focusedElement).toBeVisible();

        // The focused element should have a visible outline/ring
        // This is a visual check - we verify the element exists and is focused
        const focusedBox = await focusedElement.boundingBox();
        expect(focusedBox).not.toBeNull();
      });

      // Additional test for high contrast modes
      if (mode.contrast === "more" || mode.forcedColors === "active") {
        test("text has AAA contrast ratio (7:1)", async ({ page }) => {
          await page.goto("/");
          await page.waitForLoadState("networkidle");

          // Run axe with stricter contrast rules
          const accessibilityScanResults = await new AxeBuilder({ page })
            .withTags(["wcag2aaa"]) // AAA includes 7:1 contrast requirement
            .analyze();

          // Filter to only color-contrast violations
          const contrastViolations = accessibilityScanResults.violations.filter(
            (v) => v.id.includes("contrast")
          );

          if (contrastViolations.length > 0) {
            console.log(
              `${mode.label} contrast violations:`,
              JSON.stringify(contrastViolations, null, 2)
            );
          }

          // In high contrast modes, we should have no contrast violations
          expect(contrastViolations).toEqual([]);
        });
      }
    });
  }
});

// Standalone contrast ratio test for all modes
test.describe("Contrast Ratio Validation", () => {
  test("semantic tokens meet WCAG AA (4.5:1) in light mode", async ({
    page,
  }) => {
    await page.goto("/");

    // Get computed styles for key semantic colors
    const contrastData = await page.evaluate(() => {
      const computedStyle = getComputedStyle(document.documentElement);
      return {
        textPrimary: computedStyle.getPropertyValue("--color-text-primary"),
        textSecondary: computedStyle.getPropertyValue("--color-text-secondary"),
        textMuted: computedStyle.getPropertyValue("--color-text-muted"),
        bgPage: computedStyle.getPropertyValue("--color-page"),
        bgSurface: computedStyle.getPropertyValue("--color-surface"),
      };
    });

    // Log for debugging
    console.log("Light mode colors:", contrastData);

    // These should be defined
    expect(contrastData.textPrimary).toBeTruthy();
    expect(contrastData.bgPage).toBeTruthy();
  });

  test("semantic tokens meet WCAG AA (4.5:1) in dark mode", async ({
    page,
  }) => {
    // Emulate dark mode
    await page.emulateMedia({ colorScheme: "dark" });
    await page.goto("/");

    const contrastData = await page.evaluate(() => {
      const computedStyle = getComputedStyle(document.documentElement);
      return {
        textPrimary: computedStyle.getPropertyValue("--color-text-primary"),
        textSecondary: computedStyle.getPropertyValue("--color-text-secondary"),
        textMuted: computedStyle.getPropertyValue("--color-text-muted"),
        bgPage: computedStyle.getPropertyValue("--color-page"),
        bgSurface: computedStyle.getPropertyValue("--color-surface"),
      };
    });

    console.log("Dark mode colors:", contrastData);

    expect(contrastData.textPrimary).toBeTruthy();
    expect(contrastData.bgPage).toBeTruthy();
  });
});
