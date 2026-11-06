/** 022 T029/T042/T045/T068: the AI Teacher section, question cards, questions column, idea set. */
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { axe } from "vitest-axe";
import type { Question, TeacherSummary } from "@/features/teacher/api";
import { CurrentQuestion } from "@/features/teacher/CurrentQuestion";
import { IdeaSetPopover } from "@/features/teacher/IdeaSetPopover";
import { markCurrent } from "@/features/teacher/PlanDialog";
import { QuestionCard, type CardActions } from "@/features/teacher/QuestionCard";
import { InquiriesColumn, preview } from "@/features/teacher/InquiriesColumn";
import { QuestionsColumn } from "@/features/teacher/QuestionsColumn";
import { TeacherSection } from "@/features/teacher/TeacherSection";
import { setTeacherTabsHost } from "@/features/teacher/teacherTabs";
import { json, mockFetch, on, renderWithProviders } from "../test-utils";

const toastMock = vi.hoisted(() => Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn() }));
vi.mock("sonner", () => ({ toast: toastMock }));

const ENDPOINT = {
  id: "ep1", name: "Fake local", style: "openai", baseUrl: "http://localhost:8021/v1", locality: "local", enabled: true,
  key: { configured: false, masked: null, readable: true }, privacyAcknowledged: false, version: 1,
  models: [{ id: "m1", modelId: "echo", displayName: "Echo", capabilities: { images: false, pdf: false, audio: false }, hidden: false, source: "manual", contextLimit: null, outputLimit: null }],
};
const AI = [
  on("GET", "/api/v1/ai/endpoints", () => json([ENDPOINT])),
  on("GET", "/api/v1/ai/settings", () => json({ customInstructions: "", lastModel: null, version: 1 })),
];
const summary = (over: Partial<TeacherSummary> = {}): TeacherSummary => ({
  id: "t1", kind: "lesson", title: "Determinants", createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
  generating: false, unseenAnswer: false, unansweredCount: 2, modelLabel: "Fake · Echo", version: 1, ...over,
});
const choice = (over: Partial<Question> = {}): Question => ({
  id: "q1", answerId: "a1", kind: "choice", title: "Zero determinant", prompt: "If det(A) = 0, what follows?",
  options: ["A is invertible", "A is singular"], practice: false, status: "unanswered", revealed: false,
  submission: null, grades: [], hints: [], ...over,
});
const actions = (over: Partial<CardActions> = {}): CardActions => ({
  busy: false, onSubmit: vi.fn(), onDispute: vi.fn(), onHint: vi.fn(), onReveal: vi.fn(), ...over,
});

beforeEach(() => localStorage.clear());
afterEach(() => {
  vi.unstubAllGlobals();
  setTeacherTabsHost(null);
});

