# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Controller-owned report capture and local, acquisition-free setup checks.

This is a deliberately bounded Markdown reader, not a CommonMark implementation.
Only complete fences with zero to three structural opening spaces are rendered.
Offsets count Python string characters; hashes cover UTF-8 bytes without newline
normalization. Callers must screen report documents before exposing them to roles.
Artifact verifiers and feature probes are trusted controller hooks, never model
commands. Availability is not a claim of semantic or dependency compatibility.
"""

from __future__ import annotations

import hashlib
import io
import json
import re
import shlex
import tokenize
from collections.abc import Callable, Iterator, Sequence
from email.parser import BytesParser
from pathlib import Path
from typing import Annotated, Literal
from urllib.parse import unquote_plus, urlsplit

from pydantic import ConfigDict, Field, JsonValue

from issue_review_models import EXPLORATORY_SETTINGS, Record, ReproductionTarget
from issue_review_reproduction import fingerprint, relative_path

MAX_DOCUMENT_CHARS = 262144
MAX_SOURCE_CHARS = 65536
MAX_BLOCKS = 128
Digest = Annotated[str, Field(pattern=r"^[0-9a-f]{64}$")]
Label = Annotated[str, Field(min_length=1, max_length=512)]
BoundedText = Annotated[str, Field(min_length=1, max_length=4096)]
Setting = Literal["pythonVersion", "typeCheckingMode"]
CapabilityStatus = Literal["available", "missing", "unknown", "unsupported", "failed"]
RequirementKind = Literal["checker_target", "static_stubs", "runtime_distribution", "static_feature", "unsupported"]
DeclarationKind = Literal[
    "literal_setting", "interpreter_version", "checker_cli", "checker_version", "dependency_version", "playground_query",
]


class CapturedRecord(Record):
    model_config = ConfigDict(extra="forbid", strict=True, frozen=True)


class ReportDocument(CapturedRecord):
    id: Label
    kind: Literal["issue_body", "comment"]
    provenance: BoundedText
    text: str = Field(max_length=MAX_DOCUMENT_CHARS)
    revision: Label | None = None


class EvidenceSpan(CapturedRecord):
    document_id: Label
    start: int = Field(ge=0, le=MAX_DOCUMENT_CHARS)
    end: int = Field(ge=0, le=MAX_DOCUMENT_CHARS)
    quote: BoundedText


class ReportedDiagnostic(CapturedRecord):
    output_block_id: Label
    message: BoundedText
    rendered_message: BoundedText
    rule: Label | None
    evidence: EvidenceSpan
    transform: Literal["pyright_cli_renderer"] = "pyright_cli_renderer"


class SourceLimitation(CapturedRecord):
    code: Literal[
        "unsupported_container", "unclosed_fence", "ambiguous_tabs", "invalid_info",
        "oversized_block", "unsupported_indented_code", "invalid_configuration", "ambiguous_filename",
    ]
    document_id: Label
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    detail: BoundedText


class CapturedSource(CapturedRecord):
    id: Label
    document_id: Label
    start: int = Field(ge=0)
    end: int = Field(ge=0)
    content_start: int = Field(ge=0)
    content_end: int = Field(ge=0)
    opening_line: int = Field(ge=1)
    closing_line: int = Field(ge=1)
    raw_content: str = Field(max_length=MAX_SOURCE_CHARS)
    content: str = Field(max_length=MAX_SOURCE_CHARS)
    raw_sha256: Digest
    canonical_sha256: Digest
    source_kind: Literal["python", "configuration", "unclassified", "other"]
    language_hint: str | None = Field(default=None, max_length=128)
    filename_hint: Label | None = None
    filename_evidence: EvidenceSpan | None = None
    association_error: BoundedText | None = None
    info: str = Field(max_length=1024)
    transform: Literal["identity", "opening_fence_spaces_only"]
    indentation: int = Field(ge=0, le=3)


class ReportedDeclaration(CapturedRecord):
    id: Label
    setting: Label
    value: JsonValue
    evidence: EvidenceSpan
    source_id: Label | None = None
    supported: bool
    declaration_kind: DeclarationKind = "literal_setting"


class SourceCapture(CapturedRecord):
    version: Literal[1] = 1
    report_id: Label
    report_hash: Digest
    documents: tuple[ReportDocument, ...] = Field(max_length=128)
    blocks: tuple[CapturedSource, ...] = Field(max_length=MAX_BLOCKS)
    declarations: tuple[ReportedDeclaration, ...] = Field(max_length=256)
    limitations: tuple[SourceLimitation, ...] = Field(max_length=256)
    digest: Digest


class SourceAssociation(CapturedRecord):
    source_id: Label
    path: Label
    filename_quote: BoundedText | None = None


class SettingChoice(CapturedRecord):
    setting: Setting
    value: Label
    reason: BoundedText


class ReportedSettingSelection(CapturedRecord):
    setting: Setting
    declaration_ids: tuple[Label, ...] = Field(min_length=1, max_length=256)
    context: EvidenceSpan
    reason: BoundedText


class SettingDerivation(CapturedRecord):
    setting: Literal["pythonVersion"]
    value: Label
    declaration_ids: tuple[Label, ...] = Field(min_length=1, max_length=256)
    reported_values: tuple[Label, ...] = Field(min_length=1, max_length=256)
    transform: Literal["interpreter_major_minor"]


class MaterializedSetup(CapturedRecord):
    files: dict[str, str] = Field(max_length=30)
    configuration: dict[str, JsonValue] = Field(max_length=128)
    blockers: tuple[BoundedText, ...] = Field(max_length=256)
    assumptions: tuple[SettingChoice, ...] = Field(max_length=2)
    reported_settings: tuple[ReportedSettingSelection, ...] = Field(default=(), max_length=2)
    scoped_declarations: tuple[ReportedDeclaration, ...] = Field(default=(), max_length=256)
    derivations: tuple[SettingDerivation, ...] = Field(default=(), max_length=256)
    source_ids: tuple[Label, ...] = Field(max_length=30)
    associations: tuple[SourceAssociation, ...] = Field(max_length=30)
    inferred_paths: tuple[Label, ...] = Field(max_length=30)
    limitations: tuple[SourceLimitation, ...] = Field(max_length=256)
    hashes: dict[str, str] = Field(max_length=32)
    digest: Digest


def _sha(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _record_hash(value: Record) -> str:
    return fingerprint(value.model_dump(mode="json", exclude={"digest"}))


def verify_span(capture: SourceCapture, span: EvidenceSpan) -> None:
    document = next((item for item in capture.documents if item.id == span.document_id), None)
    if (
        document is None or not 0 <= span.start < span.end <= len(document.text)
        or document.text[span.start:span.end] != span.quote
    ):
        raise ValueError("Evidence span does not identify the exact captured document text")


def _lines(text: str) -> list[tuple[int, int, str]]:
    return [
        (number, match.start(), match.group())
        for number, match in enumerate(re.finditer(r"[^\r\n]*(?:\r\n|\r|\n|$)", text), 1)
        if match.group()
    ]


def _filename(
    document: ReportDocument, info: str, info_start: int, previous: tuple[int, int, str] | None,
) -> tuple[str | None, EvidenceSpan | None]:
    matches = list(re.finditer(r'(?:^|\s)(?:filename|title)=["\']([^"\']+)["\']', info))
    preceding = re.fullmatch(
        r"[ \t]*(?:[-+*][ \t]+)?`([^`\r\n]+)`:[ \t]*(?:\r\n|\r|\n)?", previous[2],
    ) if previous else None
    filenames = {match[1] for match in matches}
    if preceding:
        filenames.add(preceding[1])
    if len(filenames) > 1:
        raise ValueError("Conflicting explicit filename evidence for this fence")
    match = matches[0] if matches else None
    if match:
        start, end = info_start + match.start(1), info_start + match.end(1)
        quote = document.text[start:end]
    elif previous and preceding:
        start, end = previous[1] + preceding.start(1), previous[1] + preceding.end(1)
        quote = document.text[start:end]
    else:
        return None, None
    return quote, EvidenceSpan(document_id=document.id, start=start, end=end, quote=quote)


def _supported_setting(setting: str, value: JsonValue) -> bool:
    if setting == "pythonVersion":
        return isinstance(value, str) and bool(re.fullmatch(r"3\.\d{1,2}", value))
    if setting == "typeCheckingMode":
        return value in ("off", "basic", "standard", "strict")
    if setting == "pythonPlatform":
        return value in ("Windows", "Darwin", "Linux", "All")
    if setting == "enableExperimentalFeatures":
        return isinstance(value, bool)
    if setting.startswith("report"):
        return isinstance(value, bool) or value in ("none", "information", "warning", "error")
    if setting == "pyrightVersion":
        return isinstance(value, str) and bool(re.fullmatch(r"1\.\d+\.\d+", value))
    if setting == "typing_extensions":
        return isinstance(value, str) and bool(re.fullmatch(r"\d+(?:\.\d+){1,3}", value))
    return False


def _declaration(
    report_hash: str, document: ReportDocument, setting: str, value: JsonValue, start: int, end: int,
    source_id: str | None = None, *,
    declaration_kind: DeclarationKind = "literal_setting",
) -> ReportedDeclaration:
    evidence = EvidenceSpan(document_id=document.id, start=start, end=end, quote=document.text[start:end])
    identifier = fingerprint([report_hash, setting, value, evidence.model_dump(mode="json"), source_id, declaration_kind])
    supported = (
        isinstance(value, str) and bool(re.fullmatch(r"3\.\d{1,2}(?:\.\d+)?", value))
        if declaration_kind == "interpreter_version" else _supported_setting(setting, value)
    )
    return ReportedDeclaration(
        id="declaration-" + identifier, setting=setting, value=value, evidence=evidence, source_id=source_id,
        supported=supported, declaration_kind=declaration_kind,
    )


def _raw_source_offset(block: CapturedSource, offset: int) -> int:
    for raw, rendered in reversed(list(zip(_lines(block.raw_content), _lines(block.content)))):
        if offset >= rendered[1]:
            removed = min(block.indentation, len(raw[2]) - len(raw[2].lstrip(" ")))
            return block.content_start + raw[1] + removed + offset - rendered[1]
    return block.content_start


def _configuration_declarations(
    report_hash: str, document: ReportDocument, block: CapturedSource,
) -> list[ReportedDeclaration]:
    # JSON is decoded first; source offsets then follow tokens rather than searching
    # for configuration-looking text inside JSON string values.
    def reject_constant(value: str) -> None:
        raise ValueError(f"Nonstandard JSON constant {value} is unsupported")
    decoder = json.JSONDecoder(parse_constant=reject_constant)
    text = block.content
    value = decoder.decode(text)
    if not isinstance(value, dict):
        raise ValueError("Configuration must be one JSON object")
    declarations = []
    index = len(text) - len(text.lstrip()) + 1
    while index < len(text):
        index += len(text[index:]) - len(text[index:].lstrip())
        if text[index:index + 1] == "}":
            break
        start = index
        key, index = decoder.raw_decode(text, index)
        index += len(text[index:]) - len(text[index:].lstrip())
        if text[index:index + 1] != ":":
            raise ValueError("Invalid configuration property")
        index += 1
        index += len(text[index:]) - len(text[index:].lstrip())
        item, end = decoder.raw_decode(text, index)
        # Map rendered offsets back into the original document, including its
        # structural spaces. Evidence itself always quotes the raw document.
        declarations.append(_declaration(
            report_hash, document, key, item,
            _raw_source_offset(block, start), _raw_source_offset(block, end), block.id,
        ))
        index = end
        index += len(text[index:]) - len(text[index:].lstrip())
        if text[index:index + 1] == ",":
            index += 1
    return declarations


def _shell_declarations(
    report_hash: str, document: ReportDocument, block: CapturedSource,
) -> list[ReportedDeclaration]:
    """Read bounded reported Pyright command/output lines, never execute them."""
    declarations = []
    for _, offset, line in _lines(block.content):
        text = line.rstrip("\r\n")
        if not re.match(r"[ \t]*(?:\$[ \t]+)?pyright(?:[ \t]|$)", text):
            continue
        if "--pythonversion" not in text and not re.fullmatch(
            r"[ \t]*(?:\$[ \t]+)?pyright[ \t]+1\.\d+\.\d+[ \t]*", text,
        ):
            continue
        tokens = shlex.split(text, comments=True)
        if tokens[:1] == ["$"]:
            tokens = tokens[1:]
        if len(tokens) == 2 and re.fullmatch(r"1\.\d+\.\d+", tokens[1]):
            declarations.append(_declaration(
                report_hash, document, "pyrightVersion", tokens[1],
                _raw_source_offset(block, offset), _raw_source_offset(block, offset + len(text)), block.id,
                declaration_kind="checker_version",
            ))
            continue
        if not any(token == "--pythonversion" or token.startswith("--pythonversion=") for token in tokens):
            continue
        if re.search(r"[;&|<>`$]", re.sub(r"^[ \t]*\$[ \t]+", "", text)):
            raise ValueError("Reported Python target uses unsupported shell expansion/operators; no value selected")
        for index, token in enumerate(tokens):
            if token == "--pythonversion":
                value = tokens[index + 1] if index + 1 < len(tokens) else ""
            elif token.startswith("--pythonversion="):
                value = token.partition("=")[2]
            else:
                continue
            declarations.append(_declaration(
                report_hash, document, "pythonVersion", value,
                _raw_source_offset(block, offset), _raw_source_offset(block, offset + len(text)), block.id,
                declaration_kind="checker_cli",
            ))
    return declarations


def _playground_declarations(
    report_hash: str, document: ReportDocument, start: int, url: str,
) -> list[ReportedDeclaration]:
    if re.match(r"^https?://pyright-play\.net(?:[/?#]|$)", url, re.IGNORECASE) is None:
        return []
    parsed = urlsplit(url)
    if parsed.scheme not in {"http", "https"} or parsed.netloc.lower() != "pyright-play.net" or parsed.path not in {"", "/"}:
        return []
    if not parsed.query:
        return []
    pairs = parsed.query.split("&")
    if len(pairs) > 128:
        raise ValueError("Playground query exceeds 128 fields; no settings selected")
    cursor = start + url.index("?") + 1
    declarations = []
    for pair in pairs:
        key, separator, raw_value = pair.partition("=")
        end = cursor + len(pair)
        if re.search(r"%(?![0-9a-fA-F]{2})", key):
            raise ValueError("Malformed percent escape in playground setting name")
        key = unquote_plus(key, errors="strict")
        if key in {
            "pythonVersion", "typeCheckingMode", "pythonPlatform", "enableExperimentalFeatures", "pyrightVersion",
            "strict", "extraPaths", "stubPath", "typeshedPath", "venv", "venvPath", "executionEnvironments",
            "extends", "include", "exclude", "ignore",
        } or re.fullmatch(r"report[A-Z]\w*", key):
            if not separator or re.search(r"%(?![0-9a-fA-F]{2})", raw_value):
                raise ValueError(f"Malformed playground setting {key!r}")
            value: JsonValue = unquote_plus(raw_value, errors="strict")
            if key == "strict":
                key, value = "typeCheckingMode", "strict" if value == "true" else value
            elif (key == "enableExperimentalFeatures" or key.startswith("report")) and value in {"true", "false"}:
                value = value == "true"
            declarations.append(_declaration(
                report_hash, document, key, value, cursor, end, declaration_kind="playground_query",
            ))
        cursor = end + 1
    return declarations


def reported_diagnostics(capture: SourceCapture) -> list[ReportedDiagnostic]:
    """Bounded CLI-rendered candidates, not a complete diagnostic inventory or observations."""
    header = re.compile(r"^  .+:\d+:\d+ - (?:error|warning|information): (.+)$")
    boundary = re.compile(r"^ {2,3}(?=\S)(?:.*(?: - |: ))?(?:error|warning|information): ")
    rule_suffix = re.compile(r" \((report[A-Z]\w*)\)$")
    results = []
    documents = {item.id: item for item in capture.documents}
    for block in capture.blocks:
        if block.source_kind not in {"other", "unclassified"}:
            continue
        lines = _lines(block.content)
        index = 0
        while index < len(lines):
            _, offset, line = lines[index]
            match = header.fullmatch(line.rstrip("\r\n"))
            index += 1
            if match is None:
                continue
            message_lines = [match[1]]
            end = offset + len(line.rstrip("\r\n"))
            ambiguous = False
            while index < len(lines) and not rule_suffix.search(message_lines[-1]):
                continuation = lines[index][2].rstrip("\r\n")
                if not continuation.startswith("  ") or boundary.match(continuation):
                    break
                if continuation[2:] and not continuation[2:3].isspace():
                    ambiguous = True
                    break
                message_lines.append(continuation[2:])
                end = lines[index][1] + len(continuation)
                index += 1
            if ambiguous:
                continue
            message = "\n".join(message_lines)
            rendered = block.content[offset + match.start(1):end]
            rule = rule_suffix.search(message)
            if rule:
                message = message[:rule.start()]
                rendered = rendered[:rendered.rfind(" (" + rule[1] + ")")]
            start, stop = _raw_source_offset(block, offset), _raw_source_offset(block, end)
            quote = documents[block.document_id].text[start:stop]
            if not message or max(len(quote), len(message), len(rendered)) > 4096:
                continue
            results.append(ReportedDiagnostic(
                output_block_id=block.id, message=message, rendered_message=rendered, rule=rule[1] if rule else None,
                evidence=EvidenceSpan(document_id=block.document_id, start=start, end=stop, quote=quote),
            ))
    return results


def capture_sources(report_id: str, documents: Sequence[ReportDocument]) -> SourceCapture:
    """Capture every supplied fence independently; never reconstruct or join code."""
    if not documents or len(documents) > 128:
        raise ValueError("Capture requires 1-128 separately identified report documents")
    documents = tuple(sorted(documents, key=lambda item: item.id))
    if len({item.id for item in documents}) != len(documents):
        raise ValueError("Duplicate report document IDs")
    if sum(item.kind == "issue_body" for item in documents) != 1:
        raise ValueError("Capture requires exactly one issue body")
    if sum(len(item.text) for item in documents) > 1048576:
        raise ValueError("Report documents exceed the total capture bound")
    report_hash = fingerprint([report_id, [item.model_dump(mode="json") for item in documents]])
    blocks: list[CapturedSource] = []
    declarations: list[ReportedDeclaration] = []
    limitations: list[SourceLimitation] = []
    for document in documents:
        lines = _lines(document.text)
        excluded: list[tuple[int, int]] = []
        index = 0
        previous = None
        while index < len(lines):
            number, start, line = lines[index]
            value = line.rstrip("\r\n")
            opening = re.fullmatch(r"( {0,3})(`{3,}|~{3,})(.*)", value)
            candidate = re.fullmatch(r"([ \t>]*(?:(?:[-+*]|\d+[.)])[ \t]+)?)(`{3,}|~{3,})(.*)", value)
            if candidate is None:
                if re.match(r"(?: {4,}|\t)\S", value):
                    excluded.append((start, start + len(line)))
                    limitations.append(SourceLimitation(
                        code="unsupported_indented_code", document_id=document.id, start=start, end=start + len(line),
                        detail="Indented code or a deeper container needs explicit reconstruction; it is not captured as source.",
                    ))
                if value.strip():
                    previous = lines[index]
                index += 1
                continue
            marker = candidate[2]
            closing = index + 1
            while closing < len(lines) and not re.fullmatch(
                r"[ \t>]*" + re.escape(marker[0]) + "{" + str(len(marker)) + r",}[ \t]*",
                lines[closing][2].rstrip("\r\n"),
            ):
                closing += 1
            end = lines[closing][1] + len(lines[closing][2]) if closing < len(lines) else len(document.text)
            excluded.append((start, end))
            code = None
            detail = ""
            if opening is None or (closing < len(lines) and not re.fullmatch(
                r" {0,3}" + re.escape(marker[0]) + "{" + str(len(marker)) + r",}[ \t]*",
                lines[closing][2].rstrip("\r\n"),
            )):
                code, detail = "unsupported_container", "Tabs, deeper indentation and explicit list/quote fence containers are unsupported."
            elif marker[0] == "`" and "`" in opening[3]:
                code, detail = "invalid_info", "A backtick fence cannot contain backticks in its info string."
            elif closing == len(lines):
                code, detail = "unclosed_fence", "A whole closed fence is required; no implicit end-of-document closing."
            raw = "".join(item[2] for item in lines[index + 1:closing])
            indentation = len(opening[1]) if opening else 0
            if code is None and any("\t" in item[2][:indentation] for item in lines[index + 1:closing]):
                code, detail = "ambiguous_tabs", "Structural tab expansion is ambiguous; Python indentation is not rewritten."
            if code is None and (len(raw) > MAX_SOURCE_CHARS or len(candidate[3]) > 1024):
                code, detail = "oversized_block", "Source or fence metadata exceeds the capture bound; it is not truncated."
            if code is not None:
                limitations.append(SourceLimitation(
                    code=code, document_id=document.id, start=start, end=end, detail=detail,
                ))
            else:
                content = "".join(
                    item[2][min(indentation, len(item[2]) - len(item[2].lstrip(" "))):]
                    for item in lines[index + 1:closing]
                )
                info = candidate[3]
                language = info.strip().split(maxsplit=1)[0].lower() if info.strip() else None
                association_error = None
                try:
                    filename, filename_evidence = _filename(document, info, start + len(candidate[1]) + len(marker), previous)
                except ValueError as error:
                    filename, filename_evidence, association_error = None, None, str(error)
                    limitations.append(SourceLimitation(
                        code="ambiguous_filename", document_id=document.id, start=start, end=end, detail=str(error),
                    ))
                config_keys = re.search(
                    r"""(?:["']?)(?:pythonVersion|typeCheckingMode|pythonPlatform|enableExperimentalFeatures|extraPaths|executionEnvironments|report[A-Z]\w*)(?:["']?)\s*[:=]""",
                    content,
                )
                config_hint = (
                    filename in {"pyrightconfig.json", "pyproject.toml"}
                    or language in {"json", "jsonc", "toml", "ini", "yaml"} and bool(config_keys)
                    or language is None and content.lstrip().startswith("{") and bool(config_keys)
                )
                kind = "configuration" if config_hint else (
                    "python" if language in {"python", "py", "python3", "pyi"} else "unclassified" if language is None else "other"
                )
                data = {
                    "document_id": document.id, "start": start, "end": end,
                    "content_start": start + len(line), "content_end": lines[closing][1],
                    "opening_line": number, "closing_line": lines[closing][0],
                    "raw_content": raw, "content": content, "raw_sha256": _sha(raw), "canonical_sha256": _sha(content),
                    "source_kind": kind,
                    "language_hint": language, "filename_hint": filename, "filename_evidence": filename_evidence,
                    "association_error": association_error,
                    "info": info, "transform": "identity" if indentation == 0 else "opening_fence_spaces_only",
                    "indentation": indentation,
                }
                source_id = "source-" + fingerprint([report_hash, document.id, start, end, _sha(raw), _sha(content)])
                block = CapturedSource(id=source_id, **data)
                blocks.append(block)
                if language in {"sh", "shell", "bash", "console"}:
                    try:
                        declarations.extend(_shell_declarations(report_hash, document, block))
                    except ValueError as error:
                        limitations.append(SourceLimitation(
                            code="invalid_configuration", document_id=document.id, start=start, end=end, detail=str(error),
                        ))
                if config_hint:
                    try:
                        if language in {"toml", "jsonc", "ini", "yaml"} or filename == "pyproject.toml":
                            raise ValueError("Only complete standard JSON configuration objects are supported")
                        declarations.extend(_configuration_declarations(report_hash, document, block))
                    except (ValueError, IndexError) as error:
                        limitations.append(SourceLimitation(
                            code="invalid_configuration", document_id=document.id, start=start, end=end, detail=str(error),
                        ))
            index = closing + 1
            previous = None
            if len(blocks) > MAX_BLOCKS or len(limitations) > 256:
                raise ValueError("Report exceeds the bounded source/limitation count; nothing is silently omitted")
        for url in re.finditer(r"""https?://[^\s<>()`"']+""", document.text, re.IGNORECASE):
            if any(start <= url.start() < end for start, end in excluded):
                continue
            excluded.append(url.span())
            try:
                declarations.extend(_playground_declarations(report_hash, document, url.start(), url.group()))
            except ValueError as error:
                limitations.append(SourceLimitation(
                    code="invalid_configuration", document_id=document.id, start=url.start(), end=url.end(),
                    detail=f"Unsupported playground declarations: {error}",
                ))
        # URLs are parsed separately; URL suffixes and encoded source cannot
        # masquerade as free-standing prose settings.
        patterns: list[tuple[str, str, DeclarationKind]] = [
            ("pythonVersion", r'(?i)\bPython[ \t]+(?:version[ \t]*[:=]?[ \t]+)?`?([0-9][A-Za-z0-9_.+-]*)', "interpreter_version"),
            ("pythonVersion", r'(?i)\bPython[ \t]+version[ \t]*[:=]?[ \t]+`?([^\s`,;]+)', "interpreter_version"),
            ("pythonVersion", r'--pythonversion(?:=|[ \t]+)([^\s`,;]+)', "checker_cli"),
            ("pyrightVersion", r'(?i)\bPyright(?:[ \t]+version)?(?:[ \t]*[:=]?[ \t]+|==|-)`?(1\.\d+\.\d+)', "checker_version"),
            ("typing_extensions", r'\btyping[_-]extensions(?:[ \t]+version)?(?:==|[ :=]+)`?(\d+(?:\.\d+){1,3})', "dependency_version"),
        ]
        setting_names = [
            "pythonVersion", "typeCheckingMode", "pythonPlatform", "enableExperimentalFeatures",
            *sorted(set(re.findall(r"\breport[A-Z]\w*\b", document.text))),
        ]
        for setting in setting_names:
            patterns.append((setting, rf"""(?<!\w)["']?{setting}["']?[ \t]*[:=][ \t]*("(?:[^"\\\r\n]|\\.)*"|'[^'\r\n]*'|`[^`\r\n]*`|[^\s,;]+)""", "literal_setting"))
        for setting in ("extraPaths", "stubPath", "typeshedPath", "venv", "venvPath", "executionEnvironments", "extends", "include", "exclude", "ignore"):
            patterns.append((setting, rf"""(?<!\w)["']?{setting}["']?[ \t]*[:=][ \t]*([^\r\n]+)""", "literal_setting"))
        seen = set()
        for setting, pattern, kind in patterns:
            for match in re.finditer(pattern, document.text):
                if any(start <= match.start() < end for start, end in excluded):
                    continue
                value: JsonValue = match[1]
                end = match.end()
                if (
                    kind == "interpreter_version"
                    and document.text[match.start(1) - 1:match.start(1)] != "`"
                    and re.fullmatch(r"3\.\d{1,2}(?:\.\d+)?\.", match[1])
                    and (end == len(document.text) or document.text[end].isspace())
                ):
                    value = match[1][:-1]
                    end -= 1
                key = setting, match.start(), end
                if key in seen:
                    continue
                seen.add(key)
                if setting in setting_names and isinstance(value, str) and value[:1] in {"'", '"', "`"}:
                    if value.startswith('"'):
                        try:
                            value = json.loads(value)
                        except json.JSONDecodeError as error:
                            limitations.append(SourceLimitation(
                                code="invalid_configuration", document_id=document.id,
                                start=match.start(), end=match.end(), detail=f"Invalid quoted setting value: {error}",
                            ))
                    else:
                        value = value[1:-1]
                if (setting == "enableExperimentalFeatures" or setting.startswith("report")) and value in ("true", "false"):
                    value = value == "true"
                declarations.append(_declaration(
                    report_hash, document, setting, value, match.start(), end, declaration_kind=kind,
                ))
    data = {
        "report_id": report_id, "report_hash": report_hash, "documents": documents,
        "blocks": tuple(blocks), "declarations": tuple(declarations), "limitations": tuple(limitations),
    }
    capture = SourceCapture(**data, digest="0" * 64)
    return capture.model_copy(update={"digest": _record_hash(capture)})


def verify_capture(capture: SourceCapture) -> None:
    expected = capture_sources(capture.report_id, capture.documents)
    if expected != capture:
        raise ValueError("Source capture changed or does not match its report/source provenance")


def _source_path(name: str) -> str:
    path = relative_path(name)
    if (
        path.suffix not in {".py", ".pyi"} or len(name) > 512
        or any(character in name for character in '<>"|?*\x00')
        or any(ord(character) < 32 for character in name)
        or any(part.endswith((" ", ".")) for part in path.parts)
    ):
        raise ValueError("Source associations require ordinary relative Python/stub paths")
    for part in path.parts:
        relative_path(part)
    return str(path)


def _declaration_unit(capture: SourceCapture, declaration: ReportedDeclaration) -> tuple[str, int, int]:
    span = declaration.evidence
    if declaration.source_id is not None:
        block = next(item for item in capture.blocks if item.id == declaration.source_id)
        return block.document_id, block.start, block.end
    text = next(item.text for item in capture.documents if item.id == span.document_id)
    if declaration.declaration_kind == "playground_query":
        for match in re.finditer(r"""https?://[^\s<>()`"']+""", text, re.IGNORECASE):
            if match.start() <= span.start and span.end <= match.end():
                return span.document_id, match.start(), match.end()
        raise ValueError("Captured playground declaration has no complete URL")
    separators = [
        (offset, offset + len(line)) for _, offset, line in _lines(text) if not line.rstrip("\r\n").strip(" \t")
    ]
    separators.extend((block.start, block.end) for block in capture.blocks if block.document_id == span.document_id)
    start = max((end for _, end in separators if end <= span.start), default=0)
    end = min((start for start, _ in separators if start >= span.end), default=len(text))
    return span.document_id, start, end


def _selected_declarations(
    capture: SourceCapture, selections: Sequence[ReportedSettingSelection],
) -> list[ReportedDeclaration]:
    if len(selections) > 2 or len({item.setting for item in selections}) != len(selections):
        raise ValueError("Reported setting selections must be unique and bounded")
    chosen: dict[str, set[str]] = {}
    by_id = {item.id: item for item in capture.declarations}
    for selection in selections:
        verify_span(capture, selection.context)
        identifiers = set(selection.declaration_ids)
        if len(identifiers) != len(selection.declaration_ids) or not identifiers <= by_id.keys():
            raise ValueError("Reported setting selection requires unique captured declaration IDs")
        selected = [by_id[identifier] for identifier in selection.declaration_ids]
        if any(
            item.setting != selection.setting or item.evidence.document_id != selection.context.document_id
            or not selection.context.start <= item.evidence.start < item.evidence.end <= selection.context.end
            for item in selected
        ):
            raise ValueError("Reported setting selection must match its setting and exact captured context")
        unit = _declaration_unit(capture, selected[0])
        if any(_declaration_unit(capture, item) != unit for item in selected):
            raise ValueError("Select one complete reported configuration, URL or prose paragraph per setting")
        required = {
            item.id for item in capture.declarations if item.setting == selection.setting
            and (
                _declaration_unit(capture, item) == unit
                or item.evidence.document_id == selection.context.document_id
                and selection.context.start < item.evidence.end and item.evidence.start < selection.context.end
            )
        }
        if identifiers != required:
            raise ValueError("Reported setting selection cannot omit declarations from the same configuration or context")
        if any(not item.supported for item in capture.declarations if item.setting == selection.setting):
            raise ValueError("Reported setting selection cannot bypass unsupported or invalid reported declarations")
        chosen[selection.setting] = identifiers
    for selection in selections:
        unit = _declaration_unit(capture, by_id[selection.declaration_ids[0]])
        if any(
            item.setting in chosen and item.id not in chosen[item.setting]
            and _declaration_unit(capture, item) == unit for item in capture.declarations
        ):
            raise ValueError("Reported settings from one configuration must stay together; no hybrid original/control setup")
    return [
        item for item in capture.declarations if item.setting not in chosen or item.id in chosen[item.setting]
    ]


def source_document_settings(capture: SourceCapture, source_id: str) -> list[ReportedSettingSelection]:
    """Choose a conditional source-document setup, not an authoritative resolution of discussion."""
    verify_capture(capture)
    source = next((item for item in capture.blocks if item.id == source_id), None)
    if source is None or source.source_kind != "python":
        raise ValueError("Conditional source-document settings require captured Python source")
    selected = []
    for setting in ("pythonVersion", "typeCheckingMode"):
        declarations = [item for item in capture.declarations if item.setting == setting]
        local = [item for item in declarations if item.evidence.document_id == source.document_id]
        if (
            not local or len(local) == len(declarations) or not all(item.supported for item in local)
            or len({fingerprint(item.value) for item in local}) != 1
        ):
            continue
        document_id, start, end = _declaration_unit(capture, local[0])
        document = next(item for item in capture.documents if item.id == document_id)
        if end - start > 4096:
            continue
        selected.append(ReportedSettingSelection(
            setting=setting,
            declaration_ids=tuple(
                item.id for item in local if _declaration_unit(capture, item) == (document_id, start, end)
            ),
            context=EvidenceSpan(document_id=document_id, start=start, end=end, quote=document.text[start:end]),
            reason=(
                "Controller-selected settings from the document containing the captured source, for a conditional "
                "diagnostic experiment only. Other discussion may qualify or correct this setup."
            ),
        ))
    return selected


def reported_setting_qualifications(
    prepared: MaterializedSetup, capture: SourceCapture | None = None,
) -> list[str]:
    qualifications = [
        f"Conditional reported setup: {selection.setting} uses captured declarations "
        + ", ".join(selection.declaration_ids)
        + ". Their association with this example is a conditional reconstruction, not independently "
        "approved historical configuration. Other captured declarations remain comparison/context, not verified settings."
        + (f" Selection: {selection.context.quote} Reason: {selection.reason}" if capture is not None else "")
        for selection in prepared.reported_settings
    ]
    if capture is not None:
        selected = {identifier for item in prepared.reported_settings for identifier in item.declaration_ids}
        for declaration in prepared.scoped_declarations:
            if declaration.id in selected:
                continue
            document_id, start, end = _declaration_unit(capture, declaration)
            document = next(item for item in capture.documents if item.id == document_id)
            context = document.text[start:end] if end - start <= 4096 else (
                declaration.evidence.quote + " (declaration excerpt; full context is retained in capture.json)"
            )
            qualifications.append(
                f"Other captured {declaration.setting}={declaration.value} at {document.provenance}: {context} "
                "Retained as comparison or possible correction, not discarded or ruled irrelevant."
            )
    return qualifications


def materialize_setup(
    capture: SourceCapture, associations: Sequence[SourceAssociation], setting_choices: Sequence[SettingChoice] = (),
    *, reported_settings: Sequence[ReportedSettingSelection] = (),
) -> MaterializedSetup:
    """Resolve IDs, never model source strings; keep assumptions and limitations explicit.

    Missing original source is a blocked record, not permission to reconstruct it.
    Unselected source limitations remain visible without suppressing independent
    source-supported claims. Explicit per-example reported selections are conditional;
    otherwise ambiguous global configuration still blocks setup.
    """
    verify_capture(capture)
    if len(associations) > 30:
        raise ValueError("Materialization permits at most 30 source associations")
    if len(setting_choices) > 2 or len({item.setting for item in setting_choices}) != len(setting_choices):
        raise ValueError("Setting assumptions must be unique and bounded")
    sources = {item.id: item for item in capture.blocks}
    files: dict[str, str] = {}
    used = set()
    inferred = []
    for association in associations:
        source = sources.get(association.source_id)
        if source is None:
            raise ValueError("Source ID does not belong to this captured report")
        if source.association_error:
            raise ValueError(source.association_error)
        name = _source_path(association.path)
        if source.id in used or name.casefold() in {key.casefold() for key in files}:
            raise ValueError("Duplicate source association or aliased file path")
        if source.source_kind not in {"python", "unclassified"}:
            raise ValueError("Non-Python/output/configuration fences cannot be associated as Python source")
        if len(source.content.encode("utf-8")) > MAX_SOURCE_CHARS:
            raise ValueError("Source exceeds the reproduction byte bound")
        if source.filename_hint is not None and _source_path(source.filename_hint) != name:
            raise ValueError("Source association conflicts with the explicitly reported filename")
        if association.filename_quote is not None:
            if source.filename_evidence is None or association.filename_quote != source.filename_evidence.quote:
                raise ValueError("Filename quote must match the captured source's explicit filename evidence")
        if source.filename_evidence is None:
            inferred.append(name)
        files[name] = source.content
        used.add(source.id)
    configuration: dict[str, JsonValue] = {}
    blockers: list[str] = [
        f"{item.code} in {item.document_id} at {item.start}:{item.end}: {item.detail}"
        for item in capture.limitations if item.code == "invalid_configuration"
    ]
    if not files:
        blockers.append("Missing original source: no captured source IDs selected")
    elif not any(Path(name).suffix == ".py" for name in files):
        blockers.append("No original analyzed Python (.py) source selected")
    declarations: dict[str, list[ReportedDeclaration]] = {}
    derivations: list[SettingDerivation] = []
    for declaration in _selected_declarations(capture, reported_settings):
        declarations.setdefault(declaration.setting, []).append(declaration)
    for setting, values in sorted(declarations.items()):
        runtime = [item for item in values if item.declaration_kind == "interpreter_version"]
        targets = [
            ".".join(str(item.value).split(".")[:2]) if item in runtime and item.supported else item.value
            for item in values
        ]
        distinct = {fingerprint(value) for value in targets}
        exact_runtime = {
            item.value for item in runtime
            if isinstance(item.value, str) and item.supported and item.value.count(".") == 2
        }
        if len(distinct) != 1 or len(exact_runtime) > 1:
            blockers.append(f"Conflicting reported {setting} declarations; no value selected")
        elif not all(item.supported for item in values):
            blockers.append(f"Unsupported or invalid reported {setting}; no value selected")
        elif setting not in {"pyrightVersion", "typing_extensions"}:
            configuration[setting] = targets[0]
            for item in runtime:
                if item.value != targets[0]:
                    derivations.append(SettingDerivation(
                        setting="pythonVersion", value=str(targets[0]), declaration_ids=(item.id,),
                        reported_values=(str(item.value),), transform="interpreter_major_minor",
                    ))
    for choice in setting_choices:
        if choice.value not in EXPLORATORY_SETTINGS[choice.setting]:
            raise ValueError("Setting assumption is outside the controller's bounded experiments")
        if choice.setting in declarations:
            raise ValueError(
                "An assumption cannot replace or relabel any reported declaration. "
                f"Remove {choice.setting} from setting_choices: captured reported values are materialized automatically. "
                "For different original/control settings, use claim.reported_settings with captured declaration IDs "
                "and exact context, never assumptions. Do not change reported values to make validation pass."
            )
        configuration[choice.setting] = choice.value
    for setting in ("pythonVersion", "typeCheckingMode"):
        if setting not in configuration and setting not in declarations:
            blockers.append(f"Missing reported {setting}; no disclosed bounded experiment supplied")
    data = {
        "files": files, "configuration": configuration, "blockers": tuple(blockers),
        "assumptions": tuple(setting_choices), "derivations": tuple(derivations),
        "reported_settings": tuple(reported_settings),
        "scoped_declarations": tuple(
            item for item in capture.declarations if any(item.setting == choice.setting for choice in reported_settings)
        ),
        "source_ids": tuple(item.source_id for item in associations),
        "associations": tuple(associations), "inferred_paths": tuple(inferred),
        "limitations": capture.limitations,
        "hashes": {
            **{name: _sha(content) for name, content in files.items()},
            "$capture": capture.digest, "$configuration": fingerprint(configuration),
        },
    }
    setup = MaterializedSetup(**data, digest="0" * 64)
    return setup.model_copy(update={"digest": _record_hash(setup)})


def verify_materialized_setup(
    capture: SourceCapture, associations: Sequence[SourceAssociation], setting_choices: Sequence[SettingChoice],
    prepared: MaterializedSetup,
    *, reported_settings: Sequence[ReportedSettingSelection] = (),
) -> None:
    if materialize_setup(capture, associations, setting_choices, reported_settings=reported_settings) != prepared:
        raise ValueError("Materialized original source/setup changed after capture or selection")


class SetupRequirement(CapturedRecord):
    id: Label
    kind: RequirementKind
    name: Label
    version: Label | None = None
    feature: Label | None = None
    target_id: Label | None = None
    declaration_ids: tuple[Label, ...] = Field(default=(), max_length=32)


def _import_names(tokens: Sequence[tokenize.TokenInfo]) -> list[tuple[str, str | None]]:
    if tokens and tokens[0].string == "(" and tokens[-1].string == ")":
        tokens = tokens[1:-1]
    names = []
    index = 0
    while index < len(tokens):
        if tokens[index].type != tokenize.NAME and tokens[index].string != "*":
            raise ValueError("Unrecognized import binding")
        name = tokens[index].string
        index += 1
        while index < len(tokens) and tokens[index].string == ".":
            if index + 1 == len(tokens) or tokens[index + 1].type != tokenize.NAME:
                raise ValueError("Unrecognized dotted import")
            name += "." + tokens[index + 1].string
            index += 2
        alias = None
        if index < len(tokens) and tokens[index].string == "as":
            if index + 1 == len(tokens) or tokens[index + 1].type != tokenize.NAME:
                raise ValueError("Unrecognized import alias")
            alias = tokens[index + 1].string
            index += 2
        names.append((name, alias))
        if index < len(tokens):
            if tokens[index].string != ",":
                raise ValueError("Unrecognized import continuation")
            index += 1
    if not names:
        raise ValueError("Import has no identifiable bindings")
    return names


def _token_imports(
    tokens: Sequence[tokenize.TokenInfo],
) -> Iterator[tuple[str | None, int, list[tuple[str, str | None]]]]:
    index = 0
    while index < len(tokens):
        token = tokens[index]
        if token.type != tokenize.NAME or token.string not in {"from", "import"}:
            index += 1
            continue
        end = index + 1
        while end < len(tokens) and tokens[end].type != tokenize.NEWLINE and tokens[end].string != ";":
            end += 1
        statement = tokens[index + 1:end]
        if token.string == "import":
            yield None, 0, _import_names(statement)
        else:
            split = next((
                position for position, item in enumerate(statement)
                if item.type == tokenize.NAME and item.string == "import"
            ), None)
            if split is None:
                # "yield from" and exception chaining are not imports.
                index += 1
                continue
            module_tokens = statement[:split]
            relative = 0
            while module_tokens and module_tokens[0].string in {".", "..."}:
                relative += len(module_tokens[0].string)
                module_tokens = module_tokens[1:]
            module = ""
            if module_tokens:
                modules = _import_names(module_tokens)
                if len(modules) != 1 or modules[0][1] is not None or modules[0][0] == "*":
                    raise ValueError("Unrecognized from-import module")
                module = modules[0][0]
            elif not relative:
                raise ValueError("From-import has no module")
            yield module, relative, _import_names(statement[split + 1:])
        index = end


def inspect_requirements(capture: SourceCapture, prepared: MaterializedSetup) -> tuple[SetupRequirement, ...]:
    """Token-only import inventory; never parse, import or execute reporter code.

    Only the listed common stdlib module roots are handled without an additional
    requirement. This does not validate Python grammar, target support or full
    dependency compatibility. Lexically ambiguous/dynamic/unhandled imports stay
    explicit; newer grammar alone cannot make the host reject a checker target.
    """
    verify_materialized_setup(
        capture, prepared.associations, prepared.assumptions, prepared, reported_settings=prepared.reported_settings,
    )
    stdlib = {
        "__future__", "abc", "array", "asyncio", "builtins", "collections", "contextlib", "copy", "dataclasses",
        "datetime", "decimal", "enum", "functools", "inspect", "io", "itertools", "math", "operator", "os",
        "pathlib", "re", "sys", "types", "typing", "unittest",
    }
    requirements: dict[str, SetupRequirement] = {}
    def add(kind: RequirementKind, name: str, feature: str | None = None, version: str | None = None,
            declaration_ids: tuple[str, ...] = ()) -> None:
        key = fingerprint([capture.digest, prepared.digest, kind, name, feature, version, declaration_ids])
        requirements[key] = SetupRequirement(
            id="setup-" + key, kind=kind, name=name, feature=feature, version=version, declaration_ids=declaration_ids,
        )
        if len(requirements) > 64:
            raise ValueError("Selected source group exceeds the bounded setup inventory; no requirement was omitted")
    local_modules = set()
    for name in prepared.files:
        path = Path(name).with_suffix("")
        parts = path.parts[:-1] if path.name == "__init__" else path.parts
        if parts:
            local_modules.add(".".join(parts))
    def local_module(module: str) -> bool:
        return module in local_modules or any(name.startswith(module + ".") for name in local_modules)
    for name, content in prepared.files.items():
        tokens = []
        try:
            for item in tokenize.generate_tokens(io.StringIO(content).readline):
                if item.type not in {tokenize.COMMENT, tokenize.NL, tokenize.INDENT, tokenize.DEDENT, tokenize.ENDMARKER}:
                    tokens.append(item)
            if any(item.type == tokenize.ERRORTOKEN and not item.string.isspace() for item in tokens):
                raise ValueError("Unrecognized lexical token")
        except (tokenize.TokenError, SyntaxError, ValueError) as error:
            add("unsupported", name, feature=f"lexical import inventory unavailable: {type(error).__name__}")
        imports = []
        try:
            for statement in _token_imports(tokens):
                imports.append(statement)
        except ValueError:
            add("unsupported", name, feature="lexical import inventory unavailable: unrecognized import statement")
        extension_aliases = {
            alias or module for origin, _, bindings in imports if origin is None
            for module, alias in bindings if module == "typing_extensions"
        }
        dynamic_aliases = {
            alias or binding for origin, _, bindings in imports if origin == "importlib"
            for binding, alias in bindings if binding == "import_module"
        }
        for index, token in enumerate(tokens):
            if token.type == tokenize.NAME and token.string in {"__import__", "import_module", *dynamic_aliases}:
                add("unsupported", name, feature="dynamic import resolution")
            if (
                token.type == tokenize.NAME and token.string in extension_aliases and index + 2 < len(tokens)
                and tokens[index + 1].string == "." and tokens[index + 2].type == tokenize.NAME
            ):
                add("static_feature", "typing_extensions", feature=tokens[index + 2].string)
        for origin, relative, bindings in imports:
            if relative:
                base = Path(name).parent.parts
                if relative > len(base) + 1:
                    add("unsupported", name, feature="relative import escapes the selected source group")
                    continue
                prefix = base[:len(base) - relative + 1]
                suffixes = [origin] if origin else [binding for binding, _ in bindings]
                for suffix in suffixes:
                    module = ".".join((*prefix, suffix))
                    if not local_module(module):
                        add("unsupported", module, feature="relative import source is not selected")
                continue
            modules = [origin] if origin else [module for module, _ in bindings]
            for module in modules:
                root = module.partition(".")[0]
                if module == "typing_extensions":
                    add("static_stubs", "typing_extensions")
                    if origin is not None:
                        for binding, _ in bindings:
                            add(
                                "unsupported" if binding == "*" else "static_feature",
                                "typing_extensions", feature=binding,
                            )
                elif root not in stdlib and not local_module(module):
                    add("unsupported", root or name, feature="external static dependency resolution")
    declarations = tuple(item for item in capture.declarations if item.setting == "typing_extensions")
    for declaration in declarations:
        add(
            "static_stubs" if declaration.supported else "unsupported", "typing_extensions",
            version=str(declaration.value), declaration_ids=(declaration.id,),
        )
    return tuple(requirements[key] for key in sorted(requirements))


class ArtifactEvidence(CapturedRecord):
    locator: BoundedText
    sha256: Digest


class SetupCapability(CapturedRecord):
    requirement_hash: Digest
    status: CapabilityStatus
    provider: Literal["trusted_target", "bundled_stubs", "installed_metadata", "approved_probe", "none"]
    observed_version: Label | None = None
    evidence: tuple[ArtifactEvidence, ...] = Field(default=(), max_length=8)
    detail: BoundedText
    digest: Digest


class SetupResolution(CapturedRecord):
    status: Literal["ready", "partial", "blocked"]
    capabilities: tuple[SetupCapability, ...] = Field(max_length=64)
    blockers: tuple[BoundedText, ...] = Field(max_length=64)
    digest: Digest


def _capability(
    requirement: SetupRequirement, status: CapabilityStatus, detail: str, *,
    provider: Literal["trusted_target", "bundled_stubs", "installed_metadata", "approved_probe", "none"] = "none",
    version: str | None = None, evidence: tuple[ArtifactEvidence, ...] = (),
) -> SetupCapability:
    capability = SetupCapability(
        requirement_hash=_record_hash(requirement), status=status, provider=provider, observed_version=version,
        evidence=evidence, detail=detail, digest="0" * 64,
    )
    return capability.model_copy(update={"digest": _record_hash(capability)})


def check_target_capability(
    requirement: SetupRequirement, target: ReproductionTarget, verify_target: Callable[[ReproductionTarget], None],
) -> SetupCapability:
    """Use TargetStore.verify (or a clearly labelled offline fake), never acquisition."""
    if requirement.kind != "checker_target" or requirement.name != "pyright" or requirement.feature is not None:
        return _capability(requirement, "unsupported", "This hook only verifies trusted Pyright checker targets")
    try:
        verify_target(target)
    except (OSError, ValueError) as error:
        return _capability(requirement, "failed", f"Trusted target verification failed: {error}")
    if target.status != "ready" or not target.tree_hash or not target.directory or not target.cli:
        return _capability(requirement, "failed", "Verifier did not establish a ready, integrity-bound checker target")
    if requirement.target_id is not None and requirement.target_id != target.identity:
        return _capability(requirement, "missing", "The approved checker target has a different identity")
    if requirement.version is not None and requirement.version != target.version:
        return _capability(requirement, "missing", "The approved checker target has a different version")
    return _capability(
        requirement, "available", "Pinned target verified; this does not verify report behavior or dependency compatibility",
        provider="trusted_target", version=target.version,
        evidence=(ArtifactEvidence(locator=target.identity, sha256=fingerprint(target.model_dump(mode="json"))),),
    )


def check_bundled_stub_capability(
    requirement: SetupRequirement, target: ReproductionTarget, verify_target: Callable[[ReproductionTarget], None],
) -> SetupCapability:
    """Check the exact bundled typing_extensions stub, not the runtime distribution."""
    if requirement.kind != "static_stubs" or requirement.name != "typing_extensions":
        return _capability(requirement, "unsupported", "Only bundled typing_extensions static stub availability is supported")
    if requirement.version is not None or requirement.feature is not None:
        return _capability(
            requirement, "unknown",
            "A bundled stub has no runtime distribution version; version/feature compatibility requires separate approved evidence",
        )
    target_requirement = SetupRequirement(id=requirement.id, kind="checker_target", name="pyright", target_id=requirement.target_id)
    checked = check_target_capability(target_requirement, target, verify_target)
    if checked.status != "available":
        return _capability(requirement, checked.status, checked.detail)
    path = Path(target.directory or "") / "dist" / "typeshed-fallback" / "stdlib" / "typing_extensions.pyi"
    try:
        if not path.is_file():
            return _capability(requirement, "missing", "Approved checker does not contain the supported bundled typing_extensions stub")
        if path.is_symlink() or not path.resolve().is_relative_to(Path(target.directory or "").resolve()):
            raise ValueError("Bundled stub escapes the verified target")
        if path.stat().st_size > 1048576:
            raise ValueError("Bundled stub exceeds the inspection bound")
        data = path.read_bytes()
        if not data or len(data) > 1048576:
            raise ValueError("Bundled stub is empty or exceeds the inspection bound")
        verify_target(target)
    except (OSError, ValueError) as error:
        return _capability(requirement, "failed", f"Bundled stub inspection failed: {error}")
    return _capability(
        requirement, "available", "Exact checker-bundled stub exists; no runtime package version or feature semantics inferred",
        provider="bundled_stubs",
        evidence=(
            *checked.evidence,
            ArtifactEvidence(locator=str(path), sha256=hashlib.sha256(data).hexdigest()),
        ),
    )


def check_runtime_metadata(
    requirement: SetupRequirement, metadata_path: Path, expected_sha256: str,
) -> SetupCapability:
    """Read controller-approved installed METADATA bytes without importing a package."""
    if requirement.kind != "runtime_distribution" or requirement.name != "typing_extensions" or requirement.feature:
        return _capability(requirement, "unsupported", "Only installed typing_extensions distribution metadata is supported")
    try:
        if metadata_path.is_symlink() or metadata_path.name != "METADATA":
            raise ValueError("An approved ordinary distribution METADATA file is required")
        if not metadata_path.exists():
            return _capability(requirement, "missing", "Approved distribution METADATA is absent")
        if metadata_path.stat().st_size > 1048576:
            raise ValueError("Approved distribution METADATA exceeds the inspection bound")
        data = metadata_path.read_bytes()
        if len(data) > 1048576 or hashlib.sha256(data).hexdigest() != expected_sha256:
            raise ValueError("Approved distribution METADATA content hash differs or exceeds the bound")
        metadata = BytesParser().parsebytes(data, headersonly=True)
        names, versions = metadata.get_all("Name", []), metadata.get_all("Version", [])
        if len(names) != 1 or len(versions) != 1:
            raise ValueError("Installed metadata requires exactly one Name and Version")
        if names[0].lower().replace("-", "_") != requirement.name or not re.fullmatch(r"\d+(?:\.\d+){1,3}", versions[0]):
            raise ValueError("Installed metadata has an unsupported distribution name or version")
        version = versions[0]
    except (OSError, ValueError, UnicodeError) as error:
        return _capability(requirement, "failed", f"Installed metadata inspection failed: {error}")
    if requirement.version is not None and requirement.version != version:
        return _capability(requirement, "missing", f"Approved installed distribution version is {version}, not {requirement.version}")
    return _capability(
        requirement, "available", "Installed distribution version only; not import resolution, checker stubs or full compatibility",
        provider="installed_metadata", version=version,
        evidence=(ArtifactEvidence(locator=str(metadata_path), sha256=hashlib.sha256(data).hexdigest()),),
    )


class FeatureProbeResult(CapturedRecord):
    requirement_hash: Digest
    target_hash: Digest
    status: CapabilityStatus
    evidence: ArtifactEvidence | None
    detail: BoundedText


def check_feature_capability(
    requirement: SetupRequirement, target: ReproductionTarget, verify_target: Callable[[ReproductionTarget], None],
    probe: Callable[[SetupRequirement, ReproductionTarget], FeatureProbeResult],
) -> SetupCapability:
    """Run an approved static probe and verify its bounded local receipt bytes."""
    if requirement.kind != "static_feature" or not requirement.feature:
        return _capability(requirement, "unsupported", "A named static feature requirement is required")
    if requirement.version is not None:
        return _capability(requirement, "unknown", "A feature probe cannot establish a dependency distribution version")
    checked = check_target_capability(
        SetupRequirement(id=requirement.id, kind="checker_target", name="pyright", target_id=requirement.target_id),
        target, verify_target,
    )
    if checked.status != "available":
        return _capability(requirement, checked.status, checked.detail)
    target_hash = fingerprint(target.model_dump(mode="json"))
    try:
        result = probe(requirement, target)
        verify_target(target)
        if (
            result.requirement_hash != _record_hash(requirement) or result.target_hash != target_hash
            or fingerprint(target.model_dump(mode="json")) != target_hash
            or result.status == "available" and result.evidence is None
        ):
            raise ValueError("Feature receipt is missing or bound to another requirement/target")
        if result.evidence is not None:
            path = Path(result.evidence.locator)
            if not path.is_absolute() or path.is_symlink() or path.stat().st_size > 1048576:
                raise ValueError("Feature probe requires a bounded approved ordinary local receipt")
            if hashlib.sha256(path.read_bytes()).hexdigest() != result.evidence.sha256:
                raise ValueError("Feature probe receipt content hash changed")
    except (OSError, ValueError, TimeoutError) as error:
        return _capability(requirement, "failed", f"Approved static feature probe failed: {error}")
    return _capability(
        requirement, result.status, result.detail, provider="approved_probe",
        evidence=(*checked.evidence, *((result.evidence,) if result.evidence else ())),
    )


def resolve_setup(
    requirements: Sequence[SetupRequirement], capabilities: Sequence[SetupCapability] = (),
) -> SetupResolution:
    if len(requirements) > 64 or len(capabilities) > 64 or len({item.id for item in requirements}) != len(requirements):
        raise ValueError("Setup requirements must be bounded and have unique IDs")
    expected = {_record_hash(item): item for item in requirements}
    supplied = {item.requirement_hash: item for item in capabilities}
    if len(supplied) != len(capabilities) or not supplied.keys() <= expected.keys():
        raise ValueError("Duplicate capability or capability from another requirement")
    results = []
    blockers = []
    for key, requirement in expected.items():
        capability = supplied.get(key) or _capability(
            requirement, "unsupported" if requirement.kind == "unsupported" else "unknown",
            "Unsupported setup requirement" if requirement.kind == "unsupported" else "No approved controller capability check supplied",
        )
        if capability.digest != _record_hash(capability):
            raise ValueError("Setup capability was changed after verification")
        if capability.status == "available":
            providers = {
                "checker_target": "trusted_target", "static_stubs": "bundled_stubs",
                "runtime_distribution": "installed_metadata", "static_feature": "approved_probe",
            }
            if (
                providers.get(requirement.kind) != capability.provider or not capability.evidence
                or requirement.version is not None and capability.observed_version != requirement.version
                or requirement.kind == "static_stubs" and (requirement.version is not None or requirement.feature is not None)
            ):
                raise ValueError("Capability does not establish the requested setup kind/version/feature")
        else:
            blockers.append(f"{requirement.id}: {capability.status}: {capability.detail}")
        results.append(capability)
    available = sum(item.status == "available" for item in results)
    status = "ready" if not blockers else "partial" if available else "blocked"
    resolution = SetupResolution(status=status, capabilities=tuple(results), blockers=tuple(blockers), digest="0" * 64)
    return resolution.model_copy(update={"digest": _record_hash(resolution)})
