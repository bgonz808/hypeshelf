import type { Config } from "tailwindcss";
import plugin from "tailwindcss/plugin";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  // Enable RTL support via dir attribute on html element
  // Usage: class="rtl:ml-4 ltr:mr-4" or use CSS logical properties
  darkMode: "media",
  theme: {
    extend: {
      colors: {
        // HypeShelf brand colors - can be customized
        brand: {
          50: "#faf5ff",
          100: "#f3e8ff",
          200: "#e9d5ff",
          300: "#d8b4fe",
          400: "#c084fc",
          500: "#a855f7",
          600: "#9333ea",
          700: "#7e22ce",
          800: "#6b21a8",
          900: "#581c87",
          950: "#3b0764",
        },
        // Dark mode deep purple theme (Prince-inspired)
        // All colors tested for WCAG AA contrast compliance
        "dark-bg": {
          DEFAULT: "#1a0a2e", // Deep purple - 18.64:1 with white
          secondary: "#2d1b4e", // Royal purple - 15.24:1 with white
          tertiary: "#3b0764", // brand-950
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [
    // Accessibility variants for high contrast mode support
    plugin(function ({ addVariant }) {
      // prefers-contrast: more - user wants higher contrast
      addVariant("contrast-more", "@media (prefers-contrast: more)");
      // forced-colors: active - Windows High Contrast Mode
      addVariant("forced-colors", "@media (forced-colors: active)");
    }),
  ],
};

export default config;
