/**
 * Logo Build Script
 *
 * Converts SVG source files to raster formats for various platforms.
 * SVG is treated as source code; PNG/ICO/WebP are build artifacts.
 *
 * Usage:
 *   npm run build:logos           # Build all logo assets
 *   npm run build:logos:watch     # Watch for changes
 *
 * Output:
 *   public/logos/          # Web-ready assets
 *   public/favicon.ico     # Browser favicon
 */

import sharp from "sharp";
import pngToIco from "png-to-ico";
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  readdirSync,
} from "fs";
import { join, basename } from "path";

// Configuration
const CONFIG = {
  // Source directories
  sourceDir: "docs/design/logos/round-2",

  // Output directories
  outputDir: "public/logos",
  faviconOutput: "public",

  // Which SVGs to process
  mainLogo: "bucket-shades-horizontal-v3-glow.svg",
  favicon: "favicon-16-int-3slat.svg",

  // Output sizes for main logo
  logoSizes: [64, 128, 256, 512],

  // Favicon sizes (ICO will contain all of these)
  faviconSizes: [16, 32, 48],

  // Formats to generate
  formats: ["png", "webp"] as const,
};

async function ensureDir(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
    console.log(`📁 Created directory: ${dir}`);
  }
}

async function svgToPng(
  svgPath: string,
  outputPath: string,
  size: number
): Promise<void> {
  const svgBuffer = readFileSync(svgPath);

  await sharp(svgBuffer)
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .png()
    .toFile(outputPath);
}

async function svgToWebp(
  svgPath: string,
  outputPath: string,
  size: number
): Promise<void> {
  const svgBuffer = readFileSync(svgPath);

  await sharp(svgBuffer)
    .resize(size, size, {
      fit: "contain",
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    })
    .webp({ quality: 90 })
    .toFile(outputPath);
}

async function buildMainLogo(): Promise<void> {
  const svgPath = join(CONFIG.sourceDir, CONFIG.mainLogo);

  if (!existsSync(svgPath)) {
    console.error(`❌ Main logo not found: ${svgPath}`);
    return;
  }

  console.log(`\n🎨 Building main logo from: ${CONFIG.mainLogo}`);

  for (const size of CONFIG.logoSizes) {
    for (const format of CONFIG.formats) {
      const outputName = `logo-${size}.${format}`;
      const outputPath = join(CONFIG.outputDir, outputName);

      if (format === "png") {
        await svgToPng(svgPath, outputPath, size);
      } else if (format === "webp") {
        await svgToWebp(svgPath, outputPath, size);
      }

      console.log(`  ✓ ${outputName}`);
    }
  }
}

async function buildFavicon(): Promise<void> {
  const svgPath = join(CONFIG.sourceDir, CONFIG.favicon);

  if (!existsSync(svgPath)) {
    console.error(`❌ Favicon source not found: ${svgPath}`);
    return;
  }

  console.log(`\n🔷 Building favicon from: ${CONFIG.favicon}`);

  // Generate PNGs at each size (needed for ICO)
  const pngBuffers: Buffer[] = [];

  for (const size of CONFIG.faviconSizes) {
    const svgBuffer = readFileSync(svgPath);
    const pngBuffer = await sharp(svgBuffer)
      .resize(size, size, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    pngBuffers.push(pngBuffer);

    // Also save individual PNGs for apple-touch-icon etc.
    const pngPath = join(CONFIG.outputDir, `favicon-${size}.png`);
    writeFileSync(pngPath, pngBuffer);
    console.log(`  ✓ favicon-${size}.png`);
  }

  // Generate larger sizes for apple-touch-icon
  const appleSizes = [180, 192, 512];
  for (const size of appleSizes) {
    const svgBuffer = readFileSync(svgPath);
    const pngBuffer = await sharp(svgBuffer)
      .resize(size, size, {
        fit: "contain",
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      })
      .png()
      .toBuffer();

    const pngPath = join(CONFIG.outputDir, `favicon-${size}.png`);
    writeFileSync(pngPath, pngBuffer);
    console.log(`  ✓ favicon-${size}.png (apple-touch-icon)`);
  }

  // Generate ICO from the PNG buffers
  try {
    const icoBuffer = await pngToIco(pngBuffers);
    const icoPath = join(CONFIG.faviconOutput, "favicon.ico");
    writeFileSync(icoPath, icoBuffer);
    console.log(
      `  ✓ favicon.ico (contains ${CONFIG.faviconSizes.join(", ")}px)`
    );
  } catch (err) {
    console.error(`  ❌ Failed to generate ICO:`, err);
  }
}

async function copySourceSvgs(): Promise<void> {
  console.log(`\n📋 Copying source SVGs to public...`);

  // Copy main logo SVG
  const mainSvgSrc = join(CONFIG.sourceDir, CONFIG.mainLogo);
  const mainSvgDest = join(CONFIG.outputDir, "logo.svg");
  if (existsSync(mainSvgSrc)) {
    writeFileSync(mainSvgDest, readFileSync(mainSvgSrc));
    console.log(`  ✓ logo.svg`);
  }

  // Copy favicon SVG
  const favSvgSrc = join(CONFIG.sourceDir, CONFIG.favicon);
  const favSvgDest = join(CONFIG.outputDir, "favicon.svg");
  if (existsSync(favSvgSrc)) {
    writeFileSync(favSvgDest, readFileSync(favSvgSrc));
    console.log(`  ✓ favicon.svg`);
  }
}

async function generateManifestSnippet(): Promise<void> {
  console.log(`\n📝 Generating manifest snippet...`);

  const manifest = {
    icons: [
      { src: "/logos/favicon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/logos/favicon-512.png", sizes: "512x512", type: "image/png" },
    ],
  };

  const snippetPath = join(CONFIG.outputDir, "manifest-icons.json");
  writeFileSync(snippetPath, JSON.stringify(manifest, null, 2));
  console.log(`  ✓ manifest-icons.json (copy to your web manifest)`);
}

async function main(): Promise<void> {
  console.log("🚀 HypeShelf Logo Builder");
  console.log("=".repeat(40));

  await ensureDir(CONFIG.outputDir);

  await buildMainLogo();
  await buildFavicon();
  await copySourceSvgs();
  await generateManifestSnippet();

  console.log("\n✅ Logo build complete!");
  console.log(`\nOutput directory: ${CONFIG.outputDir}`);
  console.log(`Favicon: ${CONFIG.faviconOutput}/favicon.ico`);

  // Summary
  console.log("\n📦 Generated assets:");
  if (existsSync(CONFIG.outputDir)) {
    const files = readdirSync(CONFIG.outputDir);
    files.forEach((f) => console.log(`  - ${f}`));
  }
}

main().catch(console.error);
