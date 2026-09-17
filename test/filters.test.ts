import { describe, expect, it } from "vitest";
import { filterModels, matchPattern, matchesAny } from "../dist/map/filters.js";

describe("matchPattern", () => {
  it("matches exact ids", () => {
    expect(matchPattern("gpt-5", "gpt-5")).toBe(true);
    expect(matchPattern("gpt-5", "gpt-4")).toBe(false);
  });

  it("matches a bare id against a prefixed model id", () => {
    expect(matchPattern("cc/claude-sonnet-4-6", "claude-sonnet-4-6")).toBe(true);
    expect(matchPattern("claude-sonnet-4-6", "cc/claude-sonnet-4-6")).toBe(false);
  });

  it("supports trailing wildcards", () => {
    expect(matchPattern("claude-opus-4", "claude-*")).toBe(true);
    expect(matchPattern("gpt-5", "claude-*")).toBe(false);
  });

  it("supports leading wildcards", () => {
    expect(matchPattern("qwen3-8b-free", "*-free")).toBe(true);
    expect(matchPattern("qwen3-8b", "*-free")).toBe(false);
  });

  it("supports the global wildcard", () => {
    expect(matchPattern("anything", "*")).toBe(true);
  });
});

describe("matchesAny", () => {
  it("returns false for empty or missing pattern lists", () => {
    expect(matchesAny("m", [])).toBe(false);
    expect(matchesAny("m", undefined)).toBe(false);
  });
});

describe("filterModels", () => {
  const models = [{ id: "a/one" }, { id: "b/two" }, { id: "c/three" }];

  it("passes everything through when no filters are set", () => {
    expect(filterModels(models).map((m) => m.id)).toEqual(["a/one", "b/two", "c/three"]);
  });

  it("applies an include allowlist", () => {
    expect(filterModels(models, { include: ["one", "three"] }).map((m) => m.id)).toEqual([
      "a/one",
      "c/three",
    ]);
  });

  it("applies an exclude denylist", () => {
    expect(filterModels(models, { exclude: ["two"] }).map((m) => m.id)).toEqual([
      "a/one",
      "c/three",
    ]);
  });

  it("lets exclude win over include", () => {
    expect(
      filterModels(models, { include: ["one", "two"], exclude: ["two"] }).map((m) => m.id),
    ).toEqual(["a/one"]);
  });
});