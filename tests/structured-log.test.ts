import { describe, expect, it } from "vitest";
import { redact } from "../electron/structured-log";

describe("structured log redaction", () => {
  it("removes credentials and local user identity recursively", () => {
    const output = JSON.stringify(
      redact({
        apiKey: "sk-secret-value",
        headers: { authorization: "Bearer abc.def" },
        url: "https://example.test?a=1&token=private-token",
        path: "C:\\Users\\orange\\Documents\\workspace",
      }),
    );
    expect(output).not.toContain("secret-value");
    expect(output).not.toContain("abc.def");
    expect(output).not.toContain("private-token");
    expect(output).not.toContain("orange");
    expect(output).toContain("REDACTED");
    expect(output).toContain("[USER]");
  });
});
