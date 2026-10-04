from __future__ import annotations

from collections.abc import Callable

import pytest
from fastapi.testclient import TestClient

from tests.conftest import assert_problem
from tests.contract.openapi_check import check

pytestmark = pytest.mark.contract
API = "/api/v1"


def test_years_create_list_existing(owner_client: TestClient) -> None:
    c = owner_client
    r = c.post(f"{API}/years", json={"name": "2026"})
    assert r.status_code == 201
    check(r.json(), "Year")
    again = c.post(f"{API}/years", json={"name": " 2026 "})
    assert again.status_code == 200 and again.json()["id"] == r.json()["id"]
    lst = c.get(f"{API}/years")
    assert lst.status_code == 200
    check(lst.json(), "Year", many=True)
    assert_problem(c.post(f"{API}/years", json={"name": ""}), 422, "validation_failed")
    assert_problem(c.post(f"{API}/years", json={"name": "x" * 81}), 422, "validation_failed")


def test_semesters(owner_client: TestClient) -> None:
    c = owner_client
    year = c.post(f"{API}/years", json={"name": "2026"}).json()
    r = c.post(
        f"{API}/semesters",
        json={
            "yearId": year["id"],
            "name": "Fall 2026",
            "startDate": "2026-09-21",
            "endDate": "2027-01-10",
        },
    )
    assert r.status_code == 201
    check(r.json(), "Semester")
    same = c.post(f"{API}/semesters", json={"yearId": year["id"], "name": "fall 2026"})
    assert same.status_code == 200 and same.json()["id"] == r.json()["id"]
    lst = c.get(f"{API}/semesters", params={"yearId": year["id"]})
    check(lst.json(), "Semester", many=True)
    assert len(lst.json()) == 1
    assert_problem(
        c.post(f"{API}/semesters", json={"yearId": "nope", "name": "X"}), 404, "not_found"
    )
    bad = c.post(
        f"{API}/semesters",
        json={
            "yearId": year["id"],
            "name": "Bad",
            "startDate": "2027-01-10",
            "endDate": "2026-09-01",
        },
    )
    assert_problem(bad, 422, "invalid_date_range")


def test_courses_and_detail(
    owner_client: TestClient, make_member: Callable[..., TestClient]
) -> None:
    c = owner_client
    year = c.post(f"{API}/years", json={"name": "2026"}).json()
    fall = c.post(f"{API}/semesters", json={"yearId": year["id"], "name": "Fall"}).json()
    spring = c.post(f"{API}/semesters", json={"yearId": year["id"], "name": "Spring"}).json()
    r = c.post(f"{API}/courses", json={"semesterId": fall["id"], "name": "CS 201"})
    assert r.status_code == 201
    check(r.json(), "Course")
    assert (
        c.post(f"{API}/courses", json={"semesterId": fall["id"], "name": "cs 201"}).status_code
        == 200
    )
    other = c.post(f"{API}/courses", json={"semesterId": spring["id"], "name": "CS 201"})
    assert other.status_code == 201 and other.json()["id"] != r.json()["id"]
    lst = c.get(f"{API}/courses", params={"semesterId": fall["id"]})
    check(lst.json(), "Course", many=True)
    detail = c.get(f"{API}/courses/{r.json()['id']}")
    assert detail.status_code == 200
    check(detail.json(), "CourseDetail")
    assert detail.json()["year"]["name"] == "2026"
    assert detail.json()["semester"]["name"] == "Fall"
    member = make_member()
    assert_problem(member.get(f"{API}/courses/{r.json()['id']}"), 404, "not_found")
    assert_problem(
        c.post(f"{API}/courses", json={"semesterId": "missing", "name": "X"}), 404, "not_found"
    )


def test_course_tree_shape(owner_client: TestClient) -> None:
    c = owner_client
    year = c.post(f"{API}/years", json={"name": "2026"}).json()
    sem = c.post(f"{API}/semesters", json={"yearId": year["id"], "name": "Fall"}).json()
    c.post(f"{API}/courses", json={"semesterId": sem["id"], "name": "CS 201"})
    r = c.get(f"{API}/course-tree")
    assert r.status_code == 200
    check(r.json(), "YearNode", many=True)
    node = r.json()[0]
    assert node["year"]["name"] == "2026"
    assert node["semesters"][0]["courses"][0]["name"] == "CS 201"