describe("TeacherSection", () => {
  it("lists lessons with kind, open count and opens one in a tab", async () => {
    mockFetch(...AI, on("GET", "/api/v1/sessions/s1/teacher-chats", () => json([summary(), summary({ id: "t2", kind: "practice", title: "Drill", unansweredCount: 0 })])));
    const open = vi.fn();
    setTeacherTabsHost({ sessionKey: "s1", open, replace: vi.fn(), close: vi.fn() });
    const { container } = renderWithProviders(<TeacherSection sessionKey="s1" />);
    const list = await screen.findByRole("list", { name: "Teacher chats" });
    expect(within(list).getByText("Lesson")).toBeInTheDocument();
    expect(within(list).getByText("Practice")).toBeInTheDocument();
    expect(within(list).getByText(/2 open/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /^Determinants/ }));
    expect(open).toHaveBeenCalledWith("t1");
    expect(await axe(container)).toHaveNoViolations();
  });

  it("explains how to set up a model when there is none", async () => {
    mockFetch(
      on("GET", "/api/v1/ai/endpoints", () => json([])),
      on("GET", "/api/v1/ai/settings", () => json({ customInstructions: "", lastModel: null, version: 1 })),
      on("GET", "/api/v1/sessions/s1/teacher-chats", () => json([])),
    );
    renderWithProviders(<TeacherSection sessionKey="s1" />);
    expect(await screen.findByText(/models you add in Settings → AI/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Open AI settings" })).toBeInTheDocument();
  });

  it("names how many graph ideas a delete removes", async () => {
    mockFetch(
      ...AI,
      on("GET", "/api/v1/sessions/s1/teacher-chats", () => json([summary()])),
      on("GET", "/api/v1/teacher-chats/t1/graph-impact", () => json({ ideas: 3 })),
    );
    renderWithProviders(<TeacherSection sessionKey="s1" />);
    await userEvent.click(await screen.findByRole("button", { name: "Actions for Determinants" }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Delete" }));
    expect(await screen.findByText(/3 ideas will be removed from your knowledge graph/)).toBeInTheDocument();
  });
});

describe("QuestionCard", () => {
  it("answers by keyboard; confidence may stay unset (not Low)", async () => {
    const onSubmit = vi.fn();
    const { container } = renderWithProviders(<QuestionCard chatId="t1" q={choice()} actions={actions({ onSubmit })} />);
    const submit = screen.getByRole("button", { name: "Submit answer" });
    expect(submit).toBeDisabled();
    expect(screen.getByText("Not set")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("radio", { name: /A is singular/ }));
    await userEvent.type(screen.getByLabelText("Your thinking (optional)"), "dependent columns");
    await userEvent.click(submit);
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({ id: "q1" }), { choice: 1, text: "", dontKnow: false, confidence: null, thinking: "dependent columns" });
    expect(container.textContent).not.toContain("Correct answer"); // key not shown before answering
    expect(await axe(container)).toHaveNoViolations();
  });

  it("keeps an unsent answer across remounts", async () => {
    const { unmount } = renderWithProviders(<QuestionCard chatId="t1" q={choice()} actions={actions()} />);
    await userEvent.click(screen.getByRole("radio", { name: /A is invertible/ }));
    unmount();
    renderWithProviders(<QuestionCard chatId="t1" q={choice()} actions={actions()} />);
    expect(screen.getByRole("radio", { name: /A is invertible/ })).toBeChecked();
  });

  it("waits while a reply streams", () => {
    renderWithProviders(<QuestionCard chatId="t1" q={choice()} actions={actions({ busy: true })} />);
    expect(screen.getByText("Wait until the teacher has finished.")).toBeInTheDocument();
  });

  it("shows the record with every grade, the key, and Dispute grade", async () => {
    const onDispute = vi.fn();
    const q = choice({
      status: "correct", key: 1, explanation: "Dependent columns.",
      submission: { choice: 0, confidence: 25, dontKnow: false, thinking: "guess", submittedAt: "t" },
      grades: [
        { grade: "incorrect", by: "server", at: "t", feedback: "" },
        { grade: "correct", by: "teacher", at: "t", feedback: "Fair point.", disputeReason: "A was meant" },
      ],
    });
    renderWithProviders(<QuestionCard chatId="t1" q={q} actions={actions({ onDispute })} />);
    const grades = screen.getByRole("list", { name: "Grades" });
    expect(within(grades).getByText("Incorrect")).toBeInTheDocument();
    expect(within(grades).getByText("teacher, after dispute")).toBeInTheDocument();
    expect(screen.getByText("Correct answer")).toBeInTheDocument();
    expect(screen.getByText("Confidence: 25%")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Dispute grade" }));
    await userEvent.type(screen.getByLabelText(/Why do you think/), "Because");
    await userEvent.click(screen.getByRole("button", { name: "Send to the teacher" }));
    expect(onDispute).toHaveBeenCalledWith(expect.objectContaining({ id: "q1" }), "Because");
  });

  it("offers Hint and Reveal on practice problems", async () => {
    const onHint = vi.fn();
    const onReveal = vi.fn();
    renderWithProviders(<QuestionCard chatId="t1" q={choice({ practice: true })} actions={actions({ onHint, onReveal })} />);
    await userEvent.click(screen.getByRole("button", { name: "Hint" }));
    expect(onHint).toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Reveal solution" }));
    await userEvent.click(screen.getByRole("button", { name: "Reveal" }));
    expect(onReveal).toHaveBeenCalled();
  });
});

describe("Questions column and current question", () => {
  const many = Array.from({ length: 200 }, (_, i) =>
    choice({ id: `q${i + 1}`, title: `Question ${i + 1}`, status: i % 3 === 0 ? "incorrect" : i % 3 === 1 ? "unanswered" : "correct" }),
  );

  it("the questions menu selects by keyboard; title and status in words", async () => {
    const onSelect = vi.fn();
    const { container } = renderWithProviders(<QuestionsColumn questions={many} selected={null} onSelect={onSelect} />);
    const options = screen.getAllByRole("option");
    expect(options).toHaveLength(200);
    expect(options[0]).toHaveAccessibleName("Q1 Question 1, Incorrect");
    options[0].focus();
    await userEvent.keyboard("{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenCalledWith("q2");
    expect(await axe(container)).toHaveNoViolations();
  }, 20_000); // 200 rows + axe: slow when the whole suite runs in parallel

  it("lists what the student asked, as its first words, and jumps to it", async () => {
    const onSelect = vi.fn();
    const turn = (id: string, user: Record<string, unknown>) => ({ id, user, answer: {} }) as never;
    renderWithProviders(
      <InquiriesColumn
        turns={[
          turn("u1", { text: "Why does a zero determinant mean the matrix has no inverse at all?" }),
          turn("u2", { action: "answers", text: "" }),
          turn("u3", { text: "And eigenvalues?" }),
        ]}
        onSelect={onSelect}
      />,
    );
    const items = within(screen.getByRole("list", { name: "Your questions" })).getAllByRole("button");
    expect(items.map((b) => b.textContent)).toEqual(["Why does a zero determinant mean the matrix…", "And eigenvalues?"]);
    await userEvent.click(items[1]);
    expect(onSelect).toHaveBeenCalledWith("u3");
    expect(preview("one two")).toBe("one two");
  });

  it("several open cards share one Submit answers, enabled once every card is answered", async () => {
    const onSubmitAll = vi.fn();
    const text = choice({ id: "q3", title: "Third", kind: "text", options: undefined });
    const qs = [choice(), choice({ id: "q2", title: "Second" }), text];
    const { container } = renderWithProviders(
      <CurrentQuestion chatId="shared" questions={qs} selected={null} onClearSelection={vi.fn()} actions={actions()} onSubmitAll={onSubmitAll} />,
    );
    expect(screen.queryByRole("button", { name: "Submit answer" })).toBeNull();
    const submit = screen.getByRole("button", { name: "Submit answers" });
    const [first] = screen.getAllByRole("radio", { name: /A is singular/ });
    await userEvent.click(first);
    await userEvent.click(screen.getAllByRole("radio", { name: "I don't know" })[1]);
    expect(submit).toBeDisabled();
    expect(screen.getByText("Answer all 3 questions to submit.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("checkbox", { name: "I don't know" }));
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    const sent = onSubmitAll.mock.calls[0][0] as [Question, { choice: number | null; dontKnow: boolean }][];
    expect(sent.map(([q, d]) => [q.id, d.choice, d.dontKnow])).toEqual([["q1", 1, false], ["q2", null, true], ["q3", null, true]]);
    expect(await axe(container)).toHaveNoViolations();
  });

  it("sets confidence on a 0–100 slider in steps of 25", async () => {
    renderWithProviders(<QuestionCard chatId="slider" q={choice()} actions={actions()} />);
    const slider = screen.getByRole("slider", { name: "How sure are you?" });
    expect(slider).toHaveAttribute("aria-valuetext", "Not set");
    slider.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(slider).toHaveAttribute("aria-valuetext", "75%");
    await userEvent.keyboard("{Home}");
    expect(slider).toHaveAttribute("aria-valuetext", "0%");
  });
});

describe("idea set and plan", () => {
  it("refuses a 31st idea", async () => {
    const ideas = Array.from({ length: 30 }, (_, i) => ({ id: `i${i}`, name: `Idea ${i}`, statement: "s", courseIds: [], sourceCount: 1, updatedAt: "t" }));
    mockFetch(on("GET", "/api/v1/knowledge-graph/ideas", () => json([{ id: "new", name: "Fresh idea", statement: "s", courseIds: [], sourceCount: 1, updatedAt: "t" }])));
    const onChange = vi.fn();
    renderWithProviders(<IdeaSetPopover ideas={ideas} onChange={onChange} />);
    await userEvent.click(screen.getByRole("button", { name: /Ideas from earlier lessons: 30/ }));
    await userEvent.type(screen.getByLabelText("Search ideas to add"), "fresh");
    await userEvent.click(await screen.findByRole("button", { name: /Fresh idea/ }));
    expect(await screen.findByText("Up to 30 ideas.")).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "Remove Idea 0" }));
    await waitFor(() => expect(onChange).toHaveBeenCalledWith(ideas.slice(1)));
  });

  it("outlines the current plan step without colours", () => {
    const out = markCurrent({ version: 1, mermaid: "graph TD\n a --> b", current: "b", createdAt: "t" });
    expect(out).toContain("class b uhCurrent");
    expect(out).not.toMatch(/#[0-9a-f]{3,6}|rgb/i);
    expect(markCurrent({ version: 1, mermaid: "graph TD", current: "x; click", createdAt: "t" })).toBe("graph TD");
  });
});
