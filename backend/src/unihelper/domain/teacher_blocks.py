"""Split a teacher reply into prose and `uh-*` blocks while it streams (022 research R2, R3).

Contract: `specs/022-ai-teacher/contracts/teacher-blocks.md`. Pure: no I/O, no app imports.

A block opens with a line that is exactly ```` ```uh-<type> ```` and closes with the next line
that is exactly ```` ``` ````; its body is one JSON object. Prose passes through as soon as it is
known not to start a block (at most the current line is held), so streaming stays smooth and
block bodies — which hold answer keys — never leak as prose.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

BLOCK_TYPES = ("question", "grade", "plan", "hint")
GRADES = ("correct", "partly", "incorrect")
MAX_BLOCK_CHARS = 20_000
MAX_QUESTIONS = 20
MAX_PROMPT = 4000
MAX_TITLE = 80

_OPENERS = tuple(f"```uh-{t}" for t in BLOCK_TYPES)
_OPEN_RE = re.compile(r"```uh-(question|grade|plan|hint)[ \t]*")
_MARKUP_RE = re.compile(r"[*_`#>\[\]]+")


@dataclass(frozen=True)
class Prose:
    text: str


@dataclass(frozen=True)
class Block:
    type: str
    payload: dict[str, Any]
    index: int = 0  # questions only: position among this reply's valid questions


@dataclass(frozen=True)
class Malformed:
    id: str
    reason: str
    raw: str


Piece = Prose | Block | Malformed


class BlockError(ValueError):
    def __init__(self, reason: str) -> None:
        super().__init__(reason)
        self.reason = reason


def _could_open(partial: str) -> bool:
    """True while the start of a line may still turn out to be a block opener."""
    for opener in _OPENERS:
        if opener.startswith(partial):
            return True
        if partial.startswith(opener) and not partial[len(opener) :].strip(" \t"):
            return True
    return False


def plain_title(prompt: str) -> str:
    return " ".join(_MARKUP_RE.sub("", prompt).split())[:MAX_TITLE]


def _text(payload: dict[str, Any], key: str, limit: int, required: bool = True) -> str | None:
    value = payload.get(key)
    if value is None and not required:
        return None
    if not isinstance(value, str) or not value.strip():
        raise BlockError(f"missing_{key}")
    if len(value) > limit:
        raise BlockError(f"{key}_too_long")
    return value


def validate(kind: str, payload: Any) -> dict[str, Any]:
    """The normalized payload of one block, or BlockError with a short reason."""
    if not isinstance(payload, dict):
        raise BlockError("not_an_object")
    if kind == "question":
        q_kind = payload.get("kind")
        if q_kind not in ("choice", "text"):
            raise BlockError("bad_kind")
        prompt = _text(payload, "prompt", MAX_PROMPT)
        assert prompt is not None
        title = payload.get("title")
        out: dict[str, Any] = {
            "kind": q_kind,
            "title": (
                title.strip()[:MAX_TITLE]
                if isinstance(title, str) and title.strip()
                else plain_title(prompt)
            ),
            "prompt": prompt,
        }
        explanation = payload.get("explanation")
        if isinstance(explanation, str) and explanation.strip():
            out["explanation"] = explanation
        if q_kind == "choice":
            options = payload.get("options")
            if not isinstance(options, list) or not 2 <= len(options) <= 8:
                raise BlockError("bad_options")
            if not all(isinstance(o, str) and o.strip() for o in options):
                raise BlockError("bad_options")
            if len({o.strip().casefold() for o in options}) != len(options):
                raise BlockError("duplicate_options")
            answer = payload.get("answer")
            if not isinstance(answer, int) or isinstance(answer, bool):
                raise BlockError("bad_answer")
            if not 0 <= answer < len(options):
                raise BlockError("answer_out_of_range")
            out["options"] = [o.strip() for o in options]
            out["key"] = answer
        else:  # a probing question may have no single right answer: the teacher grades it
            solution = payload.get("solution")
            if solution is not None and not isinstance(solution, str):
                raise BlockError("bad_solution")
            if solution and len(solution) > MAX_BLOCK_CHARS:
                raise BlockError("solution_too_long")
            out["key"] = solution or ""
        return out
    if kind == "grade":
        question = _text(payload, "question", 20)
        grade = payload.get("grade")
        if grade not in GRADES:
            raise BlockError("bad_grade")
        feedback = payload.get("feedback")
        return {
            "question": question,
            "grade": grade,
            "feedback": feedback if isinstance(feedback, str) else "",
        }
    if kind == "plan":
        mermaid = _text(payload, "mermaid", MAX_BLOCK_CHARS)
        current = payload.get("current")
        if current is not None and not isinstance(current, str):
            raise BlockError("bad_current")
        return {"mermaid": mermaid, "current": current or None}
    if kind == "hint":
        return {
            "question": _text(payload, "question", 20),
            "text": _text(payload, "text", MAX_PROMPT),
        }
    raise BlockError("unknown_block")


class BlockSplitter:
    """Feed streamed text; get prose and parsed blocks back in text order.

    `prefix` makes malformed ids unique per chat (use the answer id): the same raw text always
    yields the same ids, so `segments_of` on read matches what the stream emitted.
    """

    def __init__(self, prefix: str) -> None:
        self._prefix = prefix
        self._line = ""  # the current, unfinished line
        self._emitted = 0  # chars of `_line` already sent as prose
        self._block: str | None = None  # open uh-* block type
        self._body: list[str] = []
        self._opener = ""
        self._size = 0
        self._prose_fence = False  # inside an ordinary ``` code block
        self._questions = 0
        self._malformed = 0

    # ---- public ----

    def feed(self, text: str) -> list[Piece]:
        out: list[Piece] = []
        self._line += text
        while (cut := self._line.find("\n")) >= 0:
            line, self._line = self._line[: cut + 1], self._line[cut + 1 :]
            emitted, self._emitted = self._emitted, 0
            out += self._complete(line, emitted)
        if self._block is None and self._line:
            if self._emitted or self._prose_fence or not _could_open(self._line):
                if len(self._line) > self._emitted:
                    out.append(Prose(self._line[self._emitted :]))
                    self._emitted = len(self._line)
        return _merge(out)

    def close(self) -> list[Piece]:
        """End of the stream (completed, stopped, failed or interrupted)."""
        out: list[Piece] = []
        if self._block is not None and self._line.strip(" \t\r") == "```":
            out.append(self._finish(self._line))  # the closing fence ended the stream
        elif self._block is not None:
            body = "".join(self._body) + self._line
            out.append(self._bad("unterminated", self._opener + body))
            self._block = None
        elif len(self._line) > self._emitted:
            out.append(Prose(self._line[self._emitted :]))
        self._line, self._emitted = "", 0
        return _merge(out)

    # ---- internals ----

    def _bad(self, reason: str, raw: str) -> Malformed:
        self._malformed += 1
        return Malformed(f"{self._prefix}-m{self._malformed}", reason, raw)

    def _complete(self, line: str, emitted: int) -> list[Piece]:
        bare = line.rstrip("\r\n")
        if self._block is not None:
            if bare.rstrip(" \t") == "```":
                return [self._finish(line)]
            self._body.append(line)
            self._size += len(line)
            return []
        if not emitted and not self._prose_fence and _OPEN_RE.fullmatch(bare):
            self._block = bare.rstrip(" \t")[len("```uh-") :]
            self._opener, self._body, self._size = line, [], 0
            return []
        stripped = bare.strip()
        if stripped.startswith("```"):
            if not self._prose_fence:
                self._prose_fence = True
            elif stripped.strip("`") == "":
                self._prose_fence = False
        return [Prose(line[emitted:])] if len(line) > emitted else []

    def _finish(self, closer: str) -> Piece:
        kind, body = self._block, "".join(self._body)
        assert kind is not None
        self._block = None
        raw = self._opener + body + closer
        if self._size > MAX_BLOCK_CHARS:
            return self._bad("too_large", raw)
        if kind == "question" and self._questions >= MAX_QUESTIONS:
            return self._bad("too_many", raw)
        try:
            payload = validate(kind, json.loads(body))
        except json.JSONDecodeError:
            return self._bad("invalid_json", raw)
        except BlockError as err:
            return self._bad(err.reason, raw)
        index = 0
        if kind == "question":
            index = self._questions
            self._questions += 1
        return Block(kind, payload, index)


def _merge(pieces: list[Piece]) -> list[Piece]:
    out: list[Piece] = []
    for p in pieces:
        if isinstance(p, Prose) and out and isinstance(out[-1], Prose):
            out[-1] = Prose(out[-1].text + p.text)
        elif not (isinstance(p, Prose) and not p.text):
            out.append(p)
    return out


def segments_of(raw: str, prefix: str) -> list[Piece]:
    """The pieces of a saved reply — identical to what streaming it produced."""
    splitter = BlockSplitter(prefix)
    return _merge(splitter.feed(raw) + splitter.close())
