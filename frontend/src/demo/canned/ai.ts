/**
 * 024: canned AI texts for the demo (research R5): chat replies picked by keyword, the teacher's
 * lesson pieces and the sample knowledge graph. Every reply ends with the demo line (FR-008).
 */
export const DEMO_LINE = "_(Demo answer — connect your own AI provider in the app.)_";

/** The one AI endpoint and model the demo offers (no key; it is "ready" out of the box). */
export const DEMO_AI = {
  endpointId: "demo-ai",
  modelId: "demo-model",
  endpointLabel: "Demo AI",
  modelLabel: "Demo Tutor",
  locality: "remote" as const,
};
export const DEMO_MODEL_LABEL = `${DEMO_AI.endpointLabel} · ${DEMO_AI.modelLabel}`;

const withLine = (body: string) => `${body.trim()}\n\n${DEMO_LINE}`;

const SUMMARY = withLine(`
## Summary: divide and conquer

**Divide and conquer** solves a problem in three steps:

1. **Divide** the input into smaller subproblems of the same kind.
2. **Conquer** each subproblem recursively (small ones are solved directly).
3. **Combine** the sub-results into the answer for the whole input.

**Merge sort** is the classic example: split the array in half, sort both halves, then merge
them in linear time. Its running time follows the recurrence

$$T(n) = 2T(n/2) + \\Theta(n)$$

which the **master theorem** solves to $T(n) = \\Theta(n \\log n)$.

**Key takeaways**
- The cost lives in the *combine* step and in how many subproblems you create.
- Recurrences describe that cost; the master theorem or a recursion tree solves them.
`);

const EXPLAIN = withLine(`
## Why merge sort is $\\Theta(n \\log n)$

Think of the **recursion tree**:

- The root does $n$ work merging two halves.
- The next level has 2 calls, each merging $n/2$ elements — again $n$ in total.
- Every level costs $n$, and halving $n$ until it reaches 1 takes $\\log_2 n$ levels.

So the total is $n \\cdot \\log_2 n$. In master-theorem terms: $a = 2$, $b = 2$, $f(n) = \\Theta(n)$,
and $n^{\\log_b a} = n$, so we are in **case 2** and get $\\Theta(n \\log n)$.

> Intuition: the work per level stays the same, so the height of the tree decides the cost.
`);

const QUIZ = withLine(`
## Quick quiz: recurrences

1. Solve $T(n) = 2T(n/2) + n$.
2. Solve $T(n) = 4T(n/2) + n$.
3. Solve $T(n) = T(n/2) + 1$. Which algorithm has this recurrence?
4. Why can't the master theorem solve $T(n) = 2T(n/2) + n \\log n$ with the basic three cases?

<details>
<summary>Answers</summary>

1. $\\Theta(n \\log n)$ — case 2.
2. $\\Theta(n^2)$ — case 1, the leaves dominate.
3. $\\Theta(\\log n)$ — binary search.
4. $f(n)$ is larger than $n$ but not *polynomially* larger, so it falls between cases 2 and 3.

</details>
`);

const EXAMPLE = withLine(`
## Example: merge sort on \`[38, 27, 43, 3]\`

\`\`\`text
[38, 27, 43, 3]
 ├─ [38, 27]  → [27, 38]
 └─ [43, 3]   → [3, 43]
merge([27, 38], [3, 43]) → [3, 27, 38, 43]
\`\`\`

\`\`\`python
def merge_sort(a):
    if len(a) <= 1:
        return a
    mid = len(a) // 2
    left, right = merge_sort(a[:mid]), merge_sort(a[mid:])
    out, i, j = [], 0, 0
    while i < len(left) and j < len(right):
        if left[i] <= right[j]:
            out.append(left[i]); i += 1
        else:
            out.append(right[j]); j += 1
    return out + left[i:] + right[j:]
\`\`\`

Each merge walks both halves once, which is where the $\\Theta(n)$ per level comes from.
`);

const EIGEN = withLine(`
## Eigenvalues in one page

A nonzero vector $v$ is an **eigenvector** of $A$ when $Av = \\lambda v$; the scalar $\\lambda$ is
its **eigenvalue**. To find them, solve the **characteristic equation**

$$\\det(A - \\lambda I) = 0.$$

**Example.** For $A = \\begin{pmatrix} 2 & 1 \\\\ 1 & 2 \\end{pmatrix}$:
$\\det(A - \\lambda I) = (2-\\lambda)^2 - 1 = 0$, so $\\lambda = 1$ or $\\lambda = 3$, with eigenvectors
$(1, -1)$ and $(1, 1)$.

- The eigenvalues' sum is the **trace** (here 4), their product the **determinant** (here 3).
- A symmetric matrix always has real eigenvalues and orthogonal eigenvectors.
`);

const DEFAULT = withLine(`
Good question! Here is how I would approach it for this class:

- Start from the **definition** and write it down in your own words.
- Work through **one small example** by hand (an array of 4 elements is plenty).
- Connect it to the **big idea** of the course: break a problem into smaller ones, then count the
  work with a recurrence.

If you tell me which part is unclear — the idea, the proof or the code — I can go deeper.
`);

