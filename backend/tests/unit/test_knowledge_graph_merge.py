"""022 T052: idea-name normalization and reading the extraction reply (merging itself is
covered against a real database in tests/contract/test_knowledge_graph.py)."""

from __future__ import annotations

import pytest

from unihelper.domain.kg_names import normalize
from unihelper.teacher.graph_worker import JobError, parse_extraction

pytestmark = pytest.mark.unit


@pytest.mark.parametrize(
    ("a", "b"),
    [
        ("Chain rule", "chain-rule!"),
        ("  Zero   Determinant ", "zero determinant"),
        ("Ｅｉｇｅｎｖａｌｕｅ", "eigenvalue"),
        ("det(A) = 0", "deta 0"),
    ],
)
def test_normalize_matches(a: str, b: str) -> None:
    assert normalize(a) == normalize(b)


def test_normalize_keeps_different_ideas_apart() -> None:
    assert normalize("Eigenvalue") != normalize("Eigenvector")
    assert len(normalize("x" * 300)) == 120


def test_parse_extraction() -> None:
    assert parse_extraction('```json\n{"ideas": [], "links": []}\n```') == {
        "ideas": [],
        "links": [],
    }
    assert parse_extraction('Here: {"ideas": [{"key": "i1"}]} done')["ideas"] == [{"key": "i1"}]
    for bad in ("no json here", "{not json}", '{"ideas": "x"}', "[1, 2]"):
        with pytest.raises(JobError) as err:
            parse_extraction(bad)
        assert err.value.category == "invalid_output"
