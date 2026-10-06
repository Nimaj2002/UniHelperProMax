from __future__ import annotations

from collections.abc import Callable
from typing import Any

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.notes_helpers import API
from tests.contract.openapi_check import check
from unihelper.schemas.themes import TOKENS

pytestmark = pytest.mark.contract


def body(name: str = "Sabancı Night", **over: Any) -> dict[str, Any]:
    colors = {t: "#202124" for t in TOKENS} | {"text-primary": "#ECECEF", "accent": "#8BA7FF"}
    return {
        "name": name,
        "base": "dark",
        "keyColors": {
            "background": "#131316",
            "surface": "#1b1b1f",
            "text": "#ececef",
            "accent": "#8ba7ff",
        },
        "overrides": {"accent": "#8BA7FF"},
        "colors": colors,
        "lowContrast": False,
    } | over


def create(c: TestClient, **kw: Any) -> dict[str, Any]:
    r = c.post(f"{API}/themes", json=body(**kw))
    assert r.status_code == 201, r.text
    return r.json()  # type: ignore[no-any-return]


def test_create_list_get(owner_client: TestClient) -> None:
    c = owner_client
    t = create(c)
    check(t, "Theme", spec="005")
    assert t["name"] == "Sabancı Night" and t["base"] == "dark" and t["version"] == 1
    assert t["colors"]["text-primary"] == "#ececef"  # normalised to lower case
    assert t["overrides"] == {"accent": "#8ba7ff"}
    assert_problem(c.post(f"{API}/themes", json=body("sabancı night")), 409, "name_taken")
    dup = c.post(f"{API}/themes", json=body("Sabancı Night", uniqueName=True)).json()
    assert dup["name"] == "Sabancı Night (2)"
    assert (
        c.post(f"{API}/themes", json=body("Sabancı Night", uniqueName=True)).json()["name"]
        == "Sabancı Night (3)"
    )
    create(c, name="Aurora")
    listed = c.get(f"{API}/themes").json()
    check(listed, "Theme", many=True, spec="005")
    assert [x["name"] for x in listed] == [
        "Aurora",
        "Sabancı Night",
        "Sabancı Night (2)",
        "Sabancı Night (3)",
    ]
    got = c.get(f"{API}/themes/{t['id']}")
    assert got.status_code == 200 and got.json() == t


@pytest.mark.parametrize(
    ("over", "code"),
    [
        ({"name": "  "}, "name_required"),
        ({"name": "x" * 61}, "name_too_long"),
        ({"colors": {t: "#zzzzzz" for t in TOKENS}}, "invalid_color"),
        ({"colors": {t: "#111111" for t in TOKENS} | {"glow": "#111111"}}, "unknown_color"),
        ({"colors": {"surface": "#111111"}}, "missing_colors"),
        ({"overrides": {"surface": "red"}}, "invalid_color"),
        ({"keyColors": {"background": "#111111"}}, "missing_colors"),
    ],
)
def test_validation(owner_client: TestClient, over: dict[str, Any], code: str) -> None:
    assert_problem(owner_client.post(f"{API}/themes", json=body(**over)), 422, code)


def test_bad_base_and_script_like_values(owner_client: TestClient) -> None:
    assert owner_client.post(f"{API}/themes", json=body(base="neon")).status_code == 422
    bad = body(colors={t: "#111111" for t in TOKENS} | {"accent": "<script>"})
    assert_problem(owner_client.post(f"{API}/themes", json=bad), 422, "invalid_color")


def test_update_and_delete(owner_client: TestClient) -> None:
    c = owner_client
    t = create(c)
    other = create(c, name="Aurora")
    url = f"{API}/themes/{t['id']}"
    put = body("Midnight", lowContrast=True)
    put.pop("base")
    assert_problem(c.put(url, json=put), 428, "if_match_required")
    r = c.put(url, json=put, headers={"If-Match": '"1"'})
    assert r.status_code == 200, r.text
    check(r.json(), "Theme", spec="005")
    assert (r.json()["name"], r.json()["lowContrast"], r.json()["version"]) == ("Midnight", True, 2)
    assert_problem(c.put(url, json=put, headers={"If-Match": '"1"'}), 412, "version_conflict")
    assert_problem(
        c.put(url, json=body("aurora") | {"base": None}, headers={"If-Match": '"2"'}),
        409,
        "name_taken",
    )

    # deleting the active theme falls back to its base
    assert c.patch(f"{API}/preferences", json={"theme": t["id"]}).json()["theme"] == t["id"]
    assert_problem(c.delete(url, headers={"If-Match": '"1"'}), 412, "version_conflict")
    assert c.delete(url, headers={"If-Match": '"2"'}).status_code == 204
    assert c.get(f"{API}/preferences").json()["theme"] == "dark"
    assert_problem(c.get(url), 404, "not_found")
    # deleting an inactive theme leaves the choice alone
    c.patch(f"{API}/preferences", json={"theme": "light"})
    assert c.delete(f"{API}/themes/{other['id']}", headers={"If-Match": '"1"'}).status_code == 204
    assert c.get(f"{API}/preferences").json()["theme"] == "light"


def test_themes_are_per_user(
    owner_client: TestClient, make_member: Callable[..., TestClient]
) -> None:
    t = create(owner_client)
    member = make_member()
    assert member.get(f"{API}/themes").json() == []
    assert_problem(member.get(f"{API}/themes/{t['id']}"), 404, "not_found")
    assert member.patch(f"{API}/preferences", json={"theme": t["id"]}).status_code == 422
    assert_problem(
        member.delete(f"{API}/themes/{t['id']}", headers={"If-Match": '"1"'}), 404, "not_found"
    )
