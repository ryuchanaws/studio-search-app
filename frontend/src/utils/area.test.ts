import { describe, it, expect } from "vitest";
import { extractPrefecture } from "./area";

describe("extractPrefecture", () => {
  it("extracts a prefecture from a full formatted address", () => {
    expect(extractPrefecture("〒107-6243 東京都港区赤坂６丁目３−１５")).toBe("東京都");
  });

  it("distinguishes prefectures with overlapping substrings (e.g. 神奈川県 vs 川崎)", () => {
    expect(extractPrefecture("神奈川県川崎市中原区")).toBe("神奈川県");
  });

  it("returns null when no prefecture is present", () => {
    expect(extractPrefecture("どこかの住所")).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(extractPrefecture(undefined)).toBeNull();
  });
});
