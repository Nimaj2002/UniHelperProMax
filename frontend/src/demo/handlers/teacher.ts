/**
 * 024: AI teacher and knowledge graph (contracts/demo-mode.md §2, specs/022). Lessons and practice
 * runs play canned prose, questions, grades, hints and plans through the shared run registry
 * (sse.ts); the knowledge graph is a small fixed sample that can be browsed and pruned.
 */
import { http, type HttpHandler } from "msw";
import type { Schemas } from "@/lib/api";
import { DEMO_AI, DEMO_LINE, DEMO_MODEL_LABEL, IDEAS, IDEA_LINKS, TEACHER, type CannedQuestion } from "../canned/ai";
import { getSession, parseKey } from "../calendar";
import { API, checkIfMatch, json, notFound, problem, readJson, validation, type Body, type Res } from "../http";
import { IDS, pastKeys } from "../seed";
import { bump, newId, nowIso, registerSlice } from "../store";
import { activeRunFor, deltas, startRun, usageOf, type Step } from "../sse";

type Summary = Schemas["TeacherChatSummary"];
type Turn = Schemas["TeacherTurnOut"];
type Answer = Schemas["TeacherAnswerOut"];

export interface Question extends CannedQuestion {
  id: string;
  answerId: string;
  revealed: boolean;
  submission: Schemas["SubmissionOut"] | null;
  grades: Schemas["GradeOut"][];
  hints: Schemas["HintOut"][];
}

export interface TeacherChat {
  summary: Omit<Summary, "generating" | "unansweredCount">;
  sessionKey: string;
  topic: string | null;
  turns: Turn[];
  questions: Question[];
  plans: Schemas["PlanOut"][];
  ideaSet: string[];
  graph: Schemas["GraphStatus"];
}

interface Idea {
  id: string;
  name: string;
  statement: string;
  courseIds: string[];
  updatedAt: string;
  sources: Schemas["SourceOut"][];
}

/** The teacher slice's state; chat.ts reaches it for DELETE/restore (teacher chats are chats). */
export const T = {
  chats: [] as TeacherChat[],
  deleted: new Set<string>(),
  ideas: [] as Idea[],
  links: [] as Schemas["LinkOut"][],
  graphRev: 0,
};

const MODEL: Schemas["ChatModelOut"] = { endpointId: DEMO_AI.endpointId, modelId: DEMO_AI.modelId, label: DEMO_MODEL_LABEL, available: true };
const prose = (s: string) => s.trim();

// ───────────────────────────── views ─────────────────────────────

const statusOf = (q: Question): Schemas["QuestionOut"]["status"] =>
  !q.submission ? "unanswered" : q.grades.length ? q.grades[q.grades.length - 1].grade : "submitted";

export function questionOut(q: Question): Schemas["QuestionOut"] {
  const status = statusOf(q);
  const shown = status !== "unanswered" || q.revealed;
  return {
    id: q.id,
    answerId: q.answerId,
    kind: q.kind,
    title: q.title,
    prompt: q.prompt,
    ...(q.kind === "choice" ? { options: q.options } : {}),
    practice: q.practice,
    status,
    revealed: q.revealed,
    ...(shown ? { key: q.key, explanation: q.explanation } : {}),
    submission: q.submission,
    grades: q.grades,
    hints: q.hints,
  };
}

export const findTeacherChat = (id: string) => (T.deleted.has(id) ? undefined : T.chats.find((c) => c.summary.id === id));

export const teacherSummary = (c: TeacherChat): Summary => ({
  ...c.summary,
  generating: !!activeRunFor(c.summary.id),
  unansweredCount: c.questions.filter((q) => !q.submission).length,
});

const ideaSummary = (i: Idea): Schemas["IdeaSummary"] => ({
  id: i.id,
  name: i.name,
  statement: i.statement,
  courseIds: i.courseIds,
  sourceCount: i.sources.length,
  updatedAt: i.updatedAt,
});

