# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Bounded delivery views over unchanged controller evidence."""

from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Iterator

from pydantic import JsonValue

MAX_RESPONSE_BYTES = 12000
PAGE_CHARS = 4096


def evidence_json(value: JsonValue) -> str:
    return json.dumps(value, ensure_ascii=True, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _hash(text: str) -> str:
    return hashlib.sha256(text.encode("ascii")).hexdigest()


def _preview(text: str) -> str:
    text = text[:160]
    while len(evidence_json(text)) > 256:
        text = text[:len(text) // 2]
    return text


def _captures(record: dict[str, JsonValue]) -> Iterator[tuple[str, dict[str, JsonValue]]]:
    debug = record.get("debug")
    if isinstance(debug, dict):
        yield "/debug", debug
    cases = record.get("cases")
    if isinstance(cases, list):
        for index, case in enumerate(cases):
            if isinstance(case, dict) and isinstance(observation := case.get("observation"), dict):
                yield f"/cases/{index}/observation", observation


def _observations(record: dict[str, JsonValue]) -> Iterator[dict[str, JsonValue]]:
    for prefix, capture in _captures(record):
        hits = capture.get("hits")
        if not isinstance(hits, list):
            continue
        for hit_index, hit in enumerate(hits):
            if not isinstance(hit, dict) or not isinstance(evaluations := hit.get("evaluations"), list):
                continue
            for index, evaluation in enumerate(evaluations):
                if not isinstance(evaluation, dict):
                    continue
                pointer = f"{prefix}/hits/{hit_index}/evaluations/{index}"
                result = evaluation.get("result")
                remote = result.get("result") if isinstance(result, dict) else None
                exception = isinstance(result, dict) and "exceptionDetails" in result
                status = "failed" if evaluation.get("error") or exception else (
                    "observed" if isinstance(remote, dict) else "unavailable"
                )
                row: dict[str, JsonValue] = {"pointer": pointer, "status": status}
                if isinstance(file := hit.get("file"), str):
                    row["file_preview"] = _preview(file)
                actual = hit.get("actual_source")
                if isinstance(actual, dict) and isinstance(line := actual.get("line"), int):
                    row["actual_line"] = line
                if isinstance(expression := evaluation.get("expression"), str):
                    row["expression_preview"] = _preview(expression)
                if evaluation.get("error"):
                    row["error_pointer"] = pointer + "/error"
                    row["error_preview"] = _preview(str(evaluation["error"]))
                elif isinstance(result, dict) and "exceptionDetails" in result:
                    row["error_pointer"] = pointer + "/result/exceptionDetails"
                    details = result["exceptionDetails"]
                    if isinstance(details, dict):
                        error = details.get("exception")
                        message = error.get("description") if isinstance(error, dict) else details.get("text")
                        if isinstance(message, str):
                            row["error_preview"] = _preview(message)
                if isinstance(remote, dict):
                    row["result_pointer"] = pointer + "/result/result"
                    if isinstance(kind := remote.get("type"), str):
                        row["result_type_preview"] = _preview(kind)
                    value = remote.get("value")
                    if (
                        status == "observed" and "value" in remote and not isinstance(value, (dict, list))
                        and len(evidence_json(value)) <= 256
                    ):
                        row["value"] = value
                yield row


def evidence_response(record: dict[str, JsonValue], *, read_tool: str = "rca_read_evidence") -> str:
    raw = evidence_json(record)
    if len(raw) <= MAX_RESPONSE_BYTES:
        return raw
    identifier = record.get("id")
    if not isinstance(identifier, str) or not identifier or len(identifier) > 128:
        raise ValueError("Oversized evidence requires a controller ID of at most 128 characters")
    observations = list(_observations(record))
    captures = list(_captures(record))
    overview: dict[str, JsonValue] = {}
    for key in ("kind", "tool", "investigator", "exit_code", "project", "status", "truncated", "error"):
        value = record.get(key)
        if isinstance(value, str):
            overview[key + "_preview"] = _preview(value)
        elif key in record and not isinstance(value, (dict, list)):
            overview[key] = value
    fields: list[JsonValue] = []
    shown: list[JsonValue] = []
    result: dict[str, JsonValue] = {
        "view": "evidence_index", "id": identifier, "complete": False,
        "record_sha256": _hash(raw), "record_chars": len(raw), "overview": overview,
        "fields": fields, "fields_total": len(record),
        "observations": shown, "observations_total": len(observations),
        "failed_evaluations": sum(row["status"] == "failed" for row in observations),
        "unavailable_evaluations": sum(row["status"] == "unavailable" for row in observations),
        "debugger_errors": sum(
            len(errors) for _, capture in captures if isinstance(errors := capture.get("errors"), list)
        ),
        "read": {"evidence_id": identifier, "pointer": "", "offset": 0, "max_chars": PAGE_CHARS},
        "note": "Delivery index only, not a complete capture or qualification verdict. Strings named *_preview "
        f"may be shortened. Use {read_tool} with an exact pointer and follow next_offset; failed or "
        "missing observations remain failed or missing. The raw receipt is unchanged.",
    }
    for key, value in sorted(record.items()):
        fields.append({
            "pointer": "/" + key.replace("~", "~0").replace("/", "~1"),
            "json_chars": len(evidence_json(value)),
        })
        if len(evidence_json(result)) > MAX_RESPONSE_BYTES:
            fields.pop()
            break
    for row in observations:
        shown.append(row)
        if len(evidence_json(result)) > MAX_RESPONSE_BYTES:
            shown.pop()
            break
    encoded = evidence_json(result)
    if len(encoded) > MAX_RESPONSE_BYTES:
        raise ValueError("Evidence index metadata exceeds the response budget")
    return encoded


def _select(record: dict[str, JsonValue], pointer: str) -> JsonValue:
    if not pointer:
        return record
    if not pointer.startswith("/") or re.search(r"~(?![01])", pointer):
        raise ValueError("Use an RFC 6901 JSON pointer, or '' for the complete receipt")
    value: JsonValue = record
    for part in pointer[1:].split("/"):
        token = part.replace("~1", "/").replace("~0", "~")
        if isinstance(value, dict) and token in value:
            value = value[token]
        elif isinstance(value, list) and re.fullmatch(r"0|[1-9][0-9]*", token) and int(token) < len(value):
            value = value[int(token)]
        else:
            raise ValueError("JSON pointer does not select captured evidence")
    return value


def evidence_page(
    record: dict[str, JsonValue], pointer: str, *, offset: int = 0, max_chars: int = PAGE_CHARS,
) -> str:
    if offset < 0 or not 1 <= max_chars <= PAGE_CHARS:
        raise ValueError(f"Evidence pages need offset >= 0 and max_chars between 1 and {PAGE_CHARS}")
    raw = evidence_json(record)
    text = evidence_json(_select(record, pointer))
    if offset > len(text):
        raise ValueError("Evidence offset exceeds the selected value's character count")
    end = min(len(text), offset + max_chars)
    while True:
        page: dict[str, JsonValue] = {
            "view": "evidence_page", "id": record.get("id"), "pointer": pointer,
            "encoding": "canonical_json_fragment", "offset": offset, "total_chars": len(text),
            "next_offset": end if end < len(text) else None,
            "value_complete": offset == 0 and end == len(text), "capture_truncated": record.get("truncated") is True,
            "record_sha256": _hash(raw), "value_sha256": _hash(text), "content": text[offset:end],
        }
        encoded = evidence_json(page)
        if len(encoded) <= MAX_RESPONSE_BYTES:
            return encoded
        if end - offset <= 1:
            raise ValueError("Evidence page metadata exceeds the response budget; select a parent pointer")
        end = offset + max(1, (end - offset) // 2)
