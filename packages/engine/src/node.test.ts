import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { satisfies } from "./node.ts";

describe("satisfies", () => {
  it("reads hyphen ranges like Excalidraw's", () => {
    assert.equal(satisfies(22, "18.0.0 - 22.x.x"), true);
    assert.equal(satisfies(24, "18.0.0 - 22.x.x"), false);
  });
  it("reads comparisons and alternatives", () => {
    assert.equal(satisfies(24, ">=20"), true);
    assert.equal(satisfies(18, ">=20"), false);
    assert.equal(satisfies(20, ">=18 <21"), true);
    assert.equal(satisfies(22, ">=18 <21"), false);
    assert.equal(satisfies(18, "^18.17.0 || ^20.3.0"), true);
    assert.equal(satisfies(22, "^18.17.0 || ^20.3.0"), false);
  });
  it("treats caret, tilde and bare versions as pinning the major", () => {
    assert.equal(satisfies(20, "^20.11"), true);
    assert.equal(satisfies(22, "~20.11"), false);
    assert.equal(satisfies(22, "22"), true);
  });
});