const view = (c: TeacherChat): Res<"/api/v1/teacher-chats/{chat_id}", "get"> => ({
  chat: teacherSummary(c),
  topic: c.topic,
  model: MODEL,
  turns: c.turns,
  questions: c.questions.map(questionOut),
  plans: c.plans,
  ideaSet: T.ideas.filter((i) => c.ideaSet.includes(i.id)).map(ideaSummary),
  graph: c.graph,
});

// ───────────────────────────── runs ─────────────────────────────

const newAnswer = (status: Answer["status"] = "queued"): Answer => ({
  id: newId("ans"),
  status,
  runId: null,
  endpointLabel: DEMO_AI.endpointLabel,
  modelLabel: DEMO_AI.modelLabel,
  locality: DEMO_AI.locality,
  segments: [],
  error: null,
});

const newQuestions = (list: CannedQuestion[], answerId: string): Question[] =>
  list.map((q) => ({ ...q, id: newId("q"), answerId, revealed: false, submission: null, grades: [], hints: [] }));

function addProse(answer: Answer, text: string) {
  const last = answer.segments[answer.segments.length - 1];
  if (last?.type === "markdown") last.text = (last.text ?? "") + text;
  else answer.segments.push({ type: "markdown", text });
}

type ScriptGrade = Schemas["GradeOut"] & { questionId: string };

interface Script {
  text: string;
  questions?: CannedQuestion[];
  grades?: ScriptGrade[];
  plan?: { mermaid: string; current: string };
  hint?: { questionId: string; text: string };
}

/** Append a user turn and play the teacher's canned reply as a run. */
function launch(
  c: TeacherChat,
  user: Omit<Schemas["TeacherUserOut"], "id" | "createdAt">,
  script: Script,
  graded: Question[] = [],
  status = 202,
): Response {
  if (activeRunFor(c.summary.id)) return problem(409, "run_active", "An answer is still being generated in this chat.");
  const answer = newAnswer();
  const turn: Turn = { id: newId("turn"), user: { id: newId("msg"), createdAt: nowIso(), ...user }, answer };
  c.turns.push(turn);
  const qs = new Map(newQuestions(script.questions ?? [], answer.id).map((q) => [q.id, q]));
  const gradeOf = new Map((script.grades ?? []).map((g) => [g.questionId, g]));
  const at = nowIso();
  const steps: Step[] = [...deltas(prose(script.text))];
  for (const q of qs.values()) steps.push({ type: "question", data: questionOut(q) });
  for (const g of script.grades ?? []) steps.push({ type: "grade", data: { questionId: g.questionId, grade: g.grade, feedback: g.feedback, by: "teacher", at } });
  if (script.hint) steps.push({ type: "hint", data: { ...script.hint, createdAt: at } });
  if (script.plan) {
    steps.push({ type: "plan", data: { version: c.plans.length + 1, answerId: answer.id, ...script.plan, createdAt: at } });
  }
  steps.push(...deltas(`\n\n${DEMO_LINE}`), usageOf(user.text, script.text));
  if (c.summary.kind === "lesson") c.graph = { status: "pending", pendingTurns: c.graph.pendingTurns + 1 };

  const run = startRun({
    id: newId("run"),
    chatId: c.summary.id,
    sessionKey: c.sessionKey,
    turnId: turn.id,
    answerId: answer.id,
    teacher: true,
    endpointLabel: DEMO_AI.endpointLabel,
    modelLabel: DEMO_AI.modelLabel,
    locality: DEMO_AI.locality,
    steps,
    apply: (ev) => {
      switch (ev.type) {
        case "start":
          answer.status = "streaming";
          break;
        case "delta":
          addProse(answer, ev.data.text);
          break;
        case "question": {
          const q = qs.get(ev.data.id);
          if (q) c.questions.push(q);
          answer.segments.push({ type: "question", questionId: ev.data.id });
          break;
        }
        case "grade": {
          const q = c.questions.find((x) => x.id === ev.data.questionId);
          const grade = ev.data.grade as Schemas["GradeOut"]["grade"];
          const disputeReason = gradeOf.get(ev.data.questionId)?.disputeReason ?? null;
          q?.grades.push({ grade, feedback: ev.data.feedback ?? "", by: "teacher", disputeReason, at: ev.data.at });
          break;
        }
        case "hint":
          c.questions.find((x) => x.id === ev.data.questionId)?.hints.push({ text: ev.data.text, createdAt: ev.data.createdAt });
          break;
        case "plan":
          c.plans.push(ev.data);
          break;
        case "done":
        case "stopped":
          answer.status = ev.data.status;
          answer.runId = null;
          c.summary.updatedAt = nowIso();
          c.summary.unseenAnswer = true;
          if (c.summary.kind === "lesson") c.graph = { status: "ok", pendingTurns: 0 }; // the "worker" ran
          break;
      }
    },
  });
  answer.runId = run.id;
  c.summary.updatedAt = nowIso();
  return json<Schemas["TeacherSendResult"]>(
    { chat: teacherSummary(c), runId: run.id, turnId: turn.id, answerId: answer.id, graded: graded.map(questionOut) },
    status,
  );
}

