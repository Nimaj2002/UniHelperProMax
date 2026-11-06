"""AI teacher requests and responses (022 contracts/openapi.yaml).

Routes answer with `response_model_exclude_unset=True`: a question's `key` and `explanation`
are left out (not null) while they are withheld (FR-018, FR-041).
"""

from __future__ import annotations

from typing import Literal

from pydantic import Field

from unihelper.schemas.ai import Locality, ModelRef
from unihelper.schemas.chat import AnswerStatus, ContextItemRef, ErrorCategory, SendMessage
from unihelper.schemas.common import ApiModel

TeacherKind = Literal["lesson", "practice"]
Confidence = Literal[0, 25, 50, 75, 100]  # percent, in the slider's fixed steps
Grade = Literal["correct", "partly", "incorrect"]
QuestionStatus = Literal["unanswered", "submitted", "correct", "partly", "incorrect"]
GraphState = Literal["pending", "running", "ok", "failed"]
MAX_IDEA_SET = 30


class StartTeacherChat(SendMessage):
    kind: TeacherKind
    topic: str | None = Field(default=None, max_length=200)
    idea_ids: list[str] | None = Field(default=None, max_length=MAX_IDEA_SET)


class AnswerSubmission(ApiModel):
    question_id: str
    choice: int | None = Field(default=None, ge=0)
    text: str | None = Field(default=None, min_length=1, max_length=8000)
    confidence: Confidence | None
    thinking: str = Field(default="", max_length=8000)
    dont_know: bool = False


class SubmitAnswers(ApiModel):
    model: ModelRef
    answers: list[AnswerSubmission] = Field(min_length=1, max_length=20)


class Dispute(ApiModel):
    model: ModelRef
    reason: str = Field(default="", max_length=4000)


class HintRequest(ApiModel):
    model: ModelRef
    attempt: str = Field(default="", max_length=8000)


class ModelOnly(ApiModel):
    model: ModelRef


class IdeaSetIn(ApiModel):
    idea_ids: list[str] = Field(max_length=100)


class TeacherChatUpdate(ApiModel):
    title: str = Field(min_length=1, max_length=200)


class TeacherChatSummary(ApiModel):
    id: str
    kind: TeacherKind
    title: str
    created_at: str
    updated_at: str
    generating: bool
    unseen_answer: bool
    unanswered_count: int
    model_label: str
    version: int


class GradeOut(ApiModel):
    grade: Grade
    feedback: str = ""
    by: Literal["server", "teacher"]
    dispute_reason: str | None = None
    at: str


class HintOut(ApiModel):
    text: str
    created_at: str


class SubmissionOut(ApiModel):
    choice: int | None = None
    text: str | None = None
    confidence: Confidence | None = None
    dont_know: bool = False
    thinking: str = ""
    submitted_at: str


class QuestionOut(ApiModel):
    id: str
    answer_id: str
    kind: Literal["choice", "text"]
    title: str
    prompt: str
    options: list[str] | None = None
    practice: bool
    status: QuestionStatus
    revealed: bool
    key: int | str | None = None
    explanation: str | None = None
    submission: SubmissionOut | None
    grades: list[GradeOut]
    hints: list[HintOut]


class PlanOut(ApiModel):
    version: int
    answer_id: str | None = None
    mermaid: str
    current: str | None
    created_at: str


class GraphStatus(ApiModel):
    status: GraphState | None
    pending_turns: int
    error: str | None = None


class SegmentOut(ApiModel):
    type: Literal["markdown", "question", "malformed"]
    text: str | None = None
    question_id: str | None = None
    id: str | None = None
    reason: str | None = None


class TeacherUserOut(ApiModel):
    id: str
    text: str
    created_at: str
    action: Literal["answers", "dispute", "hint", "retry"] | None
    target: str | None = None
    attachments: list[ContextItemRef] = Field(default_factory=list)


class AnswerErrorOut(ApiModel):
    category: ErrorCategory
    message: str
    retry_after_seconds: int | None = None


class TeacherAnswerOut(ApiModel):
    id: str
    status: AnswerStatus
    run_id: str | None = None
    endpoint_label: str = ""
    model_label: str = ""
    locality: Locality = "local"
    segments: list[SegmentOut]
    error: AnswerErrorOut | None = None


class TeacherTurnOut(ApiModel):
    id: str
    user: TeacherUserOut
    answer: TeacherAnswerOut


class IdeaSummary(ApiModel):
    id: str
    name: str
    statement: str
    course_ids: list[str]
    source_count: int
    updated_at: str


class ChatModelOut(ApiModel):
    endpoint_id: str
    model_id: str
    label: str
    available: bool


class TeacherChatOut(ApiModel):
    chat: TeacherChatSummary
    topic: str | None
    model: ChatModelOut | None = None
    turns: list[TeacherTurnOut]
    questions: list[QuestionOut]
    plans: list[PlanOut]
    idea_set: list[IdeaSummary]
    graph: GraphStatus


class TeacherSendResult(ApiModel):
    chat: TeacherChatSummary
    run_id: str
    turn_id: str
    answer_id: str
    graded: list[QuestionOut] = Field(default_factory=list)


class GraphImpact(ApiModel):
    ideas: int


class Instructions(ApiModel):
    lesson: str
    practice: str
    extraction: str
