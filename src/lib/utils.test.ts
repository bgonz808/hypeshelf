import { describe, it, expect } from "vitest";
import { cn, isValidUrl, truncate, formatRelativeTime } from "./utils";

describe("cn", () => {
  it("merges class names", () => {
    expect(cn("foo", "bar")).toBe("foo bar");
  });

  it("handles conditional classes", () => {
    expect(cn("foo", false && "bar", "baz")).toBe("foo baz");
  });

  it("deduplicates Tailwind classes", () => {
    expect(cn("p-4", "p-2")).toBe("p-2");
  });
});

describe("isValidUrl", () => {
  it("accepts valid https URLs", () => {
    expect(isValidUrl("https://example.com")).toBe(true);
    expect(isValidUrl("https://example.com/path?query=1")).toBe(true);
  });

  it("accepts valid http URLs", () => {
    expect(isValidUrl("http://example.com")).toBe(true);
  });

  it("rejects invalid URLs", () => {
    expect(isValidUrl("not-a-url")).toBe(false);
    expect(isValidUrl("")).toBe(false);
    expect(isValidUrl("ftp://example.com")).toBe(false);
    // eslint-disable-next-line no-script-url -- Intentional: testing XSS vector rejection
    expect(isValidUrl("javascript:alert(1)")).toBe(false);
  });
});

describe("truncate", () => {
  it("returns original string if within limit", () => {
    expect(truncate("hello", 10)).toBe("hello");
  });

  it("truncates and adds ellipsis", () => {
    expect(truncate("hello world", 8)).toBe("hello...");
  });

  it("handles edge cases", () => {
    expect(truncate("", 5)).toBe("");
    expect(truncate("hi", 2)).toBe("hi");
  });
});

describe("formatRelativeTime", () => {
  it("formats recent timestamps", () => {
    const now = Date.now();
    expect(formatRelativeTime(now)).toBe("just now");
    expect(formatRelativeTime(now - 60 * 1000)).toBe("1m ago");
    expect(formatRelativeTime(now - 60 * 60 * 1000)).toBe("1h ago");
    expect(formatRelativeTime(now - 24 * 60 * 60 * 1000)).toBe("1d ago");
  });
});