// ───────────────────────────── seed ─────────────────────────────

function seed() {
  T.chats = [];
  T.deleted = new Set();
  T.graphRev = 0;
  const key = pastKeys(IDS.algoLineage)[0];
  const session = key ? getSession(key) : null;
  const at = session?.end ?? nowIso();
  const chatId = "teacher-1";

  const first = newAnswer("completed");
  const [q1, q2] = newQuestions(TEACHER.questions, first.id);
  first.segments = [
    { type: "markdown", text: prose(TEACHER.lessonIntro) },
    { type: "question", questionId: q1.id },
    { type: "question", questionId: q2.id },
    { type: "markdown", text: DEMO_LINE },
  ];
  q1.submission = { choice: 1, confidence: 75, dontKnow: false, thinking: "", submittedAt: at };
  q1.grades = [{ grade: "correct", feedback: "", by: "server", disputeReason: null, at }];
  q2.submission = {
    text: "Each level of the recursion does n work in total and there are about log n levels.",
    confidence: 50,
    dontKnow: false,
    thinking: "",
    submittedAt: at,
  };
  q2.grades = [{ grade: "correct", feedback: "Exactly — n work per level times log n levels.", by: "teacher", disputeReason: null, at }];
  const second = newAnswer("completed");
  second.segments = [{ type: "markdown", text: `${prose(TEACHER.feedback)}\n\n${DEMO_LINE}` }];

  if (key) {
    T.chats.push({
      summary: { id: chatId, kind: "lesson", title: "Merge sort and recurrences", createdAt: at, updatedAt: at, unseenAnswer: false, modelLabel: DEMO_MODEL_LABEL, version: 1 },
      sessionKey: key,
      topic: "Merge sort and recurrences",
      turns: [
        { id: "teacher-1-t1", user: { id: "teacher-1-m1", text: "Teach me how to analyse merge sort.", createdAt: at, action: null, target: null, attachments: [] }, answer: first },
        { id: "teacher-1-t2", user: { id: "teacher-1-m2", text: "Answers to 2 questions", createdAt: at, action: "answers", target: null, attachments: [] }, answer: second },
      ],
      questions: [q1, q2],
      plans: [{ version: 1, answerId: first.id, ...TEACHER.plan, createdAt: at }],
      ideaSet: [],
      graph: { status: "ok", pendingTurns: 0 },
    });
  }

  const source: Schemas["SourceOut"][] = key
    ? [{ chatId, chatTitle: "Merge sort and recurrences", sessionKey: key, sessionLabel: `Algorithms · ${parseKey(key)?.date ?? ""}`, courseId: IDS.algo, messageId: null, createdAt: at, available: true }]
    : [];
  T.ideas = IDEAS.map(([k, name, statement]) => ({ id: `idea-${k}`, name, statement, courseIds: [IDS.algo], updatedAt: at, sources: [...source] }));
  T.links = IDEA_LINKS.map(([premises, conclusion], i) => ({ id: `link-${i + 1}`, premiseIds: premises.map((p) => `idea-${p}`), conclusionId: `idea-${conclusion}` }));
  T.chats[0]?.ideaSet.push(...T.ideas.map((i) => i.id));
}

