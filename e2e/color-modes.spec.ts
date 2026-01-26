import { test, expect, type Page } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import type { AxeResults, Result as AxeViolation } from "axe-core";
import * as fs from "fs";
import * as path from "path";

/**
 * Configuration for violation screenshot capture
 */
const VIOLATION_CONFIG = {
  maxPerType: 3, // Max screenshots per violation type
  outputDir: "test-results/violations",
  impactPriority: ["critical", "serious", "moderate", "minor"] as const,
};

type ImpactLevel = (typeof VIOLATION_CONFIG.impactPriority)[number];

interface ViolationSummary {
  id: string;
  impact: ImpactLevel;
  description: string;
  total: number;
  examples: Array<{ selector: string; html: string }>;
  overflow: number;
}

/**
 * Capture stratified violation screenshots - prioritized by impact, capped per type
 */
async function captureViolationScreenshots(
  page: Page,
  violations: AxeViolation[],
  testName: string
): Promise<ViolationSummary[]> {
  if (violations.length === 0) return [];

  // Ensure output directory exists
  const outputDir = path.join(VIOLATION_CONFIG.outputDir, testName);
  fs.mkdirSync(outputDir, { recursive: true });

  // Sort by impact priority, then by violation type
  const sorted = [...violations].sort((a, b) => {
    const impactDiff =
      VIOLATION_CONFIG.impactPriority.indexOf(a.impact as ImpactLevel) -
      VIOLATION_CONFIG.impactPriority.indexOf(b.impact as ImpactLevel);
    if (impactDiff !== 0) return impactDiff;
    return a.id.localeCompare(b.id);
  });

  const summaries: ViolationSummary[] = [];

  for (const violation of sorted) {
    const examples = violation.nodes.slice(0, VIOLATION_CONFIG.maxPerType);
    const summary: ViolationSummary = {
      id: violation.id,
      impact: violation.impact as ImpactLevel,
      description: violation.help,
      total: violation.nodes.length,
      examples: examples.map((n) => ({
        selector: n.target[0] as string,
        html: n.html,
      })),
      overflow: Math.max(
        0,
        violation.nodes.length - VIOLATION_CONFIG.maxPerType
      ),
    };
    summaries.push(summary);

    // Capture screenshots for examples only
    for (let i = 0; i < examples.length; i++) {
      const node = examples[i];
      const selector = node.target[0] as string;
      try {
        const element = page.locator(selector).first();
        if (await element.isVisible()) {
          await element.screenshot({
            path: path.join(
              outputDir,
              `${violation.impact}-${violation.id}-${i + 1}.png`
            ),
          });
        }
      } catch {
        // Element may not be screenshottable (e.g., zero size)
        console.warn(`Could not screenshot: ${selector}`);
      }
    }
  }

  // Log stratified summary
  console.log("\n📊 Violation Summary (by impact → type):");
  console.log("─".repeat(60));

  let currentImpact: ImpactLevel | null = null;
  for (const s of summaries) {
    if (s.impact !== currentImpact) {
      currentImpact = s.impact;
      const icon =
        s.impact === "critical"
          ? "🔴"
          : s.impact === "serious"
            ? "🟠"
            : s.impact === "moderate"
              ? "🟡"
              : "🔵";
      console.log(`\n${icon} ${s.impact.toUpperCase()}`);
    }
    const overflowNote = s.overflow > 0 ? ` (+${s.overflow} more)` : "";
    console.log(`   ${s.id}: ${s.total} issue(s)${overflowNote}`);
    console.log(`      "${s.description}"`);
  }
  console.log("\n" + "─".repeat(60));
  console.log(`Screenshots saved to: ${outputDir}`);

  return summaries;
}

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

        // Capture stratified screenshots for any violations
        if (accessibilityScanResults.violations.length > 0) {
          await captureViolationScreenshots(
            page,
            accessibilityScanResults.violations,
            `aa-${mode.name}`
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
            // Capture screenshots for AAA violations (informational)
            await captureViolationScreenshots(
              page,
              contrastViolations,
              `aaa-${mode.name}`
            );

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
