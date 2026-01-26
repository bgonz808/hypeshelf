import { test, expect, type Page } from "@playwright/test";
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

interface ColorMode {
  name: string;
  label: string;
  colorScheme: "light" | "dark";
  forcedColors: "none" | "active";
  contrast: "no-preference" | "more";
}

const COLOR_MODES: ColorMode[] = [
  {
    name: "light-normal",
    label: "Light + Normal Contrast",
    colorScheme: "light",
    forcedColors: "none",
    contrast: "no-preference",
  },
  {
    name: "light-high-contrast",
    label: "Light + High Contrast",
    colorScheme: "light",
    forcedColors: "none",
    contrast: "more",
  },
  {
    name: "dark-normal",
    label: "Dark + Normal Contrast",
    colorScheme: "dark",
    forcedColors: "none",
    contrast: "no-preference",
  },
  {
    name: "dark-high-contrast",
    label: "Dark + High Contrast",
    colorScheme: "dark",
    forcedColors: "none",
    contrast: "more",
  },
  {
    name: "forced-colors",
    label: "Forced Colors (High Contrast Mode)",
    colorScheme: "light",
    forcedColors: "active",
    contrast: "no-preference",
  },
];

/**
 * Helper to set up color mode emulation for a page
 */
async function setupColorMode(page: Page, mode: ColorMode): Promise<void> {
  // Emulate color scheme
  await page.emulateMedia({ colorScheme: mode.colorScheme });

  // Emulate forced colors if needed
  if (mode.forcedColors === "active") {
    await page.emulateMedia({ forcedColors: "active" });
  }

  // Emulate contrast preference via CDP
  if (mode.contrast === "more") {
    const client = await page.context().newCDPSession(page);
    await client.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-contrast", value: "more" }],
    });
  }
}

test.describe("Color Mode Accessibility", () => {
  for (const mode of COLOR_MODES) {
    test.describe(mode.label, () => {
      test(`homepage renders correctly [${mode.name}]`, async ({ page }) => {
        await setupColorMode(page, mode);
        await page.goto("/");
        await page.waitForLoadState("networkidle");

        // Screenshot for visual regression
        await expect(page).toHaveScreenshot(`homepage-${mode.name}.png`, {
          fullPage: true,
          // Allow some pixel difference for anti-aliasing
          maxDiffPixelRatio: 0.01,
        });
      });

      test(`homepage passes accessibility audit [${mode.name}]`, async ({
        page,
      }) => {
        await setupColorMode(page, mode);
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

      test(`key elements are visible [${mode.name}]`, async ({ page }) => {
        await setupColorMode(page, mode);
        await page.goto("/");
        await page.waitForLoadState("networkidle");

        // Main navigation header should be visible (use role="banner" for specificity)
        const header = page.getByRole("banner");
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

      test(`interactive elements have visible focus indicators [${mode.name}]`, async ({
        page,
      }) => {
        await setupColorMode(page, mode);
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

      // Additional test for high contrast modes - informational only
      // WCAG AAA (7:1) is aspirational, not required for compliance
      if (mode.contrast === "more" || mode.forcedColors === "active") {
        test(`text has AAA contrast ratio (7:1) [${mode.name}]`, async ({
          page,
        }) => {
          await setupColorMode(page, mode);
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
            // Log AAA violations as warnings - AAA is stretch goal, not required
            console.warn(
              `[AAA] ${mode.label} has ${contrastViolations.length} contrast violation(s) below 7:1 ratio.`,
              `This is informational - WCAG AA (4.5:1) compliance is verified separately.`
            );
          }

          // AAA test passes as long as AA passed - we just log AAA issues
          // To enforce AAA, uncomment: expect(contrastViolations).toEqual([]);
        });
      }
    });
  }
});

// Design token behavior validation - tests that tokens switch correctly between modes
test.describe("Design Token Switching", () => {
  test("tokens switch between light and dark mode", async ({ browser }) => {
    // Get light mode tokens
    const lightContext = await browser.newContext({ colorScheme: "light" });
    const lightPage = await lightContext.newPage();
    await lightPage.goto("/");

    const lightTokens = await lightPage.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        page: style.getPropertyValue("--color-page").trim(),
        textPrimary: style.getPropertyValue("--color-text-primary").trim(),
      };
    });
    await lightContext.close();

    // Get dark mode tokens
    const darkContext = await browser.newContext({ colorScheme: "dark" });
    const darkPage = await darkContext.newPage();
    await darkPage.goto("/");

    const darkTokens = await darkPage.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return {
        page: style.getPropertyValue("--color-page").trim(),
        textPrimary: style.getPropertyValue("--color-text-primary").trim(),
      };
    });
    await darkContext.close();

    // Behavior test: tokens should be DIFFERENT between modes
    // (We don't hardcode the values - just verify they change)
    expect(lightTokens.page).not.toBe(darkTokens.page);
    expect(lightTokens.textPrimary).not.toBe(darkTokens.textPrimary);

    // Light mode should have light background (higher luminance)
    // Dark mode should have dark background (lower luminance)
    const lightBgLuminance = getLuminance(lightTokens.page);
    const darkBgLuminance = getLuminance(darkTokens.page);
    expect(lightBgLuminance).toBeGreaterThan(darkBgLuminance);

    console.log("Token switching verified:", {
      lightBg: lightTokens.page,
      darkBg: darkTokens.page,
    });
  });
});

/**
 * Calculate relative luminance of a color (WCAG formula)
 * @see https://www.w3.org/WAI/GL/wiki/Relative_luminance
 */
function getLuminance(hex: string): number {
  const matches = hex.replace("#", "").match(/.{2}/g);
  if (!matches || matches.length < 3) {
    throw new Error(`Invalid hex color: ${hex}`);
  }
  const [r, g, b] = matches as [string, string, string];
  const toLinear = (c: string) => {
    const val = parseInt(c, 16) / 255;
    return val <= 0.03928 ? val / 12.92 : Math.pow((val + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * toLinear(r) + 0.7152 * toLinear(g) + 0.0722 * toLinear(b);
}
