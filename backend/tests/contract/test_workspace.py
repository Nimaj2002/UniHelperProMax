from __future__ import annotations

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.notes_helpers import API, create_note, make_session
from tests.contract.openapi_check import check

pytestmark = pytest.mark.contract


def test_workspace_state(owner_client: TestClient, make_member: Callable[..., TestClient]) -> None:
    c = owner_client
    key = make_session(c)
    empty = c.get(f"{API}/workspace/{key}")
    assert empty.status_code == 200 and empty.json() == {
        "openNoteIds": [],
        "activeNoteId": None,
        "tabs": [],  # 007
        "active": None,
        "split": None,
    }
    a, b = create_note(c, key, "A"), create_note(c, key, "B")
    r = c.put(
        f"{API}/workspace/{key}",
        json={"openNoteIds": [b["id"], a["id"], "ghost"], "activeNoteId": a["id"]},
    )
    assert r.status_code == 200
    check(r.json(), "WorkspaceState", spec="002")
    body = r.json()
    assert (body["openNoteIds"], body["activeNoteId"]) == ([b["id"], a["id"]], a["id"])
    assert body["tabs"] == [{"kind": "note", "id": b["id"]}, {"kind": "note", "id": a["id"]}]
    assert c.get(f"{API}/workspace/{key}").json()["openNoteIds"] == [b["id"], a["id"]]
    assert (
        c.put(
            f"{API}/workspace/{key}", json={"openNoteIds": [a["id"]], "activeNoteId": b["id"]}
        ).status_code
        == 422
    )
    assert (
        c.put(
            f"{API}/workspace/{key}", json={"openNoteIds": [f"n{i}" for i in range(51)]}
        ).status_code
        == 422
    )
    m = make_member()
    assert_problem(m.get(f"{API}/workspace/{key}"), 404, "not_found")
    assert_problem(m.put(f"{API}/workspace/{key}", json={"openNoteIds": []}), 404, "not_found")


def test_typed_tabs_and_split_view(owner_client: TestClient) -> None:
    """007 FR-013/FR-014a: notes and documents as tabs, split remembered, stale tabs dropped."""
    from tests import pdf_fixtures as fx
    from tests.contract.document_helpers import upload_pdf

    c = owner_client
    key = make_session(c)
    note = create_note(c, key, "Lecture")
    doc = upload_pdf(c, key, "slides.pdf", fx.text_pdf(2)).json()
    tab_note = {"kind": "note", "id": note["id"]}
    tab_doc = {"kind": "document", "id": doc["id"]}
    body = {
        "openNoteIds": [note["id"]],
        "tabs": [tab_doc, tab_note, {"kind": "document", "id": "gone"}, tab_note],
        "active": tab_note,
        "split": {
            "enabled": True,
            "left": tab_doc,
            "right": tab_note,
            "focused": "right",
            "ratio": 0.6,
        },
    }
    r = c.put(f"{API}/workspace/{key}", json=body)
    assert r.status_code == 200, r.text
    state = c.get(f"{API}/workspace/{key}").json()
    assert state["tabs"] == [tab_doc, tab_note]  # unknown and duplicate tabs dropped
    assert state["active"] == tab_note and state["activeNoteId"] == note["id"]
    assert state["openNoteIds"] == [note["id"]]
    assert state["split"] == {
        "enabled": True,
        "left": tab_doc,
        "right": tab_note,
        "focused": "right",
        "ratio": 0.6,
    }

    # an older client saving note tabs only keeps the open document tab
    c.put(f"{API}/workspace/{key}", json={"openNoteIds": [note["id"]], "activeNoteId": note["id"]})
    assert c.get(f"{API}/workspace/{key}").json()["tabs"] == [tab_note, tab_doc]

    # deleting the note shown in a pane turns split off
    c.delete(f"{API}/notes/{note['id']}", headers={"If-Match": f'"{note["version"]}"'})
    after = c.get(f"{API}/workspace/{key}").json()
    assert after["tabs"] == [tab_doc] and after["split"]["enabled"] is False

    bad = dict(body, split={"enabled": True, "focused": "middle", "ratio": 0.6})
    assert c.put(f"{API}/workspace/{key}", json=bad).status_code == 422
    ratio = dict(body, split={"enabled": True, "focused": "left", "ratio": 0.95})
    assert c.put(f"{API}/workspace/{key}", json=ratio).status_code == 422


def test_new_chat_tabs_are_kept(owner_client: TestClient) -> None:
    """014 T013: an empty chat tab (client id `new:<uuid>`) survives a save; an unknown chat id
    is dropped like any stale tab. Tabs of real chats are covered in test_chats_history."""
    c = owner_client
    key = make_session(c)
    create_note(c, key, "A")  # the session gets its folder
    new_tab = {"kind": "chat", "id": "new:0b9c2d6e-1f00-4a55-9b1e-2a7d1c3e4f50"}
    r = c.put(
        f"{API}/workspace/{key}",
        json={"tabs": [new_tab, {"kind": "chat", "id": "ghost"}], "active": new_tab},
    )
    assert r.status_code == 200, r.text
    assert r.json()["tabs"] == [new_tab]
    assert r.json()["active"] == new_tab
