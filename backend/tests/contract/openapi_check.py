"""Validate JSON bodies against schemas in specs/001-…/contracts/openapi.yaml."""

from __future__ import annotations

import copy
from functools import cache
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator
from referencing import Registry, Resource

CONTRACT = (
    Path(__file__).resolve().parents[3]
    / "specs"
    / "001-class-schedule-calendar"
    / "contracts"
    / "openapi.yaml"
)
BASE = "urn:unihelper:openapi"


@cache
def contract() -> dict[str, Any]:
    return yaml.safe_load(CONTRACT.read_text(encoding="utf-8"))  # type: ignore[no-any-return]


@cache
def _registry() -> Registry:  # type: ignore[type-arg]
    doc = copy.deepcopy(contract())
    doc["$id"] = BASE
    return Registry().with_resource(
        BASE,
        Resource.from_contents(
            doc, default_specification=__import__("referencing.jsonschema").jsonschema.DRAFT202012
        ),
    )


def check(data: Any, schema_name: str, many: bool = False) -> None:
    ref = {"$ref": f"{BASE}#/components/schemas/{schema_name}"}
    schema = {"type": "array", "items": ref} if many else ref
    Draft202012Validator(schema, registry=_registry()).validate(data)


def contract_operations() -> set[str]:
    ops = set()
    for path, item in contract()["paths"].items():
        for method in item:
            if method in {"get", "post", "put", "patch", "delete"}:
                ops.add(f"{method.upper()} {path}")
    return ops