const inSessions = (c: TeacherChat, keys: Set<string>) => keys.has(c.sessionKey);

registerSlice({
  name: "teacher",
  seed,
  removeSessions: (keys) => {
    const gone = new Set(T.chats.filter((c) => inSessions(c, keys)).map((c) => c.summary.id));
    T.chats = T.chats.filter((c) => !gone.has(c.summary.id));
    for (const i of T.ideas) i.sources = i.sources.filter((s) => !gone.has(s.chatId));
    dropIdeas(T.ideas.filter((i) => i.sources.length === 0).map((i) => i.id));
  },
  count: (keys) => {
    const chats = T.chats.filter((c) => !T.deleted.has(c.summary.id) && inSessions(c, keys));
    const ids = new Set(chats.map((c) => c.summary.id));
    return { teacherChats: chats.length, graphIdeas: T.ideas.filter((i) => i.sources.some((s) => ids.has(s.chatId))).length };
  },
  snapshot: (lineageIds) => {
    const saved = structuredClone({
      chats: T.chats.filter((c) => lineageIds.has(parseKey(c.sessionKey)?.lineageId ?? "")),
      ideas: T.ideas,
      links: T.links,
    });
    return () => {
      for (const c of saved.chats) if (!T.chats.some((x) => x.summary.id === c.summary.id)) T.chats.push(c);
      for (const i of saved.ideas) {
        const cur = T.ideas.find((x) => x.id === i.id);
        if (!cur) T.ideas.push(i);
        else for (const s of i.sources) if (!cur.sources.some((x) => x.chatId === s.chatId)) cur.sources.push(s);
      }
      for (const l of saved.links) if (!T.links.some((x) => x.id === l.id)) T.links.push(l);
      T.graphRev += 1;
    };
  },
});

function dropIdeas(ids: string[]) {
  if (!ids.length) return;
  const gone = new Set(ids);
  T.ideas = T.ideas.filter((i) => !gone.has(i.id));
  T.links = T.links.filter((l) => !gone.has(l.conclusionId) && !l.premiseIds.some((p) => gone.has(p)));
  T.graphRev += 1;
}

// ───────────────────────────── handlers ─────────────────────────────

const chatNotFound = () => notFound("Chat");
const questionNotFound = () => problem(404, "not_found", "This question doesn't exist.");
const id = (p: unknown) => String(p);

