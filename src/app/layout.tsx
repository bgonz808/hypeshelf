import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "HypeShelf - Share What You're Hyped About",
  description:
    "Collect and share the stuff you're hyped about with friends. Movies, shows, books, and more.",
  keywords: ["recommendations", "movies", "sharing", "friends", "social"],
  // PWA and mobile optimization
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "HypeShelf",
  },
  formatDetection: {
    telephone: false, // Prevent auto-linking phone numbers
  },
};

// Viewport configuration for responsive design
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 5, // Allow zoom for accessibility
  userScalable: true, // Never disable zoom - accessibility requirement
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Note: dir attribute will be set dynamically by next-intl based on locale
  return (
    <html lang="en" className={inter.variable}>
      <body className="min-h-screen bg-white font-sans antialiased">
        {children}
      </body>
    </html>
  );
}
