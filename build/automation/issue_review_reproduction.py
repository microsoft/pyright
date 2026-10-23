# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

"""Pinned trusted checker targets and immutable, symptom-specific CLI comparisons."""

from __future__ import annotations

import asyncio
import base64
import hashlib
import io
import json
import os
import re
import shutil
import stat
import subprocess
import tarfile
import tempfile
import uuid
from collections.abc import Callable, Mapping
from datetime import datetime
from pathlib import Path, PureWindowsPath
from types import TracebackType
from typing import Literal, Protocol
from urllib.parse import urlparse
from urllib.request import HTTPRedirectHandler, build_opener

from pydantic import BaseModel, Field, JsonValue

from issue_review_models import ExploratoryReproductionScenario, Issue, ReproductionScenario, ReproductionTarget
from issue_review_rca import Runner

VERSION = re.compile(r"1\.[0-9]+\.[0-9]+")
SHA = re.compile(r"[0-9a-f]{40}")
REGISTRY = "https://registry.npmjs.org/pyright"
NPM_REGISTRY = "https://registry.npmjs.org"
MICROSOFT_REGISTRY = "https://packagefeedproxy.microsoft.io/npm"
REGISTRIES = (NPM_REGISTRY, MICROSOFT_REGISTRY)
MICROSOFT_FEED = "https://ms-feed-25.pkgs.visualstudio.com/1es-public/_packaging/npm-public/npm/registry"
UPSTREAM = "https://github.com/microsoft/pyright.git"
MAX_DOWNLOAD = 128 * 1024 * 1024


class ReleaseCatalog(BaseModel):
    versions: dict[str, JsonValue]
    time: dict[str, JsonValue]
    dist_tags: dict[str, str] = Field(alias="dist-tags")


class PackageRepository(BaseModel):
    url: str


class PackageDistribution(BaseModel):
    tarball: str
    integrity: str | None = None
    shasum: str | None = None


class PublishedPackage(BaseModel):
    name: str
    version: str
    repository: PackageRepository
    dist: PackageDistribution


def fingerprint(value: object) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=True).encode()).hexdigest()


def tree_hash(directory: Path) -> str:
    files = {}
    for path in sorted(directory.rglob("*")):
        if path.is_symlink() or not path.resolve().is_relative_to(directory.resolve()):
            raise ValueError("Target/input tree contains a link")
        if path.is_file():
            files[str(path.relative_to(directory))] = hashlib.sha256(path.read_bytes()).hexdigest()
    return fingerprint(files)


class RegistryRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        validate_registry_url(newurl)
        if urlparse(req.full_url).netloc != urlparse(newurl).netloc:
            raise ValueError("Registry redirects must remain on the selected origin")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def registry_base(registry: str) -> str:
    registry = registry.rstrip("/")
    if registry not in REGISTRIES:
        raise ValueError("Select the official npm registry or the explicitly approved Microsoft feed")
    return registry


def artifact_urls(version: str, registry: str) -> set[str]:
    origins = [NPM_REGISTRY]
    if registry == MICROSOFT_REGISTRY:
        origins += [MICROSOFT_REGISTRY, MICROSOFT_FEED]
    return {f"{origin}/pyright/-/pyright-{version}.tgz" for origin in origins}


def validate_registry_url(url: str) -> None:
    parsed = urlparse(url)
    if (
        not any(
            url == f"{registry}/pyright"
            or re.fullmatch(re.escape(registry) + r"/pyright/-/pyright-1\.\d+\.\d+\.tgz", url)
            for registry in REGISTRIES
        )
        or parsed.query or parsed.fragment
    ):
        raise ValueError("Artifact URL is not the trusted Pyright npm registry")


def download(url: str) -> bytes:
    validate_registry_url(url)
    with build_opener(RegistryRedirects()).open(url, timeout=60) as response:
        data = response.read(MAX_DOWNLOAD + 1)
    if len(data) > MAX_DOWNLOAD:
        raise ValueError("Trusted artifact exceeds the download bound")
    return data


