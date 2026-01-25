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
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="mx-auto max-w-2xl px-4 py-8">
          <div className="animate-pulse">
            <div className="mb-8 h-8 w-48 rounded-sm bg-gray-200" />
            <div className="space-y-4">
              <div className="h-10 rounded-sm bg-gray-200" />
              <div className="h-10 rounded-sm bg-gray-200" />
              <div className="h-32 rounded-sm bg-gray-200" />
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="min-h-screen bg-gray-50">
        <Header />
        <main className="mx-auto max-w-2xl px-4 py-8">
          <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-6 text-center">
            <h2 className="mb-2 text-lg font-semibold text-yellow-800">
              Sign in Required
            </h2>
            <p className="text-yellow-700">
              You need to sign in to add a recommendation.
            </p>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Header />
      <main className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="mb-8 text-2xl font-bold text-gray-900">
          Add a Recommendation
        </h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          {error && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-4 text-red-700">
              {error}
            </div>
          )}

          <div>
            <label
              htmlFor="title"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Title <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              id="title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              maxLength={200}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
              placeholder="What are you recommending?"
            />
            <p className="mt-1 text-xs text-gray-500">
              {title.length}/200 characters
            </p>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label
                htmlFor="mediaType"
                className="mb-1 block text-sm font-medium text-gray-700"
              >
                Media Type <span className="text-red-500">*</span>
              </label>
              <select
                id="mediaType"
                value={mediaType}
                onChange={(e) => setMediaType(e.target.value as MediaType)}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
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
                className="mb-1 block text-sm font-medium text-gray-700"
              >
                Genre
              </label>
              <select
                id="genre"
                value={genre}
                onChange={(e) => setGenre(e.target.value as Genre | "")}
                className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
              >
                <option value="">Select a genre (optional)</option>
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
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Link <span className="text-red-500">*</span>
            </label>
            <input
              type="url"
              id="link"
              value={link}
              onChange={(e) => setLink(e.target.value)}
              className="w-full rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
              placeholder="https://..."
            />
            <p className="mt-1 text-xs text-gray-500">
              Link to where people can find this
            </p>
          </div>

          <div>
            <label
              htmlFor="blurb"
              className="mb-1 block text-sm font-medium text-gray-700"
            >
              Why do you recommend this? <span className="text-red-500">*</span>
            </label>
            <textarea
              id="blurb"
              value={blurb}
              onChange={(e) => setBlurb(e.target.value)}
              maxLength={500}
              rows={4}
              className="w-full resize-none rounded-lg border border-gray-300 px-4 py-2 focus:border-blue-500 focus:ring-1 focus:ring-blue-500 focus:outline-hidden"
              placeholder="Share why others should check this out..."
            />
            <p className="mt-1 text-xs text-gray-500">
              {blurb.length}/500 characters
            </p>
          </div>

          <div className="flex gap-4">
            <button
              type="button"
              onClick={() => router.back()}
              className="flex-1 rounded-lg border border-gray-300 px-4 py-2 text-gray-700 hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex-1 rounded-lg bg-blue-600 px-4 py-2 text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {isSubmitting ? "Adding..." : "Add Recommendation"}
            </button>
          </div>
        </form>
      </main>
    </div>
  );
}
