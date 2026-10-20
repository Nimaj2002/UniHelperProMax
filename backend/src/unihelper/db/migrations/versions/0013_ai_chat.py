"""ai chat: secret store, AI endpoints and models, chats, runs, drafts, uploads (014)

Revision ID: 0013
Revises: 0012
Create Date: 2026-10-19 12:00:00

- `secret_store_meta`: one row with the installation id (names the key-store entry or key
  file), the master-key verifier and the transcription-key migration state.
- `secrets`: encrypted provider keys (AES-256-GCM); plaintext never reaches the database.
- `ai_endpoints`, `ai_models`, `ai_settings`: the student's AI services (014 data-model.md).
- `chats`: index rows of the chat files in the session folders (`chats/<stem>.json`).
- `chat_runs`, `chat_drafts`, `chat_uploads`: answer generation, unsent drafts, staged files.
- `provider_configs.secret_id`: the encrypted transcription key. The plaintext `secret` column
  stays until the startup migration (`secrets.migrate`) has moved every key; it is pure schema
  here because encrypting needs the master key from the OS key store.
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = "0013"
down_revision: str | None = "0012"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _user_fk(table: str) -> sa.ForeignKeyConstraint:
    return sa.ForeignKeyConstraint(
        ["user_id"], ["users.id"], name=op.f(f"fk_{table}_user_id_users"), ondelete="CASCADE"
    )


def upgrade() -> None:
    op.create_table(
        "secret_store_meta",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("installation_id", sa.String(36), nullable=False),
        sa.Column("verifier_nonce", sa.LargeBinary(), nullable=True),
        sa.Column("verifier_ct", sa.LargeBinary(), nullable=True),
        sa.Column("store_kind", sa.String(20), nullable=True),
        sa.Column("migration_state", sa.String(20), nullable=False),
        sa.Column("migration_error", sa.String(200), nullable=True),
        sa.Column("rotated_at", sa.String(), nullable=True),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_secret_store_meta")),
    )

    op.create_table(
        "secrets",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("owner_kind", sa.String(30), nullable=False),
        sa.Column("owner_id", sa.String(64), nullable=False),
        sa.Column("nonce", sa.LargeBinary(), nullable=False),
        sa.Column("ciphertext", sa.LargeBinary(), nullable=False),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        _user_fk("secrets"),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_secrets")),
        sa.UniqueConstraint("user_id", "owner_kind", "owner_id", name="uq_secrets_owner"),
    )

    op.create_table(
        "ai_endpoints",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("name", sa.String(60), nullable=False),
        sa.Column("name_key", sa.String(60), nullable=False),
        sa.Column("style", sa.String(20), nullable=False),
        sa.Column("base_url", sa.String(2048), nullable=False),
        sa.Column("locality", sa.String(10), nullable=False),
        sa.Column("enabled", sa.Boolean(), nullable=False),
        sa.Column("secret_id", sa.String(), nullable=True),
        sa.Column("privacy_ack_at", sa.String(), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        _user_fk("ai_endpoints"),
        sa.ForeignKeyConstraint(
            ["secret_id"],
            ["secrets.id"],
            name=op.f("fk_ai_endpoints_secret_id_secrets"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_endpoints")),
        sa.UniqueConstraint("user_id", "name_key", name="uq_ai_endpoints_user_name"),
    )

    op.create_table(
        "ai_models",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("endpoint_id", sa.String(), nullable=False),
        sa.Column("model_id", sa.String(200), nullable=False),
        sa.Column("display_name", sa.String(80), nullable=False),
        sa.Column("cap_images", sa.Boolean(), nullable=False),
        sa.Column("cap_pdf", sa.Boolean(), nullable=False),
        sa.Column("cap_audio", sa.Boolean(), nullable=False),
        sa.Column("hidden", sa.Boolean(), nullable=False),
        sa.Column("source", sa.String(10), nullable=False),
        sa.Column("context_limit", sa.Integer(), nullable=True),
        sa.Column("output_limit", sa.Integer(), nullable=True),
        sa.Column("position", sa.Integer(), nullable=False),
        _user_fk("ai_models"),
        sa.ForeignKeyConstraint(
            ["endpoint_id"],
            ["ai_endpoints.id"],
            name=op.f("fk_ai_models_endpoint_id_ai_endpoints"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_ai_models")),
        sa.UniqueConstraint("endpoint_id", "model_id", name="uq_ai_models_endpoint_model"),
    )
    op.create_index(op.f("ix_ai_models_endpoint_id"), "ai_models", ["endpoint_id"])

    op.create_table(
        "ai_settings",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("custom_instructions", sa.Text(), nullable=False),
        sa.Column("last_model_id", sa.String(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        _user_fk("ai_settings"),
        sa.ForeignKeyConstraint(
            ["last_model_id"],
            ["ai_models.id"],
            name=op.f("fk_ai_settings_last_model_id_ai_models"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("user_id", name=op.f("pk_ai_settings")),
    )

    op.create_table(
        "chats",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("session_folder_id", sa.String(), nullable=False),
        sa.Column("stem", sa.String(120), nullable=False),
        sa.Column("title", sa.String(200), nullable=False),
        sa.Column("model_ref_id", sa.String(), nullable=True),
        sa.Column("model_label", sa.String(200), nullable=False),
        sa.Column("message_count", sa.Integer(), nullable=False),
        sa.Column("generating", sa.Boolean(), nullable=False),
        sa.Column("unseen_answer", sa.Boolean(), nullable=False),
        sa.Column("file_hash", sa.String(64), nullable=True),
        sa.Column("deleted_at", sa.String(), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        sa.Column("version", sa.Integer(), nullable=False),
        _user_fk("chats"),
        sa.ForeignKeyConstraint(
            ["session_folder_id"],
            ["session_folders.id"],
            name=op.f("fk_chats_session_folder_id_session_folders"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["model_ref_id"],
            ["ai_models.id"],
            name=op.f("fk_chats_model_ref_id_ai_models"),
            ondelete="SET NULL",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_chats")),
        sa.UniqueConstraint("session_folder_id", "stem", name="uq_chats_folder_stem"),
    )
    op.create_index("ix_chats_folder_updated", "chats", ["session_folder_id", "updated_at"])

    op.create_table(
        "chat_runs",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("chat_id", sa.String(), nullable=False),
        sa.Column("answer_id", sa.String(64), nullable=False),
        sa.Column("status", sa.String(20), nullable=False),
        sa.Column("started_at", sa.String(), nullable=False),
        sa.Column("ended_at", sa.String(), nullable=True),
        sa.Column("error_category", sa.String(30), nullable=True),
        _user_fk("chat_runs"),
        sa.ForeignKeyConstraint(
            ["chat_id"], ["chats.id"], name=op.f("fk_chat_runs_chat_id_chats"), ondelete="CASCADE"
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_chat_runs")),
    )
    op.create_index(op.f("ix_chat_runs_chat_id"), "chat_runs", ["chat_id"])

    op.create_table(
        "chat_drafts",
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("lineage_id", sa.String(), nullable=False),
        sa.Column("original_date", sa.String(), nullable=False),
        sa.Column("chat_key", sa.String(64), nullable=False),
        sa.Column("text", sa.Text(), nullable=False),
        sa.Column("attachments_json", sa.Text(), nullable=False),
        sa.Column("updated_at", sa.String(), nullable=False),
        _user_fk("chat_drafts"),
        sa.PrimaryKeyConstraint(
            "user_id", "lineage_id", "original_date", "chat_key", name=op.f("pk_chat_drafts")
        ),
    )

    op.create_table(
        "chat_uploads",
        sa.Column("id", sa.String(), nullable=False),
        sa.Column("user_id", sa.String(), nullable=False),
        sa.Column("session_folder_id", sa.String(), nullable=False),
        sa.Column("kind", sa.String(10), nullable=False),
        sa.Column("mime", sa.String(100), nullable=False),
        sa.Column("size", sa.Integer(), nullable=False),
        sa.Column("original_name", sa.String(255), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("rel_path", sa.String(500), nullable=False),
        sa.Column("chat_id", sa.String(), nullable=True),
        sa.Column("created_at", sa.String(), nullable=False),
        _user_fk("chat_uploads"),
        sa.ForeignKeyConstraint(
            ["session_folder_id"],
            ["session_folders.id"],
            name=op.f("fk_chat_uploads_session_folder_id_session_folders"),
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(
            ["chat_id"],
            ["chats.id"],
            name=op.f("fk_chat_uploads_chat_id_chats"),
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_chat_uploads")),
    )
    op.create_index(
        op.f("ix_chat_uploads_session_folder_id"), "chat_uploads", ["session_folder_id"]
    )

    with op.batch_alter_table("provider_configs", schema=None) as batch_op:
        batch_op.add_column(sa.Column("secret_id", sa.String(), nullable=True))
        batch_op.create_foreign_key(
            batch_op.f("fk_provider_configs_secret_id_secrets"),
            "secrets",
            ["secret_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade() -> None:
    with op.batch_alter_table("provider_configs", schema=None) as batch_op:
        batch_op.drop_constraint(
            batch_op.f("fk_provider_configs_secret_id_secrets"), type_="foreignkey"
        )
        batch_op.drop_column("secret_id")
    op.drop_index(op.f("ix_chat_uploads_session_folder_id"), table_name="chat_uploads")
    op.drop_table("chat_uploads")
    op.drop_table("chat_drafts")
    op.drop_index(op.f("ix_chat_runs_chat_id"), table_name="chat_runs")
    op.drop_table("chat_runs")
    op.drop_index("ix_chats_folder_updated", table_name="chats")
    op.drop_table("chats")
    op.drop_table("ai_settings")
    op.drop_index(op.f("ix_ai_models_endpoint_id"), table_name="ai_models")
    op.drop_table("ai_models")
    op.drop_table("ai_endpoints")
    op.drop_table("secrets")
    op.drop_table("secret_store_meta")
