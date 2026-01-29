"use client";

import { SignInButton, SignUpButton, UserButton, useUser } from "@clerk/nextjs";
import { useTranslations } from "next-intl";
import Image from "next/image";
import Link from "next/link";

export function Header() {
  const { isSignedIn, isLoaded } = useUser();
  const tAuth = useTranslations("auth");
  const tRec = useTranslations("recommendations");

  return (
    <header className="bg-surface/80 border-muted sticky top-0 z-50 border-b backdrop-blur-xs">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
        {/* Logo */}
        <Link
          href="/"
          className="text-primary flex items-center gap-2 text-xl font-bold"
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
            <div className="bg-skeleton h-8 w-20 animate-pulse rounded-sm" />
          ) : isSignedIn ? (
            <>
              <Link
                href="/add"
                className="bg-accent text-on-accent hover-bg-accent rounded-full px-4 py-2 text-sm font-medium transition-colors"
              >
                {tRec("addShort")}
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
                <button className="bg-surface text-accent text-sm font-medium">
                  {tAuth("signIn")}
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button className="bg-accent text-on-accent hover-bg-accent rounded-full px-4 py-2 text-sm font-medium transition-colors">
                  {tAuth("signUp")}
                </button>
              </SignUpButton>
            </>
          )}
        </nav>
      </div>
    </header>
  );
}
