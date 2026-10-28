"""Import every model so Base.metadata is complete (Alembic autogenerate, create_all)."""

from unihelper.models.ai_endpoint import AiEndpoint, AiModel, AiSettings
from unihelper.models.auth_session import AuthSession
from unihelper.models.base import Base
from unihelper.models.calendar_import import (
    CalendarImportRun,
    CalendarImportSource,
    CalendarImportUpload,
)
from unihelper.models.chat import Chat, ChatDraft, ChatRun, ChatUpload
from unihelper.models.class_series import ClassLink, ClassSeries
from unihelper.models.course import Course
from unihelper.models.document import AnnotationOp, Document, DocumentHide, DocumentPosition
from unihelper.models.event_series import EventLink, EventSeries
from unihelper.models.note import Note
from unihelper.models.recording import Recording
from unihelper.models.secret import Secret, SecretStoreMeta
from unihelper.models.semester import Semester
from unihelper.models.session_exception import SessionException
from unihelper.models.session_folder import SessionFolder
from unihelper.models.task import Task, TaskChecklistItem, TaskQuickNote
from unihelper.models.task_column import TaskColumn
from unihelper.models.theme import Theme
from unihelper.models.transcription import ProviderConfig, TranscriptionJob, TranscriptionSettings
from unihelper.models.trash_entry import TrashEntry
from unihelper.models.ui_preferences import UiPreferences
from unihelper.models.user import User
from unihelper.models.workspace_state import WorkspaceState
from unihelper.models.year import Year

__all__ = [
    "AiEndpoint",
    "AiModel",
    "AiSettings",
    "AnnotationOp",
    "AuthSession",
    "Base",
    "CalendarImportRun",
    "CalendarImportSource",
    "CalendarImportUpload",
    "Chat",
    "ChatDraft",
    "ChatRun",
    "ChatUpload",
    "ClassLink",
    "ClassSeries",
    "Course",
    "Document",
    "DocumentHide",
    "DocumentPosition",
    "EventLink",
    "EventSeries",
    "Note",
    "ProviderConfig",
    "Recording",
    "Secret",
    "SecretStoreMeta",
    "Semester",
    "SessionException",
    "SessionFolder",
    "Task",
    "TaskChecklistItem",
    "TaskColumn",
    "TaskQuickNote",
    "Theme",
    "TranscriptionJob",
    "TranscriptionSettings",
    "TrashEntry",
    "UiPreferences",
    "User",
    "WorkspaceState",
    "Year",
]
