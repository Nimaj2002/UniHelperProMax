import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AnswerMarkdown } from "@/features/chat/AnswerMarkdown";

describe("AnswerMarkdown inline HTML", () => {
  it("renders allowlisted inline tags as elements", () => {
    const { container } = render(<AnswerMarkdown text={"V<sub>DD</sub> x<sup>2</sup> <u>under</u> <script>no</script>"} />);
    expect(container.querySelector("sub")?.textContent).toBe("DD");
    expect(container.querySelector("sup")?.textContent).toBe("2");
    expect(container.querySelector("u")?.textContent).toBe("under");
    expect(container.querySelector("script")).toBeNull();
  });
});