def date(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Publication/creation dates require a timezone")
    return parsed


def release_target(
    catalog: ReleaseCatalog, role: Literal["historical", "main", "latest"], version: str, reason: str, approximate: bool,
    *, registry: str = NPM_REGISTRY,
) -> ReproductionTarget:
    registry = registry_base(registry)
    if not VERSION.fullmatch(version):
        raise ValueError("Only exact stable Pyright versions are supported")
    value = catalog.versions.get(version)
    if not isinstance(value, dict) or value.get("name") != "pyright" or value.get("version") != version:
        raise ValueError(f"Published Pyright {version} is unavailable")
    metadata = PublishedPackage.model_validate(value)
    if metadata.repository.url.lower().removeprefix("git+").removesuffix(".git") not in {
        "https://github.com/microsoft/pyright", "git://github.com/microsoft/pyright",
    }:
        raise ValueError("Published package does not identify the trusted upstream project")
    dist = metadata.dist
    if dist.integrity is not None:
        if not re.fullmatch(r"sha512-[A-Za-z0-9+/]+={0,2}", dist.integrity):
            raise ValueError("Published package lacks valid SHA-512 integrity")
        integrity = dist.integrity
    elif registry == MICROSOFT_REGISTRY and re.fullmatch(r"[0-9a-f]{40}", dist.shasum or ""):
        integrity = "sha1-" + base64.b64encode(bytes.fromhex(dist.shasum or "")).decode()
    else:
        raise ValueError(
            "Published package lacks SHA-512 integrity" if registry == NPM_REGISTRY
            else "Microsoft feed package lacks a valid published integrity checksum"
        )
    if dist.tarball not in artifact_urls(version, registry):
        raise ValueError("Unexpected Pyright package artifact URL")
    published = catalog.time.get(version)
    if not isinstance(published, str):
        raise ValueError("Release publication date unavailable")
    date(published)
    return ReproductionTarget(
        role=role, identity=f"npm:pyright@{version}", version=version, source=dist.tarball, registry=registry,
        selection_reason=reason, approximate=approximate, integrity=integrity, published_at=published,
    )


class ReportedVersion(Protocol):
    @property
    def reported_version(self) -> str | None: ...

    @property
    def version_quote(self) -> str | None: ...


def select_targets(
    catalog: ReleaseCatalog | dict, issue: Issue, scenario: ReportedVersion, discussion: str, main_sha: str,
    *, registry: str = NPM_REGISTRY,
) -> list[ReproductionTarget]:
    registry = registry_base(registry)
    catalog = ReleaseCatalog.model_validate(catalog)
    if not SHA.fullmatch(main_sha):
        raise ValueError("Upstream main must be pinned to a full commit SHA")
    report = (issue.title + "\n" + (issue.body or "") + "\n" + discussion)
    explicit = scenario.reported_version
    # Catch an omitted explicit version rather than silently preferring a date approximation.
    reported = set(re.findall(r"(?i)pyright[^\n]{0,50}?\b(1\.\d+\.\d+)\b", report))
    if explicit is not None:
        if (
            not VERSION.fullmatch(explicit) or not scenario.version_quote or scenario.version_quote not in report
            or explicit not in scenario.version_quote or (reported and explicit not in reported)
        ):
            raise ValueError("Explicit reported version has no matching report evidence")
        version, reason, approximate = explicit, "Explicitly reported Pyright version: " + scenario.version_quote, False
    else:
        if reported:
            raise ValueError("Report names a Pyright version; historical approximation is not allowed")
        if not issue.created_at:
            raise ValueError("Issue creation date is unavailable; update date cannot select a historical release")
        created = date(issue.created_at)
        available = [
            (date(published), version) for version, published in catalog.time.items()
            if VERSION.fullmatch(version) and isinstance(published, str) and date(published) <= created
            and version in catalog.versions
        ]
        if not available:
            raise ValueError("No published Pyright release exists on/before issue creation")
        _, version = max(available)
        reason = (
            f"Newest actual npm publication on/before issue creation {issue.created_at}; "
            "approximate historical target, not the reporter's exact binary"
        )
        approximate = True
    def published(role: Literal["historical", "latest"], selected: str | None, why: str, approx: bool) -> ReproductionTarget:
        try:
            if not selected:
                raise ValueError("Latest publication is unavailable")
            return release_target(catalog, role, selected, why, approx, registry=registry)
        except ValueError as error:
            return ReproductionTarget(
                role=role, identity=f"npm:pyright@{selected or 'unavailable'}", version=selected or "unavailable",
                source=f"{registry}/pyright", registry=registry,
                selection_reason=why, approximate=approx, status="blocked", error=str(error),
            )
    return [
        published("historical", version, reason, approximate),
        ReproductionTarget(
            role="main", identity=main_sha, version="pending build", source=UPSTREAM, registry=registry,
            selection_reason="Actual upstream microsoft/pyright main pinned by GitHub commits/main",
        ),
        published("latest", catalog.dist_tags.get("latest"), "Latest actual npm publication at target selection", False),
    ]


def relative_path(name: str) -> Path:
    path = PureWindowsPath(name)
    if path.anchor or ".." in path.parts or ":" in name or not path.parts or path.is_reserved():
        raise ValueError("Scenario paths must be ordinary relative paths")
    return Path(*path.parts)


Phase = Literal["original", "control"]


def validate_exploratory_settings(scenario: ExploratoryReproductionScenario, report: str) -> None:
    if any(
        item.report_quote not in report or not re.search(rf"(?<![\w.]){re.escape(item.value)}(?![\w.])", item.report_quote)
        for item in scenario.reported_configuration
    ):
        raise ValueError("Reported settings need exact report quotes containing their unchanged values")
    explicit: dict[str, set[str]] = {}
    for match in re.finditer(
        r"""(?<!\w)["']?(pythonVersion|typeCheckingMode)["']?\s*[:=]\s*["']?([A-Za-z0-9.]+)""", report
    ):
        key, value = match.groups()
        if (key == "pythonVersion" and re.fullmatch(r"3\.\d+", value)) or (
            key == "typeCheckingMode" and value in {"off", "basic", "standard", "strict"}
        ):
            explicit.setdefault(key, set()).add(value)
    for match in re.finditer(
        r"(?i)(?:\bPython(?:\s+version)?\s*[:=]?\s+|--pythonversion(?:=|\s+))(3\.\d+)(?![\d.])", report
    ):
        explicit.setdefault("pythonVersion", set()).add(match.group(1))
    assumed = {item.setting for item in scenario.configuration_assumptions}
    for key, values in explicit.items():
        if len(values) != 1 or scenario.configuration.get(key) not in values or key in assumed:
            raise ValueError(f"Exploration cannot replace or relabel the reported {key} setting")


def scenario_inputs(scenario: ReproductionScenario, *, phase: Phase = "original") -> dict[str, str]:
    if scenario.prerequisites:
        raise ValueError("Unmet report prerequisites: " + "; ".join(scenario.prerequisites))
    if len({claim.id for claim in scenario.claims}) != len(scenario.claims):
        raise ValueError("Duplicate material claim IDs")
    if scenario.control_files and scenario.control_files.keys() != scenario.files.keys():
        raise ValueError("Separate controls must retain the original source-file set and configuration")
    for sources in [scenario.files, *([scenario.control_files] if scenario.control_files else [])]:
        if not sources or len(sources) > 30:
            raise ValueError("Reproduction requires 1-30 inspected Python/stub files")
        paths = [relative_path(name) for name in sources]
        if len(set(str(path).casefold() for path in paths)) != len(paths):
            raise ValueError("Scenario paths alias the same file")
        for name, content in sources.items():
            path = relative_path(name)
            if path.suffix not in {".py", ".pyi"} or len(content.encode()) > 65536:
                raise ValueError("Scenario files must be bounded, ordinary relative Python paths")
        if not any(name.endswith(".py") for name in sources):
            raise ValueError("At least one analyzed Python source file is required")
    if phase == "control" and not scenario.control_files:
        raise ValueError("No separate instrumented precision controls were supplied")
    files = scenario.files if phase == "original" else scenario.control_files
    configuration = dict(scenario.configuration)
    allowed = {"pythonVersion", "pythonPlatform", "typeCheckingMode", "enableExperimentalFeatures"}
    if any(key not in allowed and not key.startswith("report") for key in configuration):
        raise ValueError("Scenario cannot change paths, imports, plugins or analysis scope")
    if configuration.get("typeCheckingMode") not in {"off", "basic", "standard", "strict"}:
        raise ValueError("An explicit report-faithful typeCheckingMode is required")
    if not re.fullmatch(r"3\.\d+", str(configuration.get("pythonVersion", ""))):
        raise ValueError("An explicit report-faithful Python version is required")
    configuration["include"] = [str(relative_path(name)) for name in sorted(files) if name.endswith(".py")]
    for claim in scenario.claims:
        if claim.surface != "cli":
            raise ValueError(f"Claim {claim.id} requires unsupported {claim.surface} surface; no CLI substitution")
        for symptom in [*claim.broken, *claim.resolved]:
            if symptom.file not in scenario.files or symptom.line > len(scenario.files[symptom.file].splitlines()):
                raise ValueError("Symptom must refer to an actual unmodified original source location")
        precision_files = scenario.control_files or scenario.files
        for symptom in claim.precision:
            if symptom.file not in precision_files or symptom.line > len(precision_files[symptom.file].splitlines()):
                raise ValueError("Precision must refer to an actual original or separate control source location")
        if not any(item.present for item in claim.broken):
            # Missing diagnostics are legitimate symptoms, but their positive precision control must execute.
            if not any(item.present and item.severity == "information" for item in claim.precision):
                raise ValueError("Absence-only symptoms need an affirmative revealed-type control")
    return {**files, "pyrightconfig.json": json.dumps(configuration, sort_keys=True, indent=2) + "\n"}


Outcome = Literal["reproduced", "not_reproduced", "blocked"]
Observation = Literal["reproduced", "not_reproduced", "verified", "blocked"]


def observe_claims(
    scenario: ReproductionScenario, record: dict, problems: list[str] | None = None,
) -> dict[str, Observation]:
    blocked: dict[str, Observation] = {claim.id: "blocked" for claim in scenario.claims}
    def block(reason: str) -> dict[str, Observation]:
        if problems is not None:
            problems.append(reason)
        return blocked
    if record.get("error") or record.get("exit_code") not in (0, 1):
        return block("Checker execution failed or was unavailable; inspect the original error/exit status")
    if not isinstance(record.get("stderr"), str):
        return block("Checker stderr is missing or invalid; effective configuration/setup cannot be verified")
    if record["stderr"].strip():
        return block("Unverified configuration/setup diagnostics on checker stderr:\n" + record["stderr"])
    if record.get("phase") not in {"original", "control"}:
        return block("Checker receipt does not identify an original or separate control execution")
    control = record["phase"] == "control"
    if control and not scenario.control_files:
        return block("Control execution has no separate frozen control inputs")
    try:
        output = json.loads(record["stdout"])
        diagnostics = output["generalDiagnostics"]
        count = output["summary"]["filesAnalyzed"]
        if (
            not isinstance(output["version"], str) or not isinstance(diagnostics, list)
            or not all(isinstance(item, dict) for item in diagnostics)
            or type(count) is not int or count < sum(name.endswith(".py") for name in scenario.files)
            or output["version"] != record["target"]["version"]
        ):
            return block("Invalid CLI JSON, too few/zero analyzed files, or output version differs from the pinned target")
        if any(
            item.get("rule") in {"reportMissingImports", "reportMissingModuleSource"}
            or "could not be resolved" in str(item.get("message"))
            for item in diagnostics
        ):
            return block("Missing imports/module sources prevent a faithful comparison")
        def matches(expected) -> bool:
            found = any(
                Path(item["file"]).resolve() == (Path(record["cwd"]) / relative_path(expected.file)).resolve()
                and item["range"]["start"]["line"] == expected.line - 1
                and item["severity"] == expected.severity
                and item["message"] == expected.message
                and (expected.rule is None or item.get("rule") == expected.rule)
                for item in diagnostics
            )
            return found == expected.present

        precision = control or not scenario.control_files
        if precision and not all(matches(item) for claim in scenario.claims for item in claim.precision):
            return block("Affirmative precision controls failed; missing output or Any/Unknown degradation is not resolution")
        outcomes: dict[str, Observation] = {}
        for claim in scenario.claims:
            if control:
                outcomes[claim.id] = "verified"
                continue
            broken = all(matches(item) for item in claim.broken)
            resolved = all(matches(item) for item in claim.resolved)
            outcomes[claim.id] = (
                "reproduced" if broken and not resolved else
                "not_reproduced" if resolved and not broken else "blocked"
            )
            if outcomes[claim.id] == "blocked" and problems is not None:
                problems.append(f"Claim {claim.id}: broken/resolved predicates do not distinguish the actual symptom")
        allowed = [
            item for claim in scenario.claims
            for item in [
                *([*claim.broken, *claim.resolved] if control else
                  claim.broken if outcomes[claim.id] == "reproduced" else claim.resolved),
                *(claim.precision if precision else []),
            ] if item.present and item.severity in {"error", "warning"}
        ]
        if any(
            item["severity"] in {"error", "warning"} and not any(
                Path(item["file"]).resolve() == (Path(record["cwd"]) / relative_path(expected.file)).resolve()
                and item["range"]["start"]["line"] == expected.line - 1
                and item["message"] == expected.message and item["severity"] == expected.severity
                and (expected.rule is None or item.get("rule") == expected.rule)
                for expected in allowed
            ) for item in diagnostics
        ):
            return block("Unexpected errors/warnings outside declared symptoms and controls; inspect actual diagnostics")
        return outcomes
    except (KeyError, TypeError, ValueError) as error:
        return block(f"Unsupported or malformed checker output: {type(error).__name__}: {error}")


def classify(scenario: ReproductionScenario, record: dict, control: dict | None = None) -> Outcome:
    if record.get("phase") != "original":
        return "blocked"
    outcomes = observe_claims(scenario, record).values()
    if not outcomes or "blocked" in outcomes:
        return "blocked"
    if scenario.control_files and (
        control is None or control.get("phase") != "control"
        or control.get("target") != record.get("target")
        or control.get("scenario_hash") != record.get("scenario_hash")
        or not (observations := observe_claims(scenario, control))
        or any(value != "verified" for value in observations.values())
    ):
        return "blocked"
    return "reproduced" if "reproduced" in outcomes else "not_reproduced"


def remove_owned_directory(directory: Path) -> None:
    def retry_readonly(
        operation: Callable[..., object], name: str,
        error: tuple[type[BaseException], BaseException, TracebackType | None],
    ) -> None:
        if not isinstance(error[1], PermissionError):
            raise error[1]
        Path(name).chmod(stat.S_IREAD | stat.S_IWRITE)
        operation(name)
    path = str(directory)
    if os.name == "nt" and not path.startswith("\\\\?\\"):
        path = "\\\\?\\UNC\\" + path[2:] if path.startswith("\\\\") else "\\\\?\\" + path
    shutil.rmtree(path, onerror=retry_readonly)


class TargetStore:
    def __init__(self, directory: Path, runner: Runner, *, registry: str = NPM_REGISTRY):
        self.directory, self.runner = directory.resolve(), runner
        self.registry = registry_base(registry)
        self.lock = asyncio.Lock()
        self._failures: dict[str, str] = {}

    def _npm_command(self, *arguments: str) -> list[str]:
        npm = shutil.which("npm")
        if npm is None:
            raise ValueError("npm is required for the explicitly selected Microsoft feed")
        return [
            npm, *arguments, f"--registry={self.registry}", "--strict-ssl=true", "--ignore-scripts",
            "--json", "--loglevel=error", "--fetch-retries=0", "--fetch-timeout=60000",
        ]

    async def catalog(self) -> ReleaseCatalog:
        self.directory.mkdir(parents=True, exist_ok=True)
        log: list[dict] = []
        catalog = None
        error = None
        try:
            if self.registry == NPM_REGISTRY:
                data = await asyncio.to_thread(download, REGISTRY)
                log.append({
                    "method": "GET", "url": REGISTRY, "sha256": hashlib.sha256(data).hexdigest(),
                    "content": data.decode("utf-8"),
                })
                catalog = ReleaseCatalog.model_validate_json(data)
            else:
                metadata = json.loads(await self.command(
                    self._npm_command("view", "pyright", "time", "dist-tags"), self.directory, log,
                ))
                versions = json.loads(await self.command(
                    self._npm_command("view", "pyright@1", "name", "version", "repository", "dist"), self.directory, log,
                ))
                if not isinstance(metadata, dict) or not isinstance(versions, list) or not versions:
                    raise ValueError("The configured feed did not return a complete publication catalog")
                by_version = {}
                for package in versions:
                    if not isinstance(package, dict) or not isinstance(package.get("version"), str):
                        raise ValueError("The configured feed returned invalid version metadata")
                    version = package["version"]
                    if version in by_version:
                        raise ValueError("The configured feed returned duplicate version metadata")
                    by_version[version] = package
                catalog = ReleaseCatalog.model_validate({**metadata, "versions": by_version})
            return catalog
        except (OSError, ValueError, TimeoutError) as failure:
            error = str(failure)
            raise
        finally:
            (self.directory / f"catalog-{uuid.uuid4().hex}.json").write_text(json.dumps({
                "registry": self.registry, "commands": log, "error": error,
                "catalog_hash": None if catalog is None else fingerprint(catalog.model_dump()),
            }, indent=2), encoding="utf-8")

    async def command(self, command: list[str], cwd: Path, log: list[dict]) -> str:
        record: dict[str, JsonValue] = {
            "command": subprocess.list2cmdline(command), "cwd": str(cwd),
        }
        log.append(record)
        try:
            code, stdout, stderr = await self.runner(command, cwd)
        except (OSError, ValueError, TimeoutError) as error:
            record["error"] = str(error)
            raise
        record.update({"exit_code": code, "stdout": stdout, "stderr": stderr})
        if code:
            raise ValueError(f"Target preparation failed ({code}): {stderr or stdout}")
        return stdout.strip()

    def verify(self, target: ReproductionTarget) -> None:
        if (
            target.registry != self.registry or target.status != "ready"
            or not target.directory or not target.cli or not target.tree_hash
            or (target.role != "main" and not re.fullmatch(r"sha512-[A-Za-z0-9+/]+={0,2}", target.artifact_sha512 or ""))
            or not Path(target.directory).resolve().is_relative_to(self.directory)
            or Path(target.cli).resolve() != (Path(target.directory) / "index.js").resolve()
            or not Path(target.cli).is_file()
            or tree_hash(Path(target.directory)) != target.tree_hash
        ):
            raise ValueError("Pinned checker target is unavailable or its integrity changed")

    async def prepare(self, target: ReproductionTarget) -> None:
        async with self.lock:
            if target.registry != self.registry:
                raise ValueError("Selected target registry differs from the explicit acquisition policy")
            key = fingerprint({
                "identity": target.identity, "integrity": target.integrity, "source": target.source,
                "registry": self.registry,
                "entrypoint": "index.js",
            })
            if key in self._failures:
                raise ValueError(self._failures[key])
            base = self.directory / key
            metadata = base / "target.json"
            if metadata.exists():
                saved = ReproductionTarget.model_validate_json(metadata.read_text(encoding="utf-8"))
                if (saved.identity, saved.integrity, saved.source, saved.registry) != (
                    target.identity, target.integrity, target.source, target.registry,
                ):
                    raise ValueError("Cached target provenance changed")
                target.directory, target.cli, target.tree_hash = saved.directory, saved.cli, saved.tree_hash
                target.version, target.status = saved.version, saved.status
                target.artifact_sha512 = saved.artifact_sha512
                self.verify(target)
                return
            base.mkdir(parents=True, exist_ok=True)
            work = base / uuid.uuid4().hex
            runtime = base / ("runtime-" + uuid.uuid4().hex)
            work_created = runtime_created = prepared = False
            log: list[dict] = []
            acquisitions: list[dict[str, JsonValue]] = []
            try:
                if target.role == "main":
                    # pnpm's resolved loader paths can exceed Windows limits beneath the hashed cache.
                    work = Path(tempfile.mkdtemp(prefix="pyr-")).resolve()
                else:
                    work.mkdir()
                work_created = True
                runtime.mkdir()
                runtime_created = True
                if target.role != "main":
                    if (
                        not VERSION.fullmatch(target.version) or target.identity != f"npm:pyright@{target.version}"
                        or target.source not in artifact_urls(target.version, self.registry)
                    ):
                        raise ValueError("Release target must be the exact trusted project package")
                    acquisition: dict[str, JsonValue] = {
                        "method": "GET" if self.registry == NPM_REGISTRY else "npm pack --ignore-scripts",
                        "url": target.source, "registry": self.registry, "expected_integrity": target.integrity,
                    }
                    acquisitions.append(acquisition)
                    if self.registry == NPM_REGISTRY:
                        data = await asyncio.to_thread(download, target.source)
                    else:
                        packed = json.loads(await self.command(self._npm_command(
                            "pack", f"pyright@{target.version}", "--pack-destination", str(work),
                        ), work, log))
                        name = f"pyright-{target.version}.tgz"
                        if (
                            not isinstance(packed, list) or len(packed) != 1 or not isinstance(packed[0], dict)
                            or packed[0].get("name") != "pyright" or packed[0].get("version") != target.version
                            or packed[0].get("filename") != name
                        ):
                            raise ValueError("npm did not return the exact selected Pyright package")
                        archive_path = work / name
                        if archive_path.is_symlink() or archive_path.stat().st_size > MAX_DOWNLOAD:
                            raise ValueError("Trusted artifact exceeds the download bound or is a link")
                        data = archive_path.read_bytes()
                    target.artifact_sha512 = "sha512-" + base64.b64encode(hashlib.sha512(data).digest()).decode()
                    if target.integrity and target.integrity.startswith("sha512-"):
                        observed_integrity = target.artifact_sha512
                    elif self.registry == MICROSOFT_REGISTRY and target.integrity and target.integrity.startswith("sha1-"):
                        observed_integrity = "sha1-" + base64.b64encode(hashlib.sha1(data).digest()).decode()
                    else:
                        raise ValueError("Selected registry does not permit this artifact checksum")
                    acquisition.update({
                        "bytes": len(data), "integrity": observed_integrity, "artifact_sha512": target.artifact_sha512,
                    })
                    if observed_integrity != target.integrity:
                        raise ValueError("Published checker package failed integrity verification")
                    with tarfile.open(fileobj=io.BytesIO(data), mode="r:gz") as archive:
                        total = 0
                        for member in archive.getmembers():
                            path = Path(member.name)
                            if (
                                not member.isfile() and not member.isdir() or path.anchor
                                or ".." in path.parts or ":" in member.name or "\\" in member.name
                                or not path.parts or path.parts[0] != "package"
                            ):
                                raise ValueError("Unsafe package archive entry")
                            if member.isfile():
                                total += member.size
                                if total > MAX_DOWNLOAD * 4:
                                    raise ValueError("Expanded checker package exceeds the bound")
                                destination = runtime.joinpath(*path.parts[1:])
                                destination.parent.mkdir(parents=True, exist_ok=True)
                                source = archive.extractfile(member)
                                if source is None:
                                    raise ValueError("Package file has no contents")
                                destination.write_bytes(source.read())
                else:
                    if target.source != UPSTREAM or not SHA.fullmatch(target.identity):
                        raise ValueError("Main target must be the trusted upstream pinned commit")
                    git = ["git", "-c", "core.longpaths=true", "-c", "core.hooksPath=NUL"]
                    await self.command([*git, "init", str(work)], base, log)
                    await self.command([
                        *git, "fetch", "--depth=1", UPSTREAM, target.identity,
                    ], work, log)
                    await self.command([*git, "checkout", "--detach", "FETCH_HEAD"], work, log)
                    if await self.command([*git, "rev-parse", "HEAD"], work, log) != target.identity:
                        raise ValueError("Upstream checkout does not match pinned main")
                    pnpm = shutil.which("pnpm")
                    if pnpm is None:
                        raise ValueError("pnpm is unavailable for isolated upstream main build")
                    await self.command([
                        pnpm, "install", "--frozen-lockfile", "--ignore-scripts",
                        f"--registry={self.registry}", "--config.manage-package-manager-versions=false",
                    ], work, log)
                    # Only this known upstream project script runs, never a reporter-supplied command.
                    await self.command([pnpm, "--dir", str(Path("packages") / "pyright"), "run", "webpack"], work, log)
                    shutil.copytree(work / "packages" / "pyright" / "dist", runtime / "dist")
                    shutil.copyfile(work / "packages" / "pyright" / "index.js", runtime / "index.js")
                # The upstream package entrypoint initializes discovery of its bundled typeshed.
                cli = runtime / "index.js"
                if not cli.is_file() or not (runtime / "dist" / "pyright.js").is_file():
                    raise ValueError("Target does not contain the supported bundled Pyright CLI")
                observed = await self.command(["node", str(cli), "--version"], runtime, log)
                if not re.fullmatch(r"pyright 1\.\d+\.\d+", observed):
                    raise ValueError("Checker did not return a supported Pyright version")
                observed = observed.removeprefix("pyright ")
                if target.role != "main" and observed != target.version:
                    raise ValueError("Checker version differs from the integrity-verified package")
                target.version = observed
                target.directory, target.cli = str(runtime), str(cli)
                target.tree_hash, target.status = tree_hash(runtime), "ready"
                metadata.write_text(target.model_dump_json(indent=2), encoding="utf-8")
                prepared = True
            except (OSError, ValueError, TimeoutError, tarfile.TarError) as error:
                self._failures[key] = str(error)
                if isinstance(error, tarfile.TarError):
                    raise ValueError(f"Published checker archive is invalid: {error}") from error
                raise
            finally:
                try:
                    if work_created:
                        remove_owned_directory(work)
                finally:
                    try:
                        if runtime_created and not prepared:
                            remove_owned_directory(runtime)
                    finally:
                        (base / f"preparation-{work.name}.json").write_text(json.dumps({
                            "target": target.model_dump(), "commands": log,
                            "acquisitions": acquisitions, "error": self._failures.get(key),
                            "work_directory": str(work), "runtime_directory": str(runtime),
                            "prepared": prepared, "work_retained": work.exists(), "runtime_retained": runtime.exists(),
                        }, indent=2), encoding="utf-8")

    async def probe(
        self, target: ReproductionTarget, scenario: ReproductionScenario, directory: Path, *, phase: Phase = "original",
    ) -> dict[str, JsonValue]:
        self.verify(target)
        inputs = scenario_inputs(scenario, phase=phase)
        directory.mkdir(parents=True, exist_ok=True)
        if any(directory.iterdir()):
            raise ValueError("Comparison probe needs a fresh isolated input directory")
        for name, content in inputs.items():
            path = directory / relative_path(name)
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8", newline="\n")
        before = tree_hash(directory)
        command = [
            "node", target.cli or "", "--project", str(directory / "pyrightconfig.json"),
            "--outputjson", "--pythonpath", str(directory / "unavailable-python"),
        ]
        record: dict[str, JsonValue] = {
            "id": uuid.uuid4().hex, "kind": "reproduction", "phase": phase, "target": target.model_dump(mode="json"),
            "scenario_hash": fingerprint(scenario.model_dump()), "input_hash": before,
            "inputs": {key: value for key, value in inputs.items()},
            "command": subprocess.list2cmdline(command), "cwd": str(directory),
        }
        try:
            code, stdout, stderr = await self.runner(command, directory)
            record.update({"exit_code": code, "stdout": stdout, "stderr": stderr})
            self.verify(target)
            if tree_hash(directory) != before:
                raise ValueError("Comparison inputs changed during checker execution")
        except (OSError, ValueError, TimeoutError) as error:
            record["error"] = str(error)
        problems: list[str] = []
        observations = observe_claims(scenario, record, problems)
        record["outcome"] = (
            "blocked" if not observations or "blocked" in observations.values() else
            "verified" if phase == "control" else
            "reproduced" if "reproduced" in observations.values() else "not_reproduced"
        )
        record["claim_outcomes"] = {key: value for key, value in observations.items()}
        record["blocking_reasons"] = [problem for problem in problems]
        return record


def release_wording(targets: list[ReproductionTarget], outcomes: Mapping[str, str]) -> str:
    main = next(target for target in targets if target.role == "main")
    latest = next(target for target in targets if target.role == "latest")
    if outcomes.get("latest") == "not_reproduced":
        return f"Should be fixed in the latest published Pyright version {latest.version} (independently verified)."
    if outcomes.get("latest") == "reproduced":
        return f"Fixed on upstream main ({main.identity}); awaiting release. Latest published {latest.version} still reproduces."
    return f"Fixed on upstream main ({main.identity}). Published-release fix status is unverified; do not claim it is released."
