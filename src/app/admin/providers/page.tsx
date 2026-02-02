"use client";

import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { useUser } from "@clerk/nextjs";
import { api } from "../../../../convex/_generated/api";
import { Header } from "@/components";

/** Provider metadata (mirrors registry, but static for client display) */
const PROVIDER_INFO = [
  {
    id: "tmdb",
    name: "TMDB",
    mediaTypes: ["movie", "tv"],
    requiresKey: true,
    keyEnvVar: "TMDB_API_KEY",
  },
  {
    id: "openlibrary",
    name: "Open Library",
    mediaTypes: ["book"],
    requiresKey: false,
  },
  {
    id: "musicbrainz",
    name: "MusicBrainz",
    mediaTypes: ["music"],
    requiresKey: false,
  },
  {
    id: "itunes",
    name: "iTunes Search",
    mediaTypes: ["music", "podcast"],
    requiresKey: false,
  },
  {
    id: "rawg",
    name: "RAWG",
    mediaTypes: ["game"],
    requiresKey: true,
    keyEnvVar: "RAWG_API_KEY",
  },
  {
    id: "bgg",
    name: "BoardGameGeek",
    mediaTypes: ["board-game"],
    requiresKey: false,
  },
] as const;

interface ProviderConfig {
  providerId: string;
  enabled: boolean;
  encryptedKey?: string;
}

export default function AdminProviders() {
  const { isSignedIn, isLoaded } = useUser();
  const configs = useQuery(api.providerConfigs.list);
  const upsertConfig = useMutation(api.providerConfigs.upsert);
  const [saving, setSaving] = useState<string | null>(null);

  const configMap = new Map<string, ProviderConfig>();
  if (configs) {
    for (const c of configs) {
      configMap.set(c.providerId, c);
    }
  }

  const toggleProvider = async (
    providerId: string,
    currentEnabled: boolean
  ) => {
    setSaving(providerId);
    try {
      await upsertConfig({
        providerId,
        enabled: !currentEnabled,
      });
    } catch (err) {
      console.error("Failed to toggle provider:", err);
    } finally {
      setSaving(null);
    }
  };

  const getStatus = (
    provider: (typeof PROVIDER_INFO)[number]
  ): { label: string; color: string } => {
    const config = configMap.get(provider.id);
    const isDisabled = config?.enabled === false;

    if (isDisabled) {
      return { label: "Disabled", color: "text-error" };
    }

    if (!provider.requiresKey) {
      return {
        label: "No key needed",
        color: "text-success",
      };
    }

    // Check if ENV override exists (we can't check from client, show generic)
    if (config?.encryptedKey) {
      return {
        label: "DB configured",
        color: "text-warning",
      };
    }

    return { label: "ENV or unconfigured", color: "text-muted" };
  };

  if (!isLoaded) {
    return (
      <div className="bg-page min-h-screen">
        <Header />
        <main className="mx-auto max-w-4xl px-4 py-8">
          <div className="bg-skeleton h-8 w-64 animate-pulse rounded" />
        </main>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="bg-page min-h-screen">
        <Header />
        <main className="mx-auto max-w-4xl px-4 py-8">
          <p className="text-error">Admin access required.</p>
        </main>
      </div>
    );
  }

  return (
    <div className="bg-page min-h-screen">
      <Header />
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-primary mb-6 text-2xl font-bold">
          Media Search Providers
        </h1>
        <p className="text-secondary mb-8 text-sm">
          Manage which providers are active for autocomplete. ENV variables
          override database keys. Providers without keys are always available
          unless disabled.
        </p>

        <div className="space-y-3">
          {PROVIDER_INFO.map((provider) => {
            const config = configMap.get(provider.id);
            const isEnabled = config?.enabled !== false; // Default enabled
            const status = getStatus(provider);

            return (
              <div
                key={provider.id}
                className="bg-surface border-default flex items-center justify-between rounded-lg border p-4"
              >
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-3">
                    <span className="text-primary font-medium">
                      {provider.name}
                    </span>
                    <span className="text-muted text-xs">
                      [{provider.mediaTypes.join(", ")}]
                    </span>
                  </div>
                  <span className={`text-xs ${status.color}`}>
                    {status.label}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() => toggleProvider(provider.id, isEnabled)}
                  disabled={saving === provider.id}
                  className={`min-h-[44px] min-w-[80px] rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    isEnabled
                      ? "bg-success text-success hover-bg-success"
                      : "bg-error text-error hover-bg-error"
                  } disabled:opacity-50`}
                >
                  {saving === provider.id
                    ? "..."
                    : isEnabled
                      ? "Enabled"
                      : "Disabled"}
                </button>
              </div>
            );
          })}
        </div>

        <div className="text-muted mt-8 space-y-2 text-xs">
          <h2 className="text-secondary text-sm font-medium">Fallback Order</h2>
          <ul className="list-inside list-disc space-y-1">
            <li>Movie: TMDB</li>
            <li>TV: TMDB</li>
            <li>Book: Open Library</li>
            <li>Music: MusicBrainz → iTunes (fallback)</li>
            <li>Podcast: iTunes</li>
            <li>Video Game: RAWG</li>
            <li>Board Game: BoardGameGeek</li>
            <li>Other: no autocomplete</li>
          </ul>
        </div>
      </main>
    </div>
  );
}
