import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { locate } from "./sandbox.ts";

const file = "function f(a) {\n  if (a) {\n    return 1;\n  }\n  return 2;\n}\n";

describe("locate", () => {
  it("finds exact text", () => {
    const s = locate(file, "return 1;");
    assert.ok(typeof s === "object");
    assert.equal(file.slice(s.start, s.end), "return 1;");
  });
  it("tolerates different indentation and trailing spaces", () => {
    const s = locate(file, "if (a) {   \n  return 1;\n}");
    assert.ok(typeof s === "object");
    assert.equal(file.slice(s.start, s.end), "  if (a) {\n    return 1;\n  }");
  });
  it("refuses ambiguous or missing text", () => {
    assert.equal(locate(file, "return"), "ambiguous");
    assert.equal(locate(file, "return 3;"), "missing");
    assert.equal(locate(file, "  \n "), "missing");
  });
});
