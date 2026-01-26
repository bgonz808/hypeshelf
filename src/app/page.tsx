"use client";

import {
  Header,
  StaffPicksSection,
  HotSection,
  LatestSection,
} from "@/components";

export default function Home() {
  return (
    <div className="bg-page min-h-screen">
      <Header />
      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <StaffPicksSection />
        <HotSection />
        <LatestSection />
      </main>
    </div>
  );
}
