"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMutation } from "convex/react";
import { useUser } from "@clerk/nextjs";
import { api } from "../../../convex/_generated/api";
import { Header } from "@/components";

const MEDIA_TYPES = [
  { value: "movie", label: "Movie" },
  { value: "tv", label: "TV Show" },
  { value: "book", label: "Book" },
  { value: "music", label: "Music" },
  { value: "podcast", label: "Podcast" },
  { value: "game", label: "Game" },
  { value: "other", label: "Other" },
] as const;

const GENRES = [
  { value: "drama", label: "Drama" },
  { value: "comedy", label: "Comedy" },
  { value: "romance", label: "Romance" },
  { value: "thriller", label: "Thriller" },
  { value: "horror", label: "Horror" },
  { value: "action", label: "Action" },
  { value: "adventure", label: "Adventure" },
  { value: "sci-fi", label: "Sci-Fi" },
  { value: "fantasy", label: "Fantasy" },
  { value: "mystery", label: "Mystery" },
  { value: "documentary", label: "Documentary" },
  { value: "biography", label: "Biography" },
  { value: "history", label: "History" },
  { value: "true-crime", label: "True Crime" },
  { value: "animation", label: "Animation" },
  { value: "kids", label: "Kids" },
  { value: "indie", label: "Indie" },
  { value: "other", label: "Other" },
] as const;

type MediaType = (typeof MEDIA_TYPES)[number]["value"];
type Genre = (typeof GENRES)[number]["value"];

export default function AddRecommendation() {
  const router = useRouter();
  const { isSignedIn, isLoaded } = useUser();
  const createRecommendation = useMutation(api.recommendations.create);

  const [title, setTitle] = useState("");
  const [mediaType, setMediaType] = useState<MediaType>("movie");
  const [genre, setGenre] = useState<Genre | "">("");
  const [link, setLink] = useState("");
  const [blurb, setBlurb] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!isSignedIn) {
      setError("You must be signed in to add a recommendation");
      return;
    }

    if (!title.trim()) {
      setError("Title is required");
      return;
    }

    if (!link.trim()) {
      setError("Link is required");
      return;
    }

    if (!blurb.trim()) {
      setError("Tell us why you're recommending this");
      return;
    }

    try {
      new URL(link);
    } catch {
      setError("Please enter a valid URL");
      return;
    }

    setIsSubmitting(true);

    try {
      await createRecommendation({
        title: title.trim(),
        mediaType,
        genre: genre || undefined,
        link: link.trim(),
        blurb: blurb.trim(),
      });
      router.push("/");
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create recommendation"
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (!isLoaded) {
    return (
      <div className="bg-page min-h-screen">
        <Header />
        <main className="mx-auto max-w-2xl px-4 py-8">
          <div className="animate-pulse">
            <div className="bg-skeleton mb-8 h-8 w-48 rounded-sm" />
            <div className="space-y-4">
              <div className="bg-skeleton h-10 rounded-sm" />
              <div className="bg-skeleton h-10 rounded-sm" />
              <div className="bg-skeleton h-32 rounded-sm" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="bg-page min-h-screen">
        <Header />
        <main className="mx-auto max-w-2xl px-4 py-8">
          <div className="bg-warning border-warning rounded-lg border p-6 text-center">
            <h2 className="text-warning mb-2 text-lg font-semibold">
              Sign in Required
            </h2>
            <p className="text-warning">
              You need to sign in to add a recommendation.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="bg-page min-h-screen">
      <Header />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-primary mb-8 text-2xl font-bold">
          Add a Recommendation
        </h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="bg-error border-error text-error rounded-lg border p-4">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="title"
              className="text-secondary mb-1 block text-sm font-medium"
            >
              Title <span className="text-error">*</span>
            </label>
            <input
              type="text"
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              className="bg-input border-input ring-accent placeholder-muted focus:border-accent w-full rounded-lg border px-4 py-2 focus:ring-1 focus:outline-hidden"
              placeholder="What are you recommending?"
            />
            <p className="text-muted mt-1 text-xs">
              {title.length}/200 characters
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="mediaType"
                className="text-secondary mb-1 block text-sm font-medium"
              >
                Media Type <span className="text-error">*</span>
              </label>
              <select
                id="mediaType"
                value={mediaType}
                onChange={(e) => setMediaType(e.target.value as MediaType)}
                className="bg-input border-input ring-accent focus:border-accent w-full rounded-lg border px-4 py-2 focus:ring-1 focus:outline-hidden"
              >
                {MEDIA_TYPES.map((type) => (
                  <option key={type.value} value={type.value}>
                    {type.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label
                htmlFor="genre"
                className="text-secondary mb-1 block text-sm font-medium"
              >
                Genre
              </label>
              <select
                id="genre"
                value={genre}
                onChange={(e) => setGenre(e.target.value as Genre | "")}
                className="bg-input border-input ring-accent focus:border-accent w-full rounded-lg border px-4 py-2 focus:ring-1 focus:outline-hidden"
              >
                <option value="" className="text-muted">
                  Select a genre (optional)
                </option>
                {GENRES.map((g) => (
                  <option key={g.value} value={g.value}>
                    {g.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div>
            <label
              htmlFor="link"
              className="text-secondary mb-1 block text-sm font-medium"
            >
              Link <span className="text-error">*</span>
            </label>
            <input
              type="url"
              id="link"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              className="bg-input border-input ring-accent placeholder-muted focus:border-accent w-full rounded-lg border px-4 py-2 focus:ring-1 focus:outline-hidden"
              placeholder="https://..."
            />
            <p className="text-muted mt-1 text-xs">
              Link to where people can find this
            </p>
          </div>

          <div>
            <label
              htmlFor="blurb"
              className="text-secondary mb-1 block text-sm font-medium"
            >
              Why do you recommend this? <span className="text-error">*</span>
            </label>
            <textarea
              id="blurb"
              value={blurb}
              onChange={(e) => setBlurb(e.target.value)}
              maxLength={500}
              rows={4}
              className="bg-input border-input ring-accent placeholder-muted focus:border-accent w-full resize-none rounded-lg border px-4 py-2 focus:ring-1 focus:outline-hidden"
              placeholder="Share why others should check this out..."
            />
            <p className="text-muted mt-1 text-xs">
              {blurb.length}/500 characters
            </p>
          </div>

          <div className="flex gap-4">
            <button
              type="button"
              onClick={() => router.back()}
              className="bg-surface border-default text-secondary hover-bg-surface-secondary flex-1 rounded-lg border px-4 py-2"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="bg-accent text-on-accent hover-bg-accent flex-1 rounded-lg px-4 py-2 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? "Adding..." : "Add Recommendation"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
