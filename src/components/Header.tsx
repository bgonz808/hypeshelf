"use client";

import { SignInButton, SignUpButton, UserButton, useUser } from "@clerk/nextjs";
import Image from "next/image";
import Link from "next/link";

export function Header() {
  const { isSignedIn, isLoaded } = useUser();

  return (
    <header className="sticky top-0 z-50 border-b border-brand-200 bg-white/80 backdrop-blur-sm dark:border-brand-900 dark:bg-dark-bg/80">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        {/* Logo */}
        <Link
          href="/"
          className="flex items-center gap-2 text-xl font-bold text-brand-900 dark:text-brand-100"
        >
          <Image
            src="/logos/logo-64.png"
            alt=""
            width={32}
            height={32}
            className="h-8 w-8"
            priority
          />
          HypeShelf
        </Link>

        {/* Navigation */}
        <nav className="flex items-center gap-4">
          {!isLoaded ? (
            <div className="h-8 w-20 animate-pulse rounded bg-gray-200" />
          ) : isSignedIn ? (
            <>
              <Link
                href="/add"
                className="rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 dark:bg-brand-400 dark:text-dark-bg dark:hover:bg-brand-300"
              >
                Add Rec
              </Link>
              <UserButton
                afterSignOutUrl="/"
                appearance={{
                  elements: {
                    avatarBox: "h-9 w-9",
                  },
                }}
              />
            </>
          ) : (
            <>
              <SignInButton mode="modal">
                <button className="text-sm font-medium text-brand-700 hover:text-brand-900 dark:text-brand-200 dark:hover:text-white">
                  Sign In
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button className="rounded-full bg-brand-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-brand-700 dark:bg-brand-400 dark:text-dark-bg dark:hover:bg-brand-300">
                  Sign Up
                </button>
              </SignUpButton>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