/** A reply for the question, by keyword (research R5). */
export function chatReply(question: string): string {
  const q = question.toLowerCase();
  if (q.includes("eigen")) return EIGEN;
  if (q.includes("summar")) return SUMMARY;
  if (q.includes("quiz") || q.includes("test me")) return QUIZ;
  if (q.includes("example")) return EXAMPLE;
  if (q.includes("explain") || q.includes("why")) return EXPLAIN;
  return DEFAULT;
}

/** The seeded chat's conversation. */
export const SEED_CHAT = {
  title: "Summarize divide and conquer",
  turns: [
    { question: "Summarize today's lecture on divide and conquer.", answer: SUMMARY },
    { question: "Can you show an example of merge sort?", answer: EXAMPLE },
  ],
};

// ───────────────────────────── teacher ─────────────────────────────

export interface CannedQuestion {
  kind: "choice" | "text";
  title: string;
  prompt: string;
  options?: string[];
  key: number | string;
  explanation: string;
  practice: boolean;
}

export const TEACHER = {
  lessonIntro: `
Let's build up **divide and conquer** step by step. First, the recurrence behind merge sort:
it makes two calls on halves and merges in linear time, so $T(n) = 2T(n/2) + \\Theta(n)$.

Try the two questions below before we move on.`,
  practiceIntro: `
Here are two practice problems on recurrences. Take your time — you can ask for a hint on
either of them.`,
  followUp: `
Nice work so far. The next step in the plan is the **master theorem**: compare $f(n)$ with
$n^{\\log_b a}$ to see whether the leaves, every level, or the root dominate the cost.`,
  feedback: `
Thanks — I've graded your answers. Look at the feedback on each card, and ask me about anything
that still feels shaky.`,
  disputeReply: `
Fair point — re-reading your answer, the reasoning holds. I've updated the grade.`,
  hint: "Count the work on one level of the recursion tree, then count the levels.",
  hintReply: `
Here's a nudge: draw the recursion tree and add up the work level by level.`,
  plan: {
    mermaid: "flowchart TD\n  dc[Divide and conquer] --> ms[Merge sort]\n  ms --> rec[Recurrences]\n  rec --> mt[Master theorem]",
    current: "rec",
  },
  questions: [
    {
      kind: "choice",
      title: "Merge sort recurrence",
      prompt: "Which recurrence describes merge sort's running time?",
      options: ["T(n) = T(n-1) + n", "T(n) = 2T(n/2) + n", "T(n) = T(n/2) + 1", "T(n) = 4T(n/2) + n"],
      key: 1,
      explanation: "Two recursive calls on halves, plus a linear-time merge.",
      practice: false,
    },
    {
      kind: "text",
      title: "Why n log n?",
      prompt: "In one or two sentences: why does merge sort take Θ(n log n) time?",
      key: "Every level of the recursion tree does Θ(n) merging work and there are log n levels.",
      explanation: "The work per level is constant (n) and the tree has log₂ n levels.",
      practice: false,
    },
  ] satisfies CannedQuestion[],
  practiceQuestions: [
    {
      kind: "text",
      title: "Solve a recurrence",
      prompt: "Solve T(n) = 4T(n/2) + n and name the master-theorem case.",
      key: "Θ(n²) — case 1, since n^(log₂ 4) = n² grows faster than f(n) = n.",
      explanation: "a = 4, b = 2 gives n^(log_b a) = n², which dominates f(n) = n.",
      practice: true,
    },
    {
      kind: "choice",
      title: "Binary search",
      prompt: "Which recurrence does binary search follow?",
      options: ["T(n) = 2T(n/2) + 1", "T(n) = T(n/2) + 1", "T(n) = T(n-1) + 1"],
      key: 1,
      explanation: "One recursive call on half the input and constant extra work.",
      practice: true,
    },
  ] satisfies CannedQuestion[],
  instructions: {
    lesson:
      "You are a patient university teacher. Explain one idea at a time, check understanding with short questions, and keep a plan of the lesson.",
    practice:
      "You are a practice coach. Give problems one at a time, grade answers fairly, and offer hints that do not give the answer away.",
    extraction: "List the ideas taught in this lesson as short, self-contained statements, and how they follow from each other.",
  },
};

/** The sample knowledge graph: [key, name, statement]. */
export const IDEAS: [string, string, string][] = [
  ["dc", "Divide and conquer", "Split a problem into smaller subproblems of the same kind, solve them recursively and combine the results."],
  ["ms", "Merge sort", "Sort by splitting the array in half, sorting both halves and merging them in linear time."],
  ["rec", "Recurrence relation", "A recursive algorithm's running time can be written as T(n) in terms of T on smaller inputs."],
  ["tree", "Recursion tree", "Summing the work level by level of the call tree solves a recurrence."],
  ["mt", "Master theorem", "T(n) = aT(n/b) + f(n) is solved by comparing f(n) with n^(log_b a)."],
  ["nlogn", "Merge sort is Θ(n log n)", "Each of the log n levels of merge sort does Θ(n) merging work."],
];

/** Links: premises → conclusion. */
export const IDEA_LINKS: [string[], string][] = [
  [["dc"], "ms"],
  [["dc"], "rec"],
  [["rec"], "tree"],
  [["rec"], "mt"],
  [["ms", "tree"], "nlogn"],
];
