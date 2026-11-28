import { describe, expect, it } from "vitest";
import { deterministicAssistantAnswer } from "./deterministic-ai";

describe("deterministicAssistantAnswer", () => {
  it("answers what PSXL is without an external model", () => {
    const answer = deterministicAssistantAnswer([
      { role: "user", parts: [{ type: "text", text: "What is PSXL?" }] },
    ]);
    expect(answer).toContain("source-to-ledger financial operations workspace");
    expect(answer).toContain("connects broker");
  });

  it("supports plain content messages from older clients", () => {
    const answer = deterministicAssistantAnswer([{ role: "user", content: "how does psxl work" }]);
    expect(answer).toContain("Connect → Verify → Sync");
  });

  it("does not intercept a data question", () => {
    expect(
      deterministicAssistantAnswer([
        { role: "user", parts: [{ type: "text", text: "What is my current portfolio value?" }] },
      ]),
    ).toBeNull();
  });
});
