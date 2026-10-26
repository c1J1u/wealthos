// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { disclosure } from "../components/disclosure";
import { el } from "../components/dom";

describe("accessible native disclosure", () => {
  it("keeps server-provided explanatory text behind a keyboard-native summary", () => {
    const node = disclosure("查看口径说明", el("p", { textContent: "公积金付租不计入工资现金流" }));
    const details = node as HTMLDetailsElement;
    expect(details.open).toBe(false);
    expect(node.querySelector("summary")?.textContent).toBe("查看口径说明");
    details.querySelector("summary")!.click();
    expect(details.open).toBe(true);
    expect(node.textContent).toContain("公积金付租");
  });
});