export const handlers: HttpHandler[] = [
  http.get(`${API}/sessions/:key/teacher-chats`, ({ params }) => {
    const key = id(params.key);
    if (!getSession(key)) return notFound("Session");
    const list = T.chats.filter((c) => c.sessionKey === key && !T.deleted.has(c.summary.id));
    list.sort((a, b) => b.summary.updatedAt.localeCompare(a.summary.updatedAt));
    return json(list.map(teacherSummary));
  }),

  http.post(`${API}/sessions/:key/teacher-chats`, async ({ params, request }) => {
    const key = id(params.key);
    if (!getSession(key)) return notFound("Session");
    const body = await readJson<Body<"/api/v1/sessions/{session_key}/teacher-chats", "post">>(request);
    const kind = body.kind === "practice" ? "practice" : "lesson";
    const text = (body.text ?? "").trim();
    const known = new Set(T.ideas.map((i) => i.id));
    const ideaSet = body.ideaIds ? body.ideaIds.filter((i) => known.has(i)) : [...known];
    const at = nowIso();
    const c: TeacherChat = {
      summary: {
        id: newId("teacher"),
        kind,
        title: text ? text.slice(0, 60) : kind === "lesson" ? "New lesson" : "New practice",
        createdAt: at,
        updatedAt: at,
        unseenAnswer: false,
        modelLabel: DEMO_MODEL_LABEL,
        version: 1,
      },
      sessionKey: key,
      topic: body.topic?.trim() || null,
      turns: [],
      questions: [],
      plans: [],
      ideaSet,
      graph: { status: null, pendingTurns: 0 },
    };
    T.chats.push(c);
    return launch(
      c,
      { text: body.text ?? "", action: null, target: null, attachments: body.attachments ?? [] },
      { text: kind === "lesson" ? TEACHER.lessonIntro : TEACHER.practiceIntro, questions: kind === "lesson" ? TEACHER.questions : TEACHER.practiceQuestions, plan: kind === "lesson" ? TEACHER.plan : undefined },
      [],
      201,
    );
  }),

  http.get(`${API}/teacher-chats/:id`, ({ params }) => {
    const c = findTeacherChat(id(params.id));
    return c ? json(view(c)) : chatNotFound();
  }),

  http.patch(`${API}/teacher-chats/:id`, async ({ params, request }) => {
    const c = findTeacherChat(id(params.id));
    if (!c) return chatNotFound();
    const conflict = checkIfMatch(request, c.summary);
    if (conflict) return conflict;
    const body = await readJson<Body<"/api/v1/teacher-chats/{chat_id}", "patch">>(request);
    const title = (body.title ?? "").split(/\s+/).filter(Boolean).join(" ");
    if (!title) return validation("title", "Enter a title.", "title_required");
    c.summary.title = title;
    bump(c.summary);
    return json(teacherSummary(c));
  }),

  http.post(`${API}/teacher-chats/:id/messages`, async ({ params, request }) => {
    const c = findTeacherChat(id(params.id));
    if (!c) return chatNotFound();
    const body = await readJson<Body<"/api/v1/teacher-chats/{chat_id}/messages", "post">>(request);
    if (!body.text?.trim() && !body.attachments?.length) return problem(422, "empty_message", "Type a message or attach something to send.");
    const plan = c.summary.kind === "lesson" ? { ...TEACHER.plan, current: "mt" } : undefined;
    return launch(c, { text: body.text, action: null, target: null, attachments: body.attachments ?? [] }, { text: TEACHER.followUp, plan });
  }),

  http.post(`${API}/teacher-chats/:id/answers`, async ({ params, request }) => {
    const c = findTeacherChat(id(params.id));
    if (!c) return chatNotFound();
    if (activeRunFor(c.summary.id)) return problem(409, "run_active", "An answer is still being generated in this chat.");
    const body = await readJson<Body<"/api/v1/teacher-chats/{chat_id}/answers", "post">>(request);
    const at = nowIso();
    const items = body.answers ?? [];
    // validate everything first, so a bad item changes nothing
    const seen = new Set<string>();
    for (const item of items) {
      const q = c.questions.find((x) => x.id === item.questionId);
      if (!q) return questionNotFound();
      if (q.submission || seen.has(q.id)) return problem(409, "already_answered", "This question was already answered.");
      seen.add(q.id);
      if (item.dontKnow) continue;
      if (q.kind === "choice") {
        if (item.choice == null) return validation("answers", "Choose one of the options.", "wrong_answer_kind");
        if (item.choice >= (q.options?.length ?? 0)) return validation("answers", "That option doesn't exist.", "option_out_of_range");
      } else if (item.text == null) return validation("answers", "Write an answer.", "wrong_answer_kind");
    }
    const graded: Question[] = [];
    const grades: ScriptGrade[] = [];
    for (const item of items) {
      const q = c.questions.find((x) => x.id === item.questionId)!;
      q.submission = {
        ...(item.choice != null ? { choice: item.choice } : {}),
        ...(item.text != null ? { text: item.text } : {}),
        confidence: item.confidence ?? null,
        dontKnow: !!item.dontKnow,
        thinking: item.thinking ?? "",
        submittedAt: at,
      };
      if (item.dontKnow || q.kind === "choice") {
        const ok = !item.dontKnow && item.choice === q.key;
        q.grades.push({ grade: ok ? "correct" : "incorrect", feedback: "", by: "server", disputeReason: null, at });
        graded.push(q);
      } else {
        const good = (item.text ?? "").trim().length >= 40;
        grades.push({
          questionId: q.id,
          grade: good ? "correct" : "partly",
          feedback: good ? "Well explained." : "On the right track — say why the work per level stays the same.",
          by: "teacher",
          at,
        });
      }
    }
    const text = `Answers to ${items.length} question${items.length === 1 ? "" : "s"}`;
    return launch(c, { text, action: "answers", target: null, attachments: [] }, { text: TEACHER.feedback, grades }, graded);
  }),

  http.post(`${API}/teacher-chats/:id/questions/:qid/dispute`, async ({ params, request }) => {
    const c = findTeacherChat(id(params.id));
    if (!c) return chatNotFound();
    const q = c.questions.find((x) => x.id === id(params.qid));
    if (!q) return questionNotFound();
    if (!q.submission) return problem(409, "not_answered", "Answer this question first.");
    const body = await readJson<Body<"/api/v1/teacher-chats/{chat_id}/questions/{question_id}/dispute", "post">>(request);
    const reason = (body.reason ?? "").trim();
    const grades: ScriptGrade[] = [
      { questionId: q.id, grade: "correct", feedback: "Updated after your dispute.", by: "teacher", disputeReason: reason || null, at: nowIso() },
    ];
    return launch(c, { text: `I disagree with the grade on "${q.title}". ${reason}`.trim(), action: "dispute", target: q.id, attachments: [] }, { text: TEACHER.disputeReply, grades });
  }),

  http.post(`${API}/teacher-chats/:id/questions/:qid/hint`, ({ params }) => {
    const c = findTeacherChat(id(params.id));
    if (!c) return chatNotFound();
    const q = c.questions.find((x) => x.id === id(params.qid));
    if (!q) return questionNotFound();
    if (!q.practice) return problem(409, "not_practice", "Hints are for practice problems.");
    if (q.submission) return problem(409, "already_answered", "This problem was already answered.");
    return launch(c, { text: `Can I have a hint for "${q.title}"?`, action: "hint", target: q.id, attachments: [] }, { text: TEACHER.hintReply, hint: { questionId: q.id, text: TEACHER.hint } });
  }),

  http.post(`${API}/teacher-chats/:id/questions/:qid/reveal`, ({ params }) => {
    const c = findTeacherChat(id(params.id));
    if (!c) return chatNotFound();
    const q = c.questions.find((x) => x.id === id(params.qid));
    if (!q) return questionNotFound();
    if (!q.practice) return problem(409, "not_practice", "Only practice solutions can be revealed.");
    q.revealed = true;
    return json(questionOut(q));
  }),

  http.post(`${API}/teacher-chats/:id/malformed/:sid/retry`, ({ params }) => {
    const c = findTeacherChat(id(params.id));
    if (!c) return chatNotFound();
    const sid = id(params.sid);
    // the demo's canned replies never contain malformed blocks; kept for the contract's 404
    if (!c.turns.some((t) => t.answer.segments.some((s) => s.type === "malformed" && s.id === sid))) return questionNotFound();
    return launch(c, { text: "Please send that question again.", action: "retry", target: sid, attachments: [] }, { text: TEACHER.followUp });
  }),

  http.put(`${API}/teacher-chats/:id/idea-set`, async ({ params, request }) => {
    const c = findTeacherChat(id(params.id));
    if (!c) return chatNotFound();
    const body = await readJson<Body<"/api/v1/teacher-chats/{chat_id}/idea-set", "put">>(request);
    const ids = [...new Set(body.ideaIds ?? [])];
    if (ids.length > 30) return validation("ideaIds", "A chat can start from at most 30 ideas.", "too_many_ideas");
    if (ids.some((i) => !T.ideas.some((x) => x.id === i))) return notFound("Idea");
    c.ideaSet = ids;
    return json(T.ideas.filter((i) => ids.includes(i.id)).map(ideaSummary));
  }),

  http.post(`${API}/teacher-chats/:id/graph-update`, ({ params }) => {
    const c = findTeacherChat(id(params.id));
    if (!c) return chatNotFound();
    if (c.summary.kind !== "lesson") return problem(409, "not_lesson", "Only lessons add ideas to the knowledge graph.");
    c.graph = { status: "ok", pendingTurns: 0 };
    return json(c.graph, 202);
  }),

  http.get(`${API}/teacher-chats/:id/graph-impact`, ({ params }) => {
    const c = findTeacherChat(id(params.id));
    if (!c) return chatNotFound();
    return json<Schemas["GraphImpact"]>({ ideas: T.ideas.filter((i) => i.sources.some((s) => s.chatId === c.summary.id)).length });
  }),

  http.get(`${API}/teacher/instructions`, () => json<Schemas["Instructions"]>(TEACHER.instructions)),

  http.get(`${API}/knowledge-graph`, () =>
    json<Schemas["GraphOut"]>({
      version: `demo-${T.graphRev}-${T.ideas.length}-${T.links.length}`,
      ideas: [...T.ideas].sort((a, b) => a.name.localeCompare(b.name)).map(ideaSummary),
      links: T.links,
    }),
  ),

  http.get(`${API}/knowledge-graph/ideas`, ({ request }) => {
    const u = new URL(request.url).searchParams;
    const q = (u.get("q") ?? "").trim().toLowerCase();
    const course = u.get("courseId");
    const limit = Number(u.get("limit") ?? 50) || 50;
    let list = T.ideas.filter(
      (i) => (!q || `${i.name} ${i.statement}`.toLowerCase().includes(q)) && (!course || i.courseIds.includes(course)),
    );
    list = u.get("sort") === "recent" ? list.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)) : list.sort((a, b) => a.name.localeCompare(b.name));
    return json(list.slice(0, limit).map(ideaSummary));
  }),

  http.get(`${API}/knowledge-graph/ideas/:id`, ({ params }) => {
    const idea = T.ideas.find((i) => i.id === id(params.id));
    if (!idea) return notFound("Idea");
    const byId = (x: string) => T.ideas.find((i) => i.id === x);
    const detail: Schemas["IdeaDetail"] = {
      ...ideaSummary(idea),
      followsFrom: T.links
        .filter((l) => l.conclusionId === idea.id)
        .map((l) => ({ linkId: l.id, premises: l.premiseIds.map(byId).filter((x): x is Idea => !!x).map(ideaSummary) })),
      leadsTo: T.links
        .filter((l) => l.premiseIds.includes(idea.id))
        .flatMap((l) => {
          const c = byId(l.conclusionId);
          return c ? [{ linkId: l.id, conclusion: ideaSummary(c) }] : [];
        }),
      sources: idea.sources.map((s) => ({ ...s, available: !!findTeacherChat(s.chatId) })),
    };
    return json(detail);
  }),

  http.delete(`${API}/knowledge-graph/ideas/:id`, ({ params }) => {
    const ideaId = id(params.id);
    if (!T.ideas.some((i) => i.id === ideaId)) return notFound("Idea");
    dropIdeas([ideaId]);
    for (const c of T.chats) c.ideaSet = c.ideaSet.filter((i) => i !== ideaId);
    return new Response(null, { status: 204 });
  }),
];
