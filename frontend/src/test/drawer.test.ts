// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { openDrawer } from "../components/drawer";

describe("drawer lifecycle and accessibility", () => {
  beforeEach(() => { document.body.replaceChildren(); });

  it("isolates background content and makes the shell inert", () => {
    const shell = document.createElement("div");
    shell.id = "app";
    document.body.append(shell);
    const handle = openDrawer({ title: "Asset", label: "估值历史" });
    expect(handle.body.closest("aside")?.getAttribute("aria-modal")).toBe("true");
    expect(shell.inert).toBe(true);
    expect(handle.closed).toBe(false);
    handle.close();
    expect(shell.inert).toBe(false);
    expect(handle.signal.aborted).toBe(true);
    expect(handle.close()).toBeUndefined();
  });

  it("does not reopen a drawer from a late async retry", () => {
    const handle = openDrawer({ title: "Asset", label: "估值历史" });
    handle.close();
    expect(handle.closed).toBe(true);
    expect(document.querySelector(".drawer")).toBeNull();
  });

  it("replaces an existing drawer without leaving the new dialog inert", () => {
    const first = openDrawer({ title: "详情", label: "交易详情" });
    const second = openDrawer({ title: "记一笔", label: "新增交易" });
    expect(first.closed).toBe(true);
    expect(first.signal.aborted).toBe(true);
    expect(document.querySelectorAll(".drawer")).toHaveLength(1);
    expect(document.querySelectorAll(".drawer-backdrop")).toHaveLength(1);
    const dialog = second.body.closest("aside")!;
    expect(dialog.hasAttribute("inert")).toBe(false);
    expect(dialog.contains(document.activeElement)).toBe(true);
    second.close();
    expect(document.querySelector(".drawer")).toBeNull();
  });

  it("notifies loaders when a drawer closes", () => {
    const handle = openDrawer({ title: "Asset", label: "估值历史" });
    let closes = 0;
    handle.onClose(() => { closes += 1; });
    handle.close();
    handle.close();
    expect(closes).toBe(1);
    setDrawerContentForTest(handle);
    expect(handle.body.textContent).toBe("");
  });

  it("restores a connected trigger but does not focus a detached one", () => {
    const shell = document.createElement("div");
    shell.id = "app";
    const trigger = document.createElement("button");
    trigger.textContent = "打开";
    shell.append(trigger);
    document.body.append(shell);
    trigger.focus();
    const handle = openDrawer({ title: "详情", label: "详情" });
    handle.close();
    expect(document.activeElement).toBe(trigger);
    trigger.focus();
    const second = openDrawer({ title: "详情", label: "详情" });
    trigger.remove();
    second.close();
    expect(document.activeElement).not.toBe(trigger);
  });
});

function setDrawerContentForTest(handle: ReturnType<typeof openDrawer>) {
  if (handle.closed) return;
  handle.body.textContent = "late update";
}
