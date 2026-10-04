"""Validate JSON bodies against schemas in specs/*/contracts/openapi.yaml.

Each feature's contract is registered separately (urn:unihelper:openapi:<NNN>); `check()` defaults
to feature 001's schemas, pass `spec="002"` for later features.
"""

from __future__ import annotations

import copy
from functools import cache
from pathlib import Path
from typing import Any

import yaml
from jsonschema import Draft202012Validator
from referencing import Registry, Resource
from referencing.jsonschema import DRAFT202012

SPECS = Path(__file__).resolve().parents[3] / "specs"
BASE = "urn:unihelper:openapi"


@cache
def contracts() -> dict[str, dict[str, Any]]:
    """{"001": doc, "002": doc, …} for every specs/NNN-*/contracts/openapi.yaml."""
    out: dict[str, dict[str, Any]] = {}
    for path in sorted(SPECS.glob("[0-9][0-9][0-9]-*/contracts/openapi.yaml")):
        out[path.parts[-3][:3]] = yaml.safe_load(path.read_text(encoding="utf-8"))
    return out


def contract(spec: str = "001") -> dict[str, Any]:
    return contracts()[spec]


@cache
def _registry() -> Registry:  # type: ignore[type-arg]
    registry: Registry = Registry()  # type: ignore[type-arg]
    for spec, doc in contracts().items():
        d = copy.deepcopy(doc)
        uri = f"{BASE}:{spec}"
        d["$id"] = uri
        registry = registry.with_resource(
            uri, Resource.from_contents(d, default_specification=DRAFT202012)
        )
    return registry


def check(data: Any, schema_name: str, many: bool = False, spec: str = "001") -> None:
    ref = {"$ref": f"{BASE}:{spec}#/components/schemas/{schema_name}"}
    schema = {"type": "array", "items": ref} if many else ref
    Draft202012Validator(schema, registry=_registry()).validate(data)


def contract_operations() -> set[str]:
    """Union of documented operations across all features."""
    ops = set()
    for doc in contracts().values():
        for path, item in doc["paths"].items():
            for method in item:
                if method in {"get", "post", "put", "patch", "delete"}:
                    ops.add(f"{method.upper()} {path}")
    return ops
