"use client";

import { useState, useRef, useCallback, useId, useMemo } from "react";
import {
  getGenreSuggestionsForMediaType,
  type MediaType,
} from "@/lib/genre-suggestions";

interface GenreComboboxProps {
  mediaType: MediaType;
  value: string;
  onChange: (genre: string) => void;
}

/** Capitalize a genre slug for display (e.g. "sci-fi" → "Sci-Fi") */
function formatLabel(slug: string): string {
  return slug
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("-");
}

/**
 * Accessible combobox for genre selection with type-to-filter and custom input.
 * WCAG: role="combobox", role="listbox", aria-activedescendant, keyboard nav.
 */
export function GenreCombobox({
  mediaType,
  value,
  onChange,
}: GenreComboboxProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const suggestions = useMemo(
    () => getGenreSuggestionsForMediaType(mediaType),
    [mediaType]
  );

  const filtered = useMemo(() => {
    if (!value) return suggestions;
    const lower = value.toLowerCase();
    return suggestions.filter(
      (s) =>
        s.value.includes(lower) ||
        formatLabel(s.value).toLowerCase().includes(lower)
    );
  }, [suggestions, value]);

  const showDropdown = isOpen && filtered.length > 0;

  const selectSuggestion = useCallback(
    (slug: string) => {
      onChange(slug);
      setIsOpen(false);
      setActiveIndex(-1);
    },
    [onChange]
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!showDropdown) return;

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setActiveIndex((prev) =>
          prev < filtered.length - 1 ? prev + 1 : prev
        );
        break;
      case "ArrowUp":
        e.preventDefault();
        setActiveIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case "Enter":
        e.preventDefault();
        if (activeIndex >= 0 && filtered[activeIndex]) {
          selectSuggestion(filtered[activeIndex].value);
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
          setTimeout(() => setIsOpen(false), 200);
        }}
        onKeyDown={handleKeyDown}
        maxLength={50}
        placeholder="Select or type a genre (optional)"
        className="bg-input border-input ring-accent placeholder-muted focus:border-accent w-full rounded-lg border px-4 py-2 focus:ring-1 focus:outline-hidden"
      />

      {showDropdown && (
        <ul
          id={listboxId}
          role="listbox"
          className="bg-surface border-default absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-lg border shadow-lg"
        >
          {filtered.map((suggestion, index) => (
            <li
              key={suggestion.value}
              id={`${listboxId}-option-${String(index)}`}
              role="option"
              aria-selected={index === activeIndex}
              className={`cursor-pointer px-3 py-2 text-sm ${
                index === activeIndex
                  ? "bg-accent/10"
                  : "hover:bg-surface-secondary"
              }`}
              onMouseDown={(e) => {
                e.preventDefault();
                selectSuggestion(suggestion.value);
              }}
            >
              {formatLabel(suggestion.value)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
