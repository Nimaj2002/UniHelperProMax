"""Import every model so Base.metadata is complete (Alembic autogenerate, create_all)."""

from unihelper.models.auth_session import AuthSession
from unihelper.models.base import Base
from unihelper.models.class_series import ClassLink, ClassSeries
from unihelper.models.course import Course
from unihelper.models.document import AnnotationOp, Document, DocumentPosition
from unihelper.models.note import Note
from unihelper.models.recording import Recording
from unihelper.models.semester import Semester
from unihelper.models.session_exception import SessionException
from unihelper.models.session_folder import SessionFolder
from unihelper.models.theme import Theme
from unihelper.models.transcription import ProviderConfig, TranscriptionJob, TranscriptionSettings
from unihelper.models.ui_preferences import UiPreferences
from unihelper.models.user import User
from unihelper.models.workspace_state import WorkspaceState
from unihelper.models.year import Year

__all__ = [
    "AnnotationOp",
    "AuthSession",
    "Base",
    "ClassLink",
    "ClassSeries",
    "Course",
    "Document",
    "DocumentPosition",
    "Note",
    "ProviderConfig",
    "Recording",
    "Semester",
    "SessionException",
    "SessionFolder",
    "Theme",
    "TranscriptionJob",
    "TranscriptionSettings",
    "UiPreferences",
    "User",
    "WorkspaceState",
    "Year",
]
