/** 014 T067: the message box's keys, Send/Stop and growth (contracts/ui-contract.md "Message box"). */
import { act, fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import { resetDrafts } from "@/features/chat/drafts";
import { MAX_BOX_PX, MessageBox } from "@/features/chat/MessageBox";
import { json, mockFetch, on, renderWithProviders } from "./test-utils";

function setup(props: Partial<Parameters<typeof MessageBox>[0]> = {}) {
  const api = mockFetch(
    on("GET", "/api/v1/sessions/s1/chat-drafts", () => json([])),
    on("PUT", "/api/v1/sessions/s1/chat-drafts", (_u, init) => json(JSON.parse(String(init.body)))),
  );
  const onSend = vi.fn(async () => true);
  const onStop = vi.fn();
  const utils = renderWithProviders(
    <MessageBox sessionKey="s1" chatId={null} textareaId="box" generating={false} onSend={onSend} onStop={onStop} {...props} />,
  );
  const box = screen.getByRole("textbox", { name: "Message" }) as HTMLTextAreaElement;
  return { ...utils, api, onSend: (props.onSend as typeof onSend) ?? onSend, onStop: (props.onStop as typeof onStop) ?? onStop, box };
}

beforeEach(() => resetDrafts());
afterEach(() => vi.unstubAllGlobals());

describe("message box keys", () => {
  it("Enter sends, Shift+Enter inserts a new line", async () => {
    const user = userEvent.setup();
    const { box, onSend } = setup();
    expect(box).toHaveAttribute("placeholder", "Ask about this session…");
    await user.type(box, "line one{Shift>}{Enter}{/Shift}line two");
    expect(box.value).toBe("line one\nline two");
    expect(onSend).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(onSend).toHaveBeenCalledWith("line one\nline two", []);
    await waitFor(() => expect(box.value).toBe(""));
    await waitFor(() => expect(box).toHaveFocus());
  });

  it("Enter while composing text doesn't send", async () => {
    const user = userEvent.setup();
    const { box, onSend } = setup();
    await user.type(box, "你好");
    fireEvent.keyDown(box, { key: "Enter", code: "Enter", isComposing: true });
    fireEvent.keyDown(box, { key: "Enter", code: "Enter", keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter", code: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("whitespace only can't be sent", async () => {
    const user = userEvent.setup();
    const { box, onSend } = setup();
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toHaveAttribute("aria-disabled", "true");
    await user.type(box, "   {Enter}");
    await user.click(send);
    expect(onSend).not.toHaveBeenCalled();
    await user.type(box, "x");
    expect(send).not.toHaveAttribute("aria-disabled");
  });

  it("while generating, typing works, Stop replaces Send and Escape stops", async () => {
    const user = userEvent.setup();
    const { box, onSend, onStop } = setup({ generating: true });
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    const stop = screen.getByRole("button", { name: "Stop" });
    await user.type(box, "next question{Enter}");
    expect(box.value).toBe("next question");
    expect(onSend).not.toHaveBeenCalled();
    await user.keyboard("{Escape}");
    expect(onStop).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(box).toHaveFocus());
    await user.click(stop);
    expect(onStop).toHaveBeenCalledTimes(2);
    await waitFor(() => expect(box).toHaveFocus());
  });

  it("grows to 8 lines, then scrolls (browsers without field-sizing)", async () => {
    vi.spyOn(CSS, "supports").mockReturnValue(false);
    const { box } = setup();
    let height = 60;
    Object.defineProperty(box, "scrollHeight", { configurable: true, get: () => height });
    fireEvent.change(box, { target: { value: "a\nb\nc" } });
    expect(box.style.height).toBe("60px");
    expect(box.style.overflowY).toBe("hidden");
    height = 400;
    fireEvent.change(box, { target: { value: "a\nb\nc\nd\ne\nf\ng\nh\ni\nj\nk" } });
    expect(box.style.height).toBe(`${MAX_BOX_PX}px`);
    expect(box.style.overflowY).toBe("auto");
    expect(MAX_BOX_PX).toBe(8 * 20 + 16);
    vi.restoreAllMocks();
  });

  it("lets the browser size itself where it can (no measuring on each key, SC-007)", async () => {
    vi.spyOn(CSS, "supports").mockReturnValue(true);
    const { box } = setup();
    fireEvent.change(box, { target: { value: "a\nb\nc" } });
    expect(box.style.height).toBe("");
    expect(box.style.maxHeight).toBe(`${MAX_BOX_PX}px`);
    expect(box.style.overflowY).toBe("auto");
    vi.restoreAllMocks();
  });

  it("every button has an accessible name and the box passes axe", async () => {
    const { container, box } = setup({ model: <button type="button" aria-label="Model: echo, Local">echo</button> });
    await act(async () => {
      fireEvent.change(box, { target: { value: "hi" } });
    });
    for (const b of screen.getAllByRole("button")) expect(b).toHaveAccessibleName();
    expect(await axe(container)).toHaveNoViolations();
  });

  it("with no model configured the box is disabled", () => {
    const { box } = setup({ disabled: true });
    expect(box).toBeDisabled();
    expect(screen.getByRole("button", { name: "Send" })).toHaveAttribute("aria-disabled", "true");
  });

  it("keeps the draft and saves it after a pause", async () => {
    const user = userEvent.setup();
    const { box, api } = setup();
    await user.type(box, "draft text");
    await waitFor(() => expect(api.calls.some((c) => c.init.method === "PUT")).toBe(true), { timeout: 2000 });
    const put = api.calls.filter((c) => c.init.method === "PUT").at(-1)!;
    expect(JSON.parse(String(put.init.body))).toEqual({ chatId: null, text: "draft text", attachments: [] });
  });
});
