"""022 T010: the streaming splitter of teacher replies (contracts/teacher-blocks.md)."""

from __future__ import annotations

import json

import pytest

from unihelper.domain.teacher_blocks import (
    Block,
    BlockSplitter,
    Malformed,
    Piece,
    Prose,
    plain_title,
    segments_of,
)

pytestmark = pytest.mark.unit

CHOICE = {
    "kind": "choice",
    "title": "Zero determinant",
    "prompt": "If det(A) = 0, what follows?",
    "options": ["A is invertible", "A has a non-trivial null space", "A is diagonal"],
    "answer": 1,
    "explanation": "Dependent columns.",
}


def block(kind: str, payload: object) -> str:
    return f"```uh-{kind}\n{json.dumps(payload)}\n```\n"


def stream(text: str, size: int) -> list[Piece]:
    s = BlockSplitter("a1")
    out: list[Piece] = []
    for i in range(0, len(text), size):
        out += s.feed(text[i : i + size])
    return _merge_prose(out + s.close())


def _merge_prose(pieces: list[Piece]) -> list[Piece]:
    out: list[Piece] = []
    for p in pieces:
        if isinstance(p, Prose) and out and isinstance(out[-1], Prose):
            out[-1] = Prose(out[-1].text + p.text)
        else:
            out.append(p)
    return out


def prose(pieces: list[Piece]) -> str:
    return "".join(p.text for p in pieces if isinstance(p, Prose))


@pytest.mark.parametrize("size", [1, 3, 7, 1000])
def test_block_split_across_deltas_never_leaks(size: int) -> None:
    text = "Let us check.\n" + block("question", CHOICE) + "Take your time.\n"
    pieces = stream(text, size)
    assert prose(pieces) == "Let us check.\nTake your time.\n"
    blocks = [p for p in pieces if isinstance(p, Block)]
    assert len(blocks) == 1 and blocks[0].type == "question"
    assert blocks[0].payload["key"] == 1
    assert "non-trivial" not in prose(pieces)
    assert pieces == segments_of(text, "a1")


def test_prose_streams_without_waiting_for_newline() -> None:
    s = BlockSplitter("a1")
    assert s.feed("Hello wor") == [Prose("Hello wor")]
    assert s.feed("ld\n") == [Prose("ld\n")]
    assert s.feed("``") == []  # a new line that could open a block: held
    assert s.feed("`py") == [Prose("```py")]
    assert s.feed(" x ``") == [Prose(" x ``")]  # mid-line backticks are prose


def test_mermaid_and_ordinary_fences_pass_through() -> None:
    text = "```mermaid\ngraph TD\n a --> b\n```\nAnd code:\n```\n```uh-question\n```\n"
    pieces = stream(text, 4)
    assert prose(pieces) == text
    assert not any(isinstance(p, Block | Malformed) for p in pieces)


def test_unterminated_block_at_stop() -> None:
    s = BlockSplitter("a1")
    out = s.feed('Before.\n```uh-question\n{"kind": "choice", "prompt": "x')
    out += s.close()
    assert prose(out) == "Before.\n"
    bad = [p for p in out if isinstance(p, Malformed)]
    assert [b.reason for b in bad] == ["unterminated"]
    assert bad[0].id == "a1-m1"


@pytest.mark.parametrize(
    ("payload", "reason"),
    [
        ({**CHOICE, "options": ["only one"], "answer": 0}, "bad_options"),
        ({**CHOICE, "options": ["Yes", " yes", "No"]}, "duplicate_options"),
        ({**CHOICE, "answer": 3}, "answer_out_of_range"),
        ({**CHOICE, "answer": True}, "bad_answer"),
        ({**CHOICE, "kind": "multi"}, "bad_kind"),
        ({"kind": "text", "prompt": "Why?", "solution": 3}, "bad_solution"),
        ({"kind": "text", "prompt": "", "solution": "x"}, "missing_prompt"),
    ],
)
def test_invalid_questions_are_malformed(payload: dict[str, object], reason: str) -> None:
    pieces = segments_of(block("question", payload), "a2")
    assert pieces == [Malformed("a2-m1", reason, block("question", payload))]


def test_invalid_json() -> None:
    raw = "```uh-question\n{kind: choice,}\n```\n"
    assert segments_of(raw, "a") == [Malformed("a-m1", "invalid_json", raw)]


def test_too_many_questions() -> None:
    text = "".join(block("question", {**CHOICE, "title": f"Q{i}"}) for i in range(21))
    pieces = segments_of(text, "a")
    assert [p.index for p in pieces if isinstance(p, Block)] == list(range(20))
    assert [p.reason for p in pieces if isinstance(p, Malformed)] == ["too_many"]


def test_too_large_block() -> None:
    big = {"kind": "text", "prompt": "x", "solution": "y" * 21_000}
    assert [p.reason for p in segments_of(block("question", big), "a")] == ["too_large"]


def test_grade_plan_hint_blocks() -> None:
    text = (
        block("grade", {"question": "q3", "grade": "partly", "feedback": "Close."})
        + block("plan", {"mermaid": "graph TD\n a --> b", "current": "b"})
        + block("hint", {"question": "q5", "text": "Double a column."})
        + block("grade", {"question": "q3", "grade": "great"})
    )
    pieces = segments_of(text, "a")
    assert [(p.type, p.payload) for p in pieces if isinstance(p, Block)] == [
        ("grade", {"question": "q3", "grade": "partly", "feedback": "Close."}),
        ("plan", {"mermaid": "graph TD\n a --> b", "current": "b"}),
        ("hint", {"question": "q5", "text": "Double a column."}),
    ]
    assert [p.reason for p in pieces if isinstance(p, Malformed)] == ["bad_grade"]


def test_text_question_and_default_title() -> None:
    payload = {
        "kind": "text",
        "prompt": "**Explain** the chain rule in `one` line",
        "solution": "s",
    }
    [piece] = segments_of(block("question", payload), "a")
    assert isinstance(piece, Block)
    assert piece.payload == {
        "kind": "text",
        "title": "Explain the chain rule in one line",
        "prompt": payload["prompt"],
        "key": "s",
    }
    assert plain_title("# " + "w" * 100) == "w" * 80


def test_crlf_and_trailing_spaces_on_fences() -> None:
    text = "Hi\r\n```uh-question  \r\n" + json.dumps(CHOICE) + "\r\n```  \r\nBye"
    pieces = stream(text, 5)
    assert prose(pieces) == "Hi\r\nBye"
    assert [p.type for p in pieces if isinstance(p, Block)] == ["question"]


def test_closing_fence_at_the_very_end_of_the_stream() -> None:
    """Seen with a real model: the reply ends right after the closing fence (no newline)."""
    text = "Check.\n" + block("question", CHOICE).rstrip("\n")
    for size in (1, 5, 1000):
        pieces = stream(text, size)
        assert [p.type for p in pieces if isinstance(p, Block)] == ["question"]
        assert not [p for p in pieces if isinstance(p, Malformed)]


def test_text_question_without_solution() -> None:
    """A probing question has no single right answer: an empty or missing solution is fine."""
    for payload in (
        {"kind": "text", "prompt": "What do you know?"},
        {"kind": "text", "prompt": "What do you know?", "solution": ""},
    ):
        [piece] = segments_of(block("question", payload), "a")
        assert isinstance(piece, Block) and piece.payload["key"] == ""
