"use client";

import { useState, useRef, useCallback, useId } from "react";
import { useMediaSearch } from "@/hooks/useMediaSearch";
import type { MediaType, MediaSearchResult } from "@/lib/media-search";

interface MediaAutocompleteProps {
  mediaType: MediaType;
  value: string;
  onChange: (title: string) => void;
  onSelect: (result: MediaSearchResult) => void;
  placeholder?: string;
  maxLength?: number;
}

/**
 * Accessible combobox for media title autocomplete.
 * WCAG: role="combobox", role="listbox", aria-activedescendant, keyboard nav.
 */
export function MediaAutocomplete({
  mediaType,
  value,
  onChange,
  onSelect,
  placeholder = "What are you recommending?",
  maxLength = 200,
}: MediaAutocompleteProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  const { results, isLoading } = useMediaSearch(value, mediaType);
  const showDropdown = isOpen && (results.length > 0 || isLoading);

  const selectResult = useCallback(
    (result: MediaSearchResult) => {
      // Strip author suffix for the title field (keep just the title before " — ")
      const cleanTitle = result.title.includes(" — ")
        ? (result.title.split(" — ")[0] ?? result.title)
        : result.title;
      onChange(cleanTitle);
      onSelect(result);
      setIsOpen(false);
      setActiveIndex(-1);
    },
    [onChange, onSelect]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((prev) => (prev < results.length - 1 ? prev + 1 : prev));
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case "Enter":
        e.preventDefault();
        if (activeIndex >= 0 && results[activeIndex]) {
          selectResult(results[activeIndex]);
        }
        break;
      case "Escape":
        setIsOpen(false);
        setActiveIndex(-1);
        break;
    }
  };

  const activeDescendant =
    activeIndex >= 0 ? `${listboxId}-option-${String(activeIndex)}` : undefined;

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={showDropdown}
        aria-controls={listboxId}
        aria-activedescendant={activeDescendant}
        aria-autocomplete="list"
        aria-haspopup="listbox"
        value={value}
        onChange={(e) => {
          onChange(e.target.value);
          setIsOpen(true);
          setActiveIndex(-1);
        }}
        onFocus={() => setIsOpen(true)}
        onBlur={() => {
          // Delay to allow click on option
          setTimeout(() => setIsOpen(false), 200);
        }}
        onKeyDown={handleKeyDown}
        maxLength={maxLength}
        placeholder={placeholder}
        className="bg-input border-input ring-accent placeholder-muted focus:border-accent w-full rounded-lg border px-4 py-2 focus:ring-1 focus:outline-hidden"
      />

      {isLoading && (
        <div className="text-muted pointer-events-none absolute end-3 top-1/2 -translate-y-1/2">
          <svg
            className="h-4 w-4 animate-spin"
            viewBox="0 0 24 24"
            fill="none"
            aria-hidden="true"
          >
            <circle
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="3"
              className="opacity-25"
            />
            <path
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              className="opacity-75"
            />
          </svg>
        </div>
      )}

      {showDropdown && results.length > 0 && (
        <ul
          ref={listRef}
          id={listboxId}
          role="listbox"
          className="bg-surface border-default absolute z-50 mt-1 max-h-80 w-full overflow-auto rounded-lg border shadow-lg"
        >
          {results.map((result, index) => (
            <li
              key={`${result.provider}-${result.externalId}`}
              id={`${listboxId}-option-${String(index)}`}
              role="option"
              aria-selected={index === activeIndex}
              className={`flex cursor-pointer items-center gap-3 px-3 py-2 ${
                index === activeIndex
                  ? "bg-accent/10"
                  : "hover:bg-surface-secondary"
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                selectResult(result);
              }}
            >
              {result.coverUrl ? (
                <img
                  src={result.coverUrl}
                  alt=""
                  className="h-14 w-10 shrink-0 rounded object-cover"
                  loading="lazy"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
              ) : (
                <div className="bg-skeleton flex h-14 w-10 shrink-0 items-center justify-center rounded">
                  <span className="text-muted text-xs">N/A</span>
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-primary truncate text-sm font-medium">
                  {result.title}
                </p>
                {result.year && (
                  <p className="text-muted text-xs">{result.year}</p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
