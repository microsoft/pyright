#!/usr/bin/env python3
# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

# /// script
# requires-python = ">=3.11"
# dependencies = [
#     "github-copilot-sdk==1.0.19",
#     "pydantic>=2.11,<3",
#     "PyYAML>=6.0,<7",
#     "azure-identity>=1.25,<2",
# ]
# ///

"""Version-one read-only assessor; never falls through to the issue-review publisher."""

from __future__ import annotations

import argparse
import asyncio
import base64
import hashlib
import importlib.metadata
import inspect
import json
import re
import shutil
import sys
from collections.abc import Sequence
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from copilot import CopilotClient, RuntimeConnection
from copilot.session import CopilotSession
from pydantic import JsonValue

from issue_review_assessment import (
    AssessmentController, associations, build_plan, capture_report, choices, report_text, validate_setup_selections,
)
from issue_review_assessment_models import (
    AssessmentDraft, AssessmentInput, AssessmentPlan, AssessmentPolicy, AssessmentReceipt, AssessmentRun,
    AssessmentSetupEvidence, AssessmentSetupSelection, ClaimProgress,
    DiscoveryPlan, VerificationPlan, VerificationRefinement,
)
from issue_review_models import Issue, ReproductionTarget
from issue_review_reproduction import REGISTRIES, ReleaseCatalog, TargetStore, fingerprint, select_targets
from issue_review_safety import InjectionScreening, child_environment
from issue_review_sources import MaterializedSetup, SetupCapability, SourceCapture, materialize_setup, reported_diagnostics
from issue_review_validity import ValidityEvidence, parse_json_value
from review_issues import (
    AGENTS, ROOT, SDK, Agent, AutomationError, GitHub, discussion_text, show, target_process,
)

PHASES = ("assess", "readiness", "discover", "refine", "verify", "validity")
MODEL = "gpt-6.1-sol"
BUDGET = 180


def arguments(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument("--issue", type=int)
    inputs.add_argument("--snapshot", type=Path, help="Version-one frozen AssessmentInput; no live issue lookup")
    parser.add_argument("--state-dir", type=Path, required=True, help="NEW directory for assess/readiness; v1-only for individual phases")
    parser.add_argument("--phase", choices=PHASES, default="assess")
    parser.add_argument("--claim", help="Exact frozen claim ID for an individual discover/refine/verify phase")
    parser.add_argument("--model", default=MODEL)
    parser.add_argument("--allow-assumed-settings", action="store_true", help="Disclose bounded missing Python/checking choices; never reporter facts")
    parser.add_argument("--target-cache", type=Path, help="Existing integrity-verified production TargetStore cache; no implicit acquisition")
    parser.add_argument("--registry", choices=REGISTRIES, default=REGISTRIES[0])
    parser.add_argument("--catalog", type=Path, help="Saved production publication catalog; target selection still checked")
    parser.add_argument("--main-sha", help="Pinned actual upstream main; rechecked through GitHub metadata")
    parser.add_argument("--frozen-targets", type=Path, help="Controller-frozen exact target assignments; integrity reverified, no reselection")
    parser.add_argument("--normative-evidence", type=Path, help="Typed controller-frozen authority list; snapshot must bind its exact hash")
    parser.add_argument("--setup-evidence", type=Path, help="Approved AssessmentSetupEvidence bound to this snapshot capture and frozen targets; never inferred or installed")
    parser.add_argument("--prepare-targets", action="store_true", help="Explicitly permit production trusted acquisition/builds; disabled by default")
    parser.add_argument("--validity-input", type=Path, help="Frozen controller-provenance normative evidence; no model-created citations")
    parser.add_argument("--reference", action="append", default=[], help="Explicit bounded authoritative spec/policy/precedent URL for validity (maximum12)")
    parser.add_argument("--skip-validity", action="store_true", help="Explicitly record semantic research/validity as unperformed")
    parser.add_argument("--cli-path", default=shutil.which("copilot"))
    args = parser.parse_args(argv)
    args.state_dir = args.state_dir.resolve()
    return args


def implementation_hash() -> str:
    files = [
        *sorted((ROOT / "build" / "automation").glob("*.py")),
        *sorted((ROOT / ".github" / "agents").glob("*.md")),
        Path(inspect.getfile(CopilotSession)), Path(inspect.getfile(CopilotClient)),
    ]
    return fingerprint({
        "files": {str(path): hashlib.sha256(path.read_bytes()).hexdigest() for path in files},
        "sdk": importlib.metadata.version("github-copilot-sdk"),
    })


def save(path: Path, value: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, sort_keys=True, indent=2, allow_nan=False)
        stream.write("\n")


def schema_rejected(error: Exception) -> bool:
    text = str(error).casefold()
    return bool(
        re.search(r"\b(?:http[ _-]*400|status(?:[_ ]?code)?[\s:=\"']*400|bad[_ ]?request)\b", text)
        and ("schema" in text or "response_format" in text)
    )


def validate_setup_evidence(
    evidence: AssessmentSetupEvidence, capture: SourceCapture, targets: Sequence[ReproductionTarget],
    *, assessment_input: AssessmentInput | None = None,
) -> tuple[SetupCapability, ...]:
    evidence = AssessmentSetupEvidence.model_validate_json(evidence.model_dump_json())
    if (
        evidence.capture_hash != capture.digest
        or evidence.targets_hash != fingerprint([item.model_dump(mode="json") for item in targets])
        or len(targets) != 3 or {item.role for item in targets} != {"historical", "main", "latest"}
    ):
        raise ValueError("Approved setup evidence differs from the exact capture or frozen targets")
    if len({item.requirement_hash for item in evidence.capabilities}) != len(evidence.capabilities):
        raise ValueError("Approved setup evidence repeats a requirement")
    target_hashes: dict[str, set[str]] = {}
    for target in targets:
        target_hashes.setdefault(target.identity, set()).add(fingerprint(target.model_dump(mode="json")))
    for capability in evidence.capabilities:
        if capability.digest != fingerprint(capability.model_dump(mode="json", exclude={"digest"})):
            raise ValueError("Approved setup capability changed after verification")
        for artifact in capability.evidence:
            if artifact.locator in target_hashes:
                if artifact.sha256 not in target_hashes[artifact.locator]:
                    raise ValueError("Setup evidence refers to different checker target metadata")
                continue
            path = Path(artifact.locator)
            if not path.is_absolute() or path.is_symlink() or path.stat().st_size > 1048576:
                raise ValueError("Setup evidence requires bounded ordinary local proof files")
            data = path.read_bytes()
            if len(data) > 1048576 or hashlib.sha256(data).hexdigest() != artifact.sha256:
                raise ValueError("Approved setup proof bytes changed")
    validate_setup_selections(evidence.selections, capture, evidence.capabilities)
    if assessment_input is not None and any(
        {item.setting: item for item in selection.setting_choices}
        != {item.setting: item for item in assessment_input.setting_choices}
        for selection in evidence.selections
    ):
        raise ValueError("Approved setup selection differs from the frozen controller setting choices")
    return tuple(evidence.capabilities)


def load_controller(directory: Path) -> AssessmentController:
    path = directory / "assessment.json"
    if not path.is_file():
        raise ValueError("Only a new assessment-v1 checkpoint is accepted; reproduction/publication ledgers are incompatible")
    data = json.loads(path.read_text(encoding="utf-8"))
    if data["schema_version"] != 1:
        raise ValueError("Unsupported assessment checkpoint version")
    policy = AssessmentPolicy.model_validate(data["policy"])
    if policy.implementation_hash != implementation_hash():
        raise ValueError("Implementation/profile/SDK changed; old assessment evidence cannot be upgraded")
    controller = AssessmentController(
        directory, policy, Issue.model_validate(data["issue"]), data["comments"],
        SourceCapture.model_validate_json(json.dumps(data["capture"])),
        AssessmentDraft.model_validate(data["draft"]),
        MaterializedSetup.model_validate_json(json.dumps(data["prepared"])),
        AssessmentPlan.model_validate_json(json.dumps(data["plan"])),
        implementation=implementation_hash,
        assessment_input=None if data.get("assessment_input") is None else AssessmentInput.model_validate_json(
            json.dumps(data["assessment_input"]),
        ),
    )
    controller.require_identity()
    return controller


def readiness_prompt(issue: Issue, comments: list[dict[str, JsonValue]], capture: SourceCapture, assumed: bool) -> str:
    return (
        "Return AssessmentDraft version1. This is permanently read-only, not reproduction or semantic validity. "
        "Preserve every material claim including unsupported broader claims; never discard one to obtain a disposition. "
        "Keep distinct user concerns, not a separate claim for every diagnostic line, premise, workaround or "
        "supporting control of the same concern. Never merge or rename externally declared IDs/summaries. "
        "A single concern can contain several reported symptoms: retain ALL affected locations and reported "
        "comparisons/workarounds in its scope/context, even when they do not need separate claim IDs. "
        "A report saying 'both' editor and CLI does not by itself allege an independent editor-only symptom. "
        "Ordinary static diagnostics or revealed types on supplied Python code use surface=cli, even without a "
        "reported CLI command. This adapter does not establish editor/LSP/runtime behavior: keep genuinely "
        "editor-only completion, hover, navigation, staleness or runtime concerns separately unsupported. "
        "Reference captured Python/stub IDs with safe relative .py/.pyi paths in sources and claim.source_ids, "
        "never retype originals. Do NOT associate JSON configuration as a Python source or include its ID in "
        "claim.source_ids: the controller materializes captured configuration separately. "
        "Ready requires exact reported diagnostic wording and unchanged strict original+precision predicates. "
        "If exact wording is absent but source/setup support observation, use partial with historical DiscoveryScope "
        "and narrow source locations; verification=null, no controls. Freeze symptom_kind, failure_direction "
        "(unexpected_presence versus unexpected_absence), and exact reported_message/reported_rule when available "
        "(otherwise null) BEFORE any discovery. A historical observation must never change the complaint's polarity. "
        "Use reported_symptoms for different exact reported messages at distinct source locations; use null common "
        "reported_message when they differ. Do not reduce a multi-location concern to one convenient diagnostic. "
        "reported_message means the complete diagnostic message, not a CLI rule suffix or an abbreviated excerpt. "
        "If complete message text is unavailable, use null, preserve the raw report quote/question and known rule, "
        "and let historical discovery learn wording only at the frozen locations. Never treat a guess as complete text. "
        "Only partial CLI claims with associated originals can have discovery. Ready or blocked claims must use "
        "discovery=null. Every entry in claim.source_ids must name an entry in sources; use [] if no original is available. "
        "Missing original/unsupported surface/genuine unavailable setup requires blocked with honest reasons, "
        "null verification/discovery and no controls. Never fill messages with invented text to satisfy validation. "
        "This role records planning readiness BEFORE controller execution; do not assert execution is unavailable "
        "because this role is tool-less or read-only. The controller can run static checks later. "
        "Controller duties (target acquisition, originals-before-controls, precision checks) are workflow, not "
        "missing reporter prerequisites. Report quotes must be single contiguous exact spans. "
        "Source filenames without evidence are disclosed controller conventions. "
        "For filename_quote, copy ONLY that source's captured filename_evidence.quote; use null when it is absent. "
        "A command mentioning a filename or a filename chosen as a convention is not captured association evidence. "
        "Preserve exact diagnostic whitespace. For recognized CLI-rendered candidates below, copy message "
        "verbatim: the controller removes only the known renderer indentation and rule suffix, retaining an "
        "exact raw evidence span. Candidate.output_block_id identifies an output fence, NOT a Python source "
        "association. Do not manually normalize any other quoted diagnostic or invent wording. "
        + (
            "Bounded assumed Python/checking settings are permitted ONLY when genuinely omitted; disclose choices "
            "as experiments in setting_choices, never replace explicit declarations. "
            if assumed else "No assumed settings are authorized; missing settings remain explicit. "
        )
        + "No commands, Python execution, research, delegation, diagnosis, drafting or publication. "
        + "\nUntrusted issue:\n" + issue.model_dump_json()
        + "\nUntrusted complete discussion:\n" + json.dumps(comments)
        + "\nController-captured source/configuration evidence:\n" + capture.model_dump_json()
        + "\nSource filename association catalog (null means no captured filename quote):\n"
        + json.dumps([{
            "source_id": item.id, "filename_hint": item.filename_hint,
            "filename_quote": None if item.filename_evidence is None else item.filename_evidence.quote,
        } for item in capture.blocks if item.source_kind in {"python", "unclassified"}])
        + "\nOptional controller-derived CLI diagnostic candidates (not observations or a complete inventory):\n"
        + json.dumps([item.model_dump(mode="json") for item in reported_diagnostics(capture)])
    )


async def readiness(
    args: argparse.Namespace, github: GitHub, sdk: SDK, agent: Agent,
    *, capabilities: Sequence[SetupCapability] = (),
    setup_selections: Sequence[AssessmentSetupSelection] = (),
    assessment_input: AssessmentInput | None = None,
) -> AssessmentController:
    capabilities = tuple(SetupCapability.model_validate_json(item.model_dump_json()) for item in capabilities)
    setup_selections = tuple(
        AssessmentSetupSelection.model_validate_json(item.model_dump_json()) for item in setup_selections
    )
    directory = args.state_dir
    if directory.exists():
        raise ValueError("A new assessor run requires a NEW state directory; no ledger fallback or implicit rerun")
    directory.mkdir(parents=True)
    if assessment_input is None:
        issue = await github.issue(args.issue)
        comments: list[dict[str, JsonValue]] = []
        for item in await github.comments(args.issue):
            if not isinstance(item, dict):
                raise ValueError("Full captured discussion records are required")
            comments.append(item)
        await github.screen({"issue": issue.model_dump(mode="json"), "comments": list(comments)}, directory, f"issue:{issue.number}")
    else:
        assessment_input = AssessmentInput.model_validate_json(assessment_input.model_dump_json())
        issue, comments = assessment_input.issue, assessment_input.comments
        await github.screen(
            assessment_input.model_dump(mode="json"), directory, f"assessment-input:{assessment_input.report_id}",
        )
    capture = capture_report(issue, comments, report_id=None if assessment_input is None else assessment_input.report_id)
    policy = AssessmentPolicy(
        input_hash=fingerprint({"issue": issue.model_dump(mode="json"), "comments": comments}),
        implementation_hash=implementation_hash(),
        profile_hash=hashlib.sha256(agent.path.read_bytes()).hexdigest(), model=args.model,
        allow_assumed_settings=args.allow_assumed_settings,
        setup_capabilities_hash=fingerprint([item.model_dump(mode="json") for item in capabilities]),
        setup_selections_hash=fingerprint([item.model_dump(mode="json") for item in setup_selections]),
        assessment_input_hash=None if assessment_input is None else fingerprint(assessment_input.model_dump(mode="json")),
    )
    save(directory / "input.json", {"issue": issue.model_dump(mode="json"), "comments": comments})
    save(directory / "capture.json", capture.model_dump(mode="json"))
    save(directory / "policy.json", policy.model_dump(mode="json"))
    save(directory / "setup-capabilities.json", [item.model_dump(mode="json") for item in capabilities])
    if assessment_input is not None:
        save(directory / "assessment-input.json", assessment_input.model_dump(mode="json"))
    save(directory / "role-schedule.json", {
        "schema_version": 1, "requested_phase": args.phase,
        "maximum_model_roles": 18, "maximum_active_role_seconds": 18 * BUDGET,
        "roles": [
            {"name": "readiness", "budget_seconds": BUDGET, "correction": "same shared deadline"},
            {"name": "refinement", "when": "one per eligible captured discovery; never after failed attempt",
             "maximum_roles": 16, "budget_seconds_each": BUDGET, "correction": "same shared deadline"},
            {"name": "validity", "when": "one explicitly enabled independent validity phase",
             "budget_seconds": BUDGET, "correction": "same shared deadline"},
        ],
        "no_checker_gate_or_publication_roles": True,
    })
    scratch = directory / "roles" / "readiness"
    scratch.mkdir(parents=True)
    prompt = readiness_prompt(issue, comments, capture, args.allow_assumed_settings)
    if capabilities:
        prompt += "\nController-only approved setup receipts (not model capability prose):\n" + json.dumps([
            item.model_dump(mode="json") for item in capabilities
        ])
    if setup_selections:
        prompt += (
            "\nController-approved exact setup selections:\n"
            + json.dumps([item.model_dump(mode="json") for item in setup_selections])
            + "\nWhen using one of these source IDs, copy its exact path/filename_quote association and the "
            "exact frozen setting_choices, including reason text. These are controller reconstruction conventions "
            "and disclosed assumptions, not newly reported facts. Do not combine separate example groups to "
            "borrow a setup proof. Other source groups and unsupported concerns remain explicit; their setup "
            "may still be blocked. The hashes approve only these exact setups, not reproduction or semantics."
        )
    if assessment_input is not None:
        prompt += (
            "\nFrozen controller scope: retain EXACT declared IDs AND summaries even when blocked. "
            "Do not merge/rename or omit them. Add any additional material claims using fresh IDs; do not discard "
            "unexpected broader claims. Copy controller setting choices exactly, never turn assumed choices "
            "into reporter facts. Fixture origin/provenance is not a checker observation or a live issue identity.\n"
            + json.dumps({
                "report_id": assessment_input.report_id, "origin": assessment_input.origin,
                "provenance": assessment_input.provenance,
                "declared_claims": [claim.model_dump(mode="json") for claim in assessment_input.declared_claims],
                "setting_choices": [choice.model_dump(mode="json") for choice in assessment_input.setting_choices],
                "limitations": assessment_input.limitations,
            })
        )
    save(scratch / "input.json", {"prompt": prompt, "policy_hash": fingerprint(policy.model_dump())})

    def validate(content: str) -> None:
        draft = AssessmentDraft.model_validate_json(content)
        prepared = materialize_setup(capture, associations(draft), choices(draft))
        build_plan(policy, draft, capture, prepared, report_text(issue, comments), capabilities=capabilities,
                   setup_selections=setup_selections, assessment_input=assessment_input)

    try:
        content = await sdk.run(
            agent, prompt, scratch, schema=AssessmentDraft, native_tools=[], timeout=BUDGET, validate=validate,
        )
    except (ValueError, AutomationError, OSError, TimeoutError) as error:
        save(directory / "readiness-failure.json", {
            "schema_version": 1, "readiness": "blocked", "policy_hash": fingerprint(policy.model_dump()),
            "source_hash": capture.digest, "role": "readiness", "budget_seconds": BUDGET,
            "reason": f"{type(error).__name__}: {error}", "action": None, "claims": "unresolved; role failed",
        })
        raise
    if policy.implementation_hash != implementation_hash():
        raise ValueError("Source/profile/SDK identity changed during readiness")
    draft = AssessmentDraft.model_validate_json(content)
    prepared = materialize_setup(capture, associations(draft), choices(draft))
    plan = build_plan(policy, draft, capture, prepared, report_text(issue, comments), capabilities=capabilities,
                      setup_selections=setup_selections, assessment_input=assessment_input)
    return AssessmentController(
        directory, policy, issue, comments, capture, draft, prepared, plan, implementation=implementation_hash,
        assessment_input=assessment_input,
    )


async def choose_targets(
    args: argparse.Namespace, controller: AssessmentController, github: GitHub, store: TargetStore,
    *, frozen_targets: Sequence[ReproductionTarget] | None = None,
) -> list[ReproductionTarget]:
    controller.require_identity()
    if frozen_targets is not None:
        inputs = controller.assessment_input
        values = [target.model_dump(mode="json") for target in frozen_targets]
        if inputs is None or inputs.frozen_targets_hash != fingerprint(values):
            raise ValueError("Explicit target assignments require a matching frozen controller input/provenance")
        targets = [ReproductionTarget.model_validate(value) for value in values]
        if {target.role for target in targets} != {"historical", "main", "latest"} or len(targets) != 3:
            raise ValueError("Frozen targets must preserve exactly one historical/main/latest assignment")
        for target in targets:
            if target.status == "ready":
                store.verify(target)
        frozen = {
            "schema_version": 1, "mode": "controller_frozen", "targets": values,
            "provenance": inputs.target_selection_provenance, "cache": str(store.directory.resolve()),
        }
        for name, value in (("target-selection.json", frozen), ("targets.json", values)):
            path = controller.directory / name
            if path.exists():
                if json.loads(path.read_text(encoding="utf-8")) != value:
                    raise ValueError("Frozen target assignments cannot be replaced/upgraded")
            else:
                save(path, value)
        return targets
    if controller.assessment_input is not None and controller.assessment_input.blind:
        raise ValueError("Blind snapshot has no frozen target assignments; live discovery/identity lookup is forbidden")
    request = {
        "registry": args.registry, "requested_main": args.main_sha,
        "catalog": None if args.catalog is None else {
            "path": str(args.catalog.resolve()), "sha256": hashlib.sha256(args.catalog.read_bytes()).hexdigest(),
        },
        "cache": str(store.directory.resolve()), "prepare_targets": args.prepare_targets,
    }
    selection_path, targets_path = controller.directory / "target-selection.json", controller.directory / "targets.json"
    if selection_path.exists():
        selection = json.loads(selection_path.read_text(encoding="utf-8"))
        if selection.get("request") != request or not targets_path.is_file():
            raise ValueError("Frozen target selection is incompatible or incomplete; no reselection/upgrade is permitted")
        targets = [ReproductionTarget.model_validate(item) for item in json.loads(targets_path.read_text(encoding="utf-8"))]
        selected = [ReproductionTarget.model_validate(item) for item in selection["targets"]]
        if len(targets) != len(selected) or any(
            any(getattr(target, name) != getattr(original, name)
                for name in ("identity", "role", "source", "integrity", "registry"))
            for target, original in zip(targets, selected)
        ):
            raise ValueError("Frozen prepared target identity/provenance changed")
        for target in targets:
            if target.status == "ready":
                store.verify(target)
        return targets
    # Pin the actual upstream main, never the feature checkout or a user-supplied CLI version string.
    main = await github.api("GET", "repos/microsoft/pyright/commits/main")
    main_sha = main.get("sha") if isinstance(main, dict) else None
    if not isinstance(main_sha, str):
        raise ValueError("Actual upstream main metadata is unavailable")
    if args.main_sha is not None and args.main_sha != main_sha:
        raise ValueError("Supplied main pin differs from actual upstream metadata")
    catalog = ReleaseCatalog.model_validate_json(args.catalog.read_text(encoding="utf-8")) if args.catalog else await store.catalog()
    targets = select_targets(
        catalog, controller.issue, controller.draft, discussion_text(list(controller.comments)), main_sha,
        registry=args.registry,
    )
    save(controller.directory / "target-selection.json", {
        "schema_version": 1, "request": request, "catalog": catalog.model_dump(mode="json", by_alias=True),
        "catalog_hash": fingerprint(catalog.model_dump()), "main_metadata": main,
        "targets": [target.model_dump(mode="json") for target in targets],
    })
    for target in targets:
        if args.prepare_targets:
            await store.prepare(target)
        else:
            key = fingerprint({
                "identity": target.identity, "integrity": target.integrity, "source": target.source,
                "registry": target.registry, "entrypoint": "index.js",
            })
            path = store.directory / key / "target.json"
            if not path.is_file():
                target.status, target.error = "blocked", "Trusted target is not cached; preparation was not authorized"
                continue
            cached = ReproductionTarget.model_validate_json(path.read_text(encoding="utf-8"))
            if any(getattr(cached, name) != getattr(target, name) for name in ("identity", "source", "integrity", "registry")):
                raise ValueError("Cached target differs from selected published/upstream provenance")
            store.verify(cached)
            target.directory, target.cli, target.tree_hash = cached.directory, cached.cli, cached.tree_hash
            target.artifact_sha512, target.status, target.version = cached.artifact_sha512, "ready", cached.version
    save(controller.directory / "targets.json", [target.model_dump(mode="json") for target in targets])
    return targets


async def refinement(
    controller: AssessmentController, claim_id: str, receipt: AssessmentReceipt, sdk: SDK, agent: Agent,
) -> VerificationRefinement:
    claim = controller.claim(claim_id)
    scratch = controller.directory / "roles" / f"refinement-{claim_id}"
    scratch.mkdir(parents=True)
    prompt = (
        "Return VerificationRefinement version1 for this ONE frozen claim and historical discovery. "
        "No main/latest outcomes are available or permitted. Keep its exact claim ID, quote, surface, originals "
        "and configuration. Broken predicates must preserve the frozen failure direction/symptom meaning. "
        "Discovery may affirmatively contradict a reported predicate; that is not a reason to invert it. "
        "Use exact wording frozen from the report or actually observed at the frozen location; an unobserved "
        "predicate requires wording frozen before discovery. "
        "An unobserved diagnostic rule must likewise have been frozen as reported; otherwise use null, not a guess. "
        "A non-null common reported_message and each reported_symptoms entry are immutable: do not replace them "
        "with a longer, shorter, reformatted or more plausible observed message. Preserve every frozen location "
        "and scoped reported symptom in broken/resolved predicates. If known wording cannot describe the observed "
        "complaint faithfully, return an honest blocked refinement rather than changing it. Only unknown wording "
        "may be learned from the historical diagnostic at its frozen location. "
        "Do not invent diagnostic wording, shop for another symptom, or treat discovery as verification. "
        "This is a planning stage, not an execution gate: propose exact predicates and separate controls now; "
        "the controller freezes them and executes fresh originals and controls AFTER your response. "
        "Do not require already executed verification/control receipts to make this plan ready. "
        "Broken means the reporter's complaint is present; resolved means it is absent, not semantic correctness "
        "or proof of a fix. You can plan verification even if discovery contradicts the report or the complaint "
        "may be by design; neither determines normative validity. "
        "Preserve originals byte-for-byte. When originals lack affirmative precision, propose a complete separate "
        "control_files tree with the same paths/configuration and narrowly justified reveal_type queries. "
        "Precision messages are proposed precision expectations, not observed diagnostics; explain their "
        "derivation from captured code. They must later pass actual controller checks without Any/Unknown "
        "degradation. Never insert predicted messages into original broken/resolved predicates. "
        "Do not block solely because controls have not yet executed or the original lacks reveal_type. "
        "If exact distinguishing predicates and affirmative controls cannot be justified, return readiness=blocked, "
        "verification=null, control_files=[], honest reasons. No commands/research/publication. "
        "\nFrozen claim:\n" + claim.model_dump_json()
        + "\nCaptured setup:\n" + controller.claim_setup(claim_id).model_dump_json()
        + "\nHistorical discovery ONLY:\n" + receipt.model_dump_json()
    )
    save(scratch / "input.json", {"prompt": prompt, "policy_hash": controller.plan.policy_hash, "budget_seconds": BUDGET})
    content = await sdk.run(
        agent, prompt, scratch, schema=VerificationRefinement, native_tools=[], timeout=BUDGET,
        validate=lambda content: controller.validate_refinement(
            claim_id, receipt, VerificationRefinement.model_validate_json(content),
        ),
    )
    controller.require_identity()
    result = VerificationRefinement.model_validate_json(content)
    controller.save_once(f"discovery-{claim_id}/refinement.json", result.model_dump(mode="json"))
    return result


def execution_evidence_content(
    receipt: AssessmentReceipt, artifact: Path, *, target_evidence: ValidityEvidence | None = None,
) -> str:
    """Keep all receipt data, factoring JSON presentation and reversible diagnostic path prefixes."""
    original = artifact.read_bytes()
    if AssessmentReceipt.model_validate_json(original) != receipt:
        raise ValueError("Execution evidence differs from its saved controller receipt")
    data = receipt.model_dump(mode="json")
    data["receipt_artifact"] = {"location": str(artifact), "sha256": hashlib.sha256(original).hexdigest()}
    raw = data["raw"]
    if target_evidence is not None:
        if (
            target_evidence.kind != "setup" or target_evidence.provenance != "controller_capture"
            or receipt.claim_id not in target_evidence.claim_ids
            or parse_json_value(target_evidence.content) != raw.get("target")
        ):
            raise ValueError("Shared checker target differs from its exact controller receipt or claim scope")
        raw.pop("target")
        raw["target_evidence_id"] = target_evidence.id
    stdout = raw.get("stdout")
    if isinstance(stdout, str):
        try:
            parsed = parse_json_value(stdout)
        except ValueError as error:
            raw["stdout_representation"] = {"format": "verbatim", "reason": str(error)}
        else:
            prefixes: dict[str, list[int]] = {}
            cwd = raw.get("cwd")
            diagnostics = parsed.get("generalDiagnostics") if isinstance(parsed, dict) else None
            if isinstance(cwd, str) and isinstance(diagnostics, list):
                for index, diagnostic in enumerate(diagnostics):
                    if not isinstance(diagnostic, dict):
                        continue
                    filename = diagnostic.get("file")
                    if not isinstance(filename, str):
                        continue
                    path = Path(filename)
                    if not path.is_absolute():
                        continue
                    try:
                        relative = path.relative_to(cwd)
                    except ValueError:
                        continue
                    if not relative.parts or ".." in relative.parts:
                        continue
                    suffix = filename[-len(str(relative)):]
                    if Path(suffix) != relative:
                        continue
                    prefix = filename[:-len(suffix)]
                    prefixes.setdefault(prefix, []).append(index)
                    diagnostic["file"] = suffix
            raw.pop("stdout")
            raw["stdout_json"] = parsed
            raw["stdout_representation"] = {
                "format": "full_json_with_reversible_diagnostic_file_prefixes",
                "diagnostic_file_prefixes": prefixes, "raw_sha256": hashlib.sha256(stdout.encode("utf-8")).hexdigest(),
            }
    return json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False)


async def validity_phase(
    controller: AssessmentController, args: argparse.Namespace, sdk: SDK, result: AssessmentRun,
    *, github: GitHub,
    normative_evidence: Sequence[ValidityEvidence] = (),
) -> JsonValue:
    from issue_review_validity import (
        LanguageContext, ReferenceRead, ValidityAssessment, ValidityClaimInput, ValidityEvidence, ValidityInput, ValidityResearch,
        build_validity_prompt, content_hash, finalize_validity_response,
    )

    evidence, claims = [], []
    shared_captures: dict[tuple[str, str], ValidityEvidence] = {}

    def capture_evidence(
        identifier: str, kind: Literal["source", "setup", "report"], content: str, claim_id: str,
    ) -> ValidityEvidence:
        shared = shared_captures.get((kind, content)) if kind in {"source", "setup"} else None
        if shared is not None:
            if claim_id not in shared.claim_ids:
                shared.claim_ids.append(claim_id)
            return shared
        captured = ValidityEvidence(
            id=identifier, kind=kind, provenance="controller_capture",
            location=f"assessment:{controller.policy.input_hash}", section=kind,
            content=content, sha256=content_hash(content), claim_ids=[claim_id],
            source_id=None, setup_id=None, target="not_applicable", observation="not_applicable",
            version=None, retrieved_at=None,
        )
        evidence.append(captured)
        if kind in {"source", "setup"}:
            shared_captures[kind, content] = captured
        return captured

    for claim in controller.plan.claims:
        source_id, setup_id = f"source-{claim.id}", f"setup-{claim.id}"
        prepared = controller.claim_setup(claim.id)
        captures: list[tuple[str, Literal["source", "setup", "report"], str]] = [
            (source_id, "source", json.dumps({"capture_hash": controller.capture.digest, "files": prepared.files}, sort_keys=True)),
            (setup_id, "setup", json.dumps({
                "materialized": prepared.model_dump(mode="json"),
                "controller_capabilities": [item.model_dump(mode="json") for item in controller.plan.capabilities],
            }, sort_keys=True)),
            (f"report-{claim.id}", "report", claim.report_quote),
        ]
        evidence_ids = [
            capture_evidence(identifier, kind, content, claim.id).id for identifier, kind, content in captures
        ]
        source_id, setup_id = evidence_ids[:2]
        progress = next(item for item in result.progress if item.claim_id == claim.id)
        static_stub_supported = False
        for identifier in progress.receipt_ids:
            candidates = [
                *controller.directory.glob(f"discovery-{claim.id}/receipt.json"),
                *controller.directory.glob(f"verification-{claim.id}/*-receipt.json"),
            ]
            receipt_path = next((
                path for path in candidates if json.loads(path.read_text(encoding="utf-8"))["id"] == identifier
            ), None)
            if receipt_path is None:
                raise ValueError("Validity cannot invent an execution fact without its saved controller receipt")
            receipt = AssessmentReceipt.model_validate_json(receipt_path.read_text(encoding="utf-8"))
            static_stub_supported |= bool(receipt.raw.get("static_stub_support"))
            target = ReproductionTarget.model_validate(receipt.raw["target"])
            observed = progress.target_observations.get(target.role, "unobserved")
            observation = (
                "discovery_only" if receipt.kind == "discovery" and receipt.observation == "captured" else
                "unobserved" if receipt.kind in {"discovery", "verification_control"} else
                "verified_reproduced" if observed == "reproduced" else
                "verified_absent" if observed == "not_reproduced" else "unobserved"
            )
            section = (
                "Precision control only; unobserved for the original reported symptom"
                if receipt.kind == "verification_control" else
                "Mechanical original predicates only; no independent evidence gate"
                if receipt.kind == "verification_original" else
                "Historical discovery only; never verification or reproduction" if receipt.observation == "captured" else
                "Blocked historical discovery; no qualified observation"
            )
            target_evidence = capture_evidence(
                "execution-target-" + fingerprint(receipt.raw["target"]), "setup",
                json.dumps(receipt.raw["target"], ensure_ascii=False, separators=(",", ":")), claim.id,
            )
            if target_evidence.id not in evidence_ids:
                evidence_ids.append(target_evidence.id)
            content = execution_evidence_content(receipt, receipt_path, target_evidence=target_evidence)
            evidence.append(ValidityEvidence(
                id=receipt.id, kind="execution", provenance="controller_execution",
                location=str(receipt_path), section=section,
                content=content, sha256=content_hash(content), claim_ids=[claim.id],
                source_id=source_id, setup_id=setup_id, target=target.role, observation=observation,
                version=target.version, retrieved_at=None,
            ))
            evidence_ids.append(receipt.id)
        language_context = None
        python_version = prepared.configuration.get("pythonVersion")
        if isinstance(python_version, str):
            assumed = any(choice.setting == "pythonVersion" for choice in prepared.assumptions)
            language_context = LanguageContext(
                target_python_version=python_version, provenance="assumed" if assumed else "reported",
                limitations=[
                    "Target language setting only; no observed Python runtime behavior",
                    *(["Explicitly assumed target version; not a reporter fact"] if assumed else []),
                ],
            )
        claims.append(ValidityClaimInput(
            id=claim.id, summary=claim.summary, context=claim.report_quote,
            source_id=source_id, setup_id=setup_id, readiness=claim.readiness,
            assumptions=controller.plan.assumptions,
            limitations=[
                *(f"Readiness-stage reason (before controller execution): {reason}" for reason in claim.reasons),
                *(f"Readiness-stage limitation (not an execution ledger): {text}" for text in controller.plan.limitations),
                f"Current controller progress: phase={progress.phase}, status={progress.status}",
                *progress.reasons,
                "No whole-issue disposition or publication eligibility",
                *([
                    "Static-only stub support establishes typing with the captured checker-bundled stubs, "
                    "not Python execution, runtime package availability or an unreported dependency version."
                ] if static_stub_supported else []),
            ],
            evidence_ids=evidence_ids,
            language_context=language_context,
        ))
    for item in normative_evidence:
        if item.kind not in {"typing_spec", "python_docs", "policy"} or item.provenance != "retrieved_reference":
            raise ValueError("Frozen normative evidence must be actual captured authority, not identity/precedent research")
        evidence.append(item)
        for claim in claims:
            if claim.id in item.claim_ids:
                claim.evidence_ids.append(item.id)
    if args.validity_input is not None:
        supplied = ValidityInput.model_validate_json(args.validity_input.read_text(encoding="utf-8"))
        if supplied.report_id != controller.capture.report_id or supplied.report_text != report_text(controller.issue, controller.comments):
            raise ValueError("Frozen validity references belong to a different report")
        # Never accept external execution/source/setup claims as controller observations.
        references = [item for item in supplied.evidence if item.kind in {"typing_spec", "policy", "precedent", "python_docs"}]
        captured = {item.id: item for item in evidence}
        if any(item != captured.get(item.id) for item in supplied.evidence if item not in references):
            raise ValueError("Caller-authored source/setup/execution data cannot replace controller validity facts")
        if any(item.provenance != "retrieved_reference" for item in references):
            raise ValueError("Production validity does not treat synthetic benchmark references as retrieved authority")
        for item in references:
            if not re.fullmatch(r"validity-reference-\d{1,2}", item.id):
                raise ValueError("Authority evidence must identify a bounded saved controller reference")
            saved = controller.directory / "references" / f"{item.id}.json"
            if not saved.is_file() or ValidityEvidence.model_validate_json(saved.read_text(encoding="utf-8")) != item:
                raise ValueError("Frozen authority must match an actual saved controller retrieval, not caller prose")
            evidence.append(item)
            for claim in claims:
                if claim.id in item.claim_ids:
                    claim.evidence_ids.append(item.id)
    if args.reference:
        if len(args.reference) > 12:
            raise ValueError("At most12 bounded authoritative reference reads are permitted")
        research = ValidityResearch(
            AssessmentReferenceReader(github), controller.directory / "references", [claim.id for claim in claims],
        )
        for url in args.reference:
            item = await research.read_reference(ReferenceRead(location=url))
            evidence.append(item)
            for claim in claims:
                claim.evidence_ids.append(item.id)
    inputs = ValidityInput(
        schema_version=1, report_id=controller.capture.report_id,
        report_text=report_text(controller.issue, controller.comments), claims=claims, evidence=evidence,
    )
    scratch = controller.directory / "roles" / "validity"
    scratch.mkdir(parents=True)
    agent = Agent.load(AGENTS / "pyright-issue-assessment-validity.md", "pyright-issue-assessment-validity")
    save(scratch / "input.json", inputs.model_dump(mode="json"))
    await github.screen(inputs.model_dump(mode="json"), scratch, f"assessment-validity:{controller.issue.number}")

    def validate(content: str) -> None:
        finalize_validity_response(inputs, ValidityAssessment.model_validate_json(content))

    content = await sdk.run(
        agent, build_validity_prompt(inputs), scratch, schema=ValidityAssessment, native_tools=[], timeout=BUDGET,
        validate=validate,
    )
    controller.require_identity()
    return finalize_validity_response(inputs, ValidityAssessment.model_validate_json(content)).model_dump(mode="json")


class AssessmentReferenceReader:
    """Bounded read-only authority retrieval; no model commands or mutation endpoints."""

    def __init__(self, github: GitHub):
        self.github = github

    async def read_reference(self, request):
        from issue_review_validity import AuthorityReferenceReader, reference_kind, reference_page

        kind = reference_kind(request.location)
        if kind in {"typing_spec", "python_docs"}:
            return await AuthorityReferenceReader().read_reference(request)
        parts = urlparse(request.location).path.strip("/").split("/")
        if kind == "policy":
            result = await self.github.api(
                "GET", "repos/microsoft/pyright/contents/" + "/".join(parts[4:]) + "?ref=" + parts[3],
            )
            encoded = result.get("content") if isinstance(result, dict) else None
            if not isinstance(result, dict) or result.get("encoding") != "base64" or not isinstance(encoded, str):
                raise ValueError("Pinned policy contents are unavailable")
            content = base64.b64decode("".join(encoded.split()), validate=True).decode("utf-8")
        else:
            issue = await self.github.api("GET", f"repos/microsoft/pyright/issues/{parts[3]}")
            comments = await self.github.api("GET", f"repos/microsoft/pyright/issues/{parts[3]}/comments?per_page=100")
            if not isinstance(issue, dict) or not isinstance(comments, list) or len(comments) >= 100:
                raise ValueError("Precedent discussion is unavailable or exceeds the bounded complete page")
            content = json.dumps({
                "title": issue.get("title"), "body": issue.get("body"), "created_at": issue.get("created_at"),
                "author_association": issue.get("author_association"),
                "comments": [
                    {key: comment.get(key) for key in ("body", "created_at", "updated_at", "author_association")}
                    for comment in comments if isinstance(comment, dict)
                ],
            }, ensure_ascii=True)
        if len(content) > 512000:
            raise ValueError("Reference exceeds the bounded transport; no silent truncation")
        return reference_page(request, content, section=urlparse(request.location).fragment or kind)


async def assess(
    args: argparse.Namespace, github: GitHub, sdk: SDK, *, store: TargetStore | None = None,
    setup_capabilities: Sequence[SetupCapability] = (),
    setup_evidence: AssessmentSetupEvidence | None = None,
    assessment_input: AssessmentInput | None = None,
    frozen_targets: Sequence[ReproductionTarget] | None = None,
    normative_evidence: Sequence[ValidityEvidence] = (),
) -> AssessmentRun:
    args.state_dir = Path(args.state_dir).resolve()
    normative_evidence = tuple(ValidityEvidence.model_validate_json(item.model_dump_json()) for item in normative_evidence)
    frozen_targets = None if frozen_targets is None else tuple(
        ReproductionTarget.model_validate_json(item.model_dump_json()) for item in frozen_targets
    )
    if assessment_input is not None:
        assessment_input = AssessmentInput.model_validate_json(assessment_input.model_dump_json())
        if args.issue is not None and args.issue != assessment_input.issue.number:
            raise ValueError("Requested issue identity differs from the frozen assessment input")
        args.issue = assessment_input.issue.number
    setup_selections: Sequence[AssessmentSetupSelection] = ()
    if setup_evidence is not None:
        if (
            assessment_input is None or frozen_targets is None or args.phase not in {"assess", "readiness"}
            or setup_capabilities
        ):
            raise ValueError("Setup evidence requires a fresh frozen snapshot/targets and no separate capability override")
        setup_evidence = AssessmentSetupEvidence.model_validate_json(setup_evidence.model_dump_json())
        setup_capabilities = validate_setup_evidence(
            setup_evidence, capture_report(
                assessment_input.issue, assessment_input.comments, report_id=assessment_input.report_id,
            ), frozen_targets, assessment_input=assessment_input,
        )
        setup_selections = setup_evidence.selections
    agent = Agent.load(AGENTS / "pyright-issue-assessor.md", "pyright-issue-assessor")
    if args.phase in {"assess", "readiness"}:
        if assessment_input is not None:
            if assessment_input.setting_choices and not args.allow_assumed_settings:
                raise ValueError("Frozen assumed settings require explicit --allow-assumed-settings")
            if assessment_input.blind and (args.reference or args.validity_input is not None):
                raise ValueError("Blind calibration permits only pre-frozen normative evidence; no identity/precedent lookup")
            normative_hash = fingerprint([item.model_dump(mode="json") for item in normative_evidence])
            if (
                assessment_input.normative_evidence_hash is not None
                and assessment_input.normative_evidence_hash != normative_hash
                or normative_evidence and assessment_input.normative_evidence_hash is None
            ):
                raise ValueError("Normative sources do not match the frozen assessment input")
            if frozen_targets is not None and assessment_input.frozen_targets_hash != fingerprint([
                item.model_dump(mode="json") for item in frozen_targets
            ]):
                raise ValueError("Targets do not match the frozen controller assignment")
        elif normative_evidence or frozen_targets is not None:
            raise ValueError("Frozen authority/target overrides require a typed controller AssessmentInput")
        controller = await readiness(
            args, github, sdk, agent, capabilities=setup_capabilities, assessment_input=assessment_input,
            setup_selections=setup_selections,
        )
        save(controller.directory / "frozen-normative-evidence.json", [
            item.model_dump(mode="json") for item in normative_evidence
        ])
    else:
        if setup_capabilities:
            raise ValueError("Saved assessment setup receipts cannot be upgraded; start a new assessment")
        controller = load_controller(args.state_dir)
        if controller.issue.number != args.issue or controller.policy.model != args.model:
            raise ValueError("Individual phases must retain the frozen issue/model identity")
        if assessment_input is not None and assessment_input != controller.assessment_input:
            raise ValueError("Saved controller input cannot be replaced/upgraded")
        saved_normative = controller.directory / "frozen-normative-evidence.json"
        normative_evidence = [] if not saved_normative.is_file() and controller.assessment_input is None else [
            ValidityEvidence.model_validate(item) for item in json.loads(saved_normative.read_text(encoding="utf-8"))
        ]
        if frozen_targets is None and controller.assessment_input is not None:
            target_path = controller.directory / "targets.json"
            if target_path.is_file():
                frozen_targets = [ReproductionTarget.model_validate(item) for item in json.loads(target_path.read_text())]
    if controller.assessment_input is not None and controller.assessment_input.blind and (
        args.reference or args.validity_input is not None
    ):
        raise ValueError("Blind calibration cannot enable new identity/precedent research on resume")
    if controller.assessment_input is not None and (
        controller.assessment_input.normative_evidence_hash is not None
        and controller.assessment_input.normative_evidence_hash != fingerprint([
            item.model_dump(mode="json") for item in normative_evidence
        ])
        or normative_evidence and controller.assessment_input.normative_evidence_hash is None
    ):
        raise ValueError("Saved normative sources changed from the frozen assessment input")
    if controller.policy.implementation_hash != implementation_hash():
        raise ValueError("Frozen assessment implementation identity changed")
    await controller.rescreen(github.screen)
    if args.claim is not None:
        controller.claim(args.claim)
    if args.phase in {"discover", "refine", "verify"} and args.claim is None:
        raise ValueError("Individual execution phases require one exact frozen claim ID")
    phase_key = args.phase + (f"-{args.claim}" if args.claim is not None else "")
    controller.save_once(f"started-{phase_key}.json", {"policy_hash": controller.plan.policy_hash})
    progress: list[ClaimProgress] = saved_progress(controller)
    failures = []
    model_blocked: str | None = None
    try:
        claims = [controller.claim(args.claim)] if args.claim else controller.plan.claims
        targets = None
        if args.phase in {"assess", "discover", "verify"} and any(
            claim.readiness == "ready" or claim.discovery is not None for claim in claims
        ):
            if store is None:
                failures.append("Target store was not configured; execution remains unobserved")
            else:
                targets = await choose_targets(args, controller, github, store, frozen_targets=frozen_targets)
        pending_verifications = []
        for claim in claims:
            if claim.readiness == "blocked" or args.phase in {"readiness", "validity"}:
                continue
            try:
                discovery, refined = None, None
                if claim.discovery is not None and args.phase in {"assess", "discover"} and targets is not None and store is not None:
                    historical = next(target for target in targets if target.role == "historical")
                    if historical.status != "ready":
                        raise ValueError(historical.error or "Historical target is blocked")
                    plan = controller.freeze_discovery(claim.id, historical)
                    discovery = await controller.discover(plan, store)
                    progress.append(ClaimProgress(
                        claim_id=claim.id, phase="discovery",
                        status="captured" if discovery.observation == "captured" else "blocked",
                        receipt_ids=[discovery.id], target_observations={}, reasons=discovery.problems,
                    ))
                if args.phase == "refine":
                    discovery = AssessmentReceipt.model_validate_json(
                        (controller.directory / f"discovery-{claim.id}" / "receipt.json").read_text(encoding="utf-8")
                    )
                if discovery is not None and discovery.observation == "captured" and args.phase in {"assess", "refine"}:
                    if model_blocked is None:
                        refined = await refinement(controller, claim.id, discovery, sdk, agent)
                    else:
                        failures.append(f"Claim {claim.id}: refinement unperformed after provider schema rejection")
                if args.phase == "verify" and claim.readiness == "partial":
                    discovery = AssessmentReceipt.model_validate_json(
                        (controller.directory / f"discovery-{claim.id}" / "receipt.json").read_text(encoding="utf-8")
                    )
                    refined = VerificationRefinement.model_validate_json(
                        (controller.directory / f"discovery-{claim.id}" / "refinement.json").read_text(encoding="utf-8")
                    )
                eligible = claim.readiness == "ready" or refined is not None and refined.readiness == "ready"
                if eligible and args.phase in {"assess", "verify"} and targets is not None and store is not None:
                    plan = controller.freeze_verification(claim.id, targets, discovery=discovery, refinement=refined)
                    pending_verifications.append(plan)
            except (ValueError, AutomationError, OSError, TimeoutError) as error:
                failures.append(f"Claim {claim.id}: {type(error).__name__}: {error}")
                if schema_rejected(error):
                    model_blocked = f"Provider schema rejection; remaining model roles were not dispatched: {error}"
        # Finish all historical-only discovery/refinement before exposing any main/latest observation.
        for plan in pending_verifications:
            try:
                if store is None:
                    raise ValueError("A trusted target store is required")
                receipts = await controller.verify(plan, store)
                progress = [item for item in progress if item.claim_id != plan.claim_id]
                progress.append(controller.verification_progress(plan, receipts))
            except (ValueError, AutomationError, OSError, TimeoutError) as error:
                failures.append(f"Claim {plan.claim_id}: {type(error).__name__}: {error}")
    except (ValueError, AutomationError, OSError, TimeoutError) as error:
        failures.append(f"{type(error).__name__}: {error}")
    # Preserve independently saved observations even if a later target/role failed.
    recovered = {item.claim_id: item for item in progress}
    recovered.update({item.claim_id: item for item in saved_progress(controller)})
    result = controller.result(list(recovered.values()))
    if model_blocked is not None:
        result.validity = {"status": "blocked", "reason": model_blocked}
    elif args.phase in {"assess", "validity"} and not args.skip_validity:
        try:
            result.validity = await validity_phase(
                controller, args, sdk, result, github=github, normative_evidence=normative_evidence,
            )
        except (ValueError, AutomationError, OSError, TimeoutError) as error:
            failures.append(f"Validity: {type(error).__name__}: {error}")
            result.validity = {"status": "blocked", "reason": f"{type(error).__name__}: {error}"}
    elif args.skip_validity:
        result.validity = {"status": "unperformed", "reason": "Explicit --skip-validity; semantic disposition is unassessed"}
    result.failures = failures
    controller.save_once(f"result-{phase_key}.json", {
        "schema_version": 1, "assessment": result.model_dump(mode="json"),
        "readiness": controller.plan.readiness, "failures": failures,
        "action": None, "semantic_disposition": None, "proposed_labels": [], "state_reason": None,
    })
    return result


def saved_progress(controller: AssessmentController) -> list[ClaimProgress]:
    """Recover only actual version-one controller receipts, never publication/legacy state."""
    progress = []
    for claim in controller.plan.claims:
        verification = controller.directory / f"verification-{claim.id}"
        if (verification / "plan.json").is_file():
            receipts = [
                AssessmentReceipt.model_validate_json(path.read_text(encoding="utf-8"))
                for path in sorted(verification.glob("*-receipt.json"))
            ]
            if receipts:
                plan = VerificationPlan.model_validate_json((verification / "plan.json").read_text(encoding="utf-8"))
                progress.append(controller.verification_progress(plan, receipts))
                continue
        discovery = controller.directory / f"discovery-{claim.id}" / "receipt.json"
        if discovery.is_file():
            receipt = AssessmentReceipt.model_validate_json(discovery.read_text(encoding="utf-8"))
            plan = DiscoveryPlan.model_validate_json(discovery.with_name("plan.json").read_text(encoding="utf-8"))
            controller.require_discovery_plan(plan)
            if receipt.kind != "discovery" or receipt.plan_hash != fingerprint(plan.model_dump()):
                raise ValueError("Saved discovery receipt does not match the frozen version-one plan")
            reasons = list(receipt.problems)
            refinement_path = discovery.with_name("refinement.json")
            if refinement_path.is_file():
                refined = VerificationRefinement.model_validate_json(refinement_path.read_text(encoding="utf-8"))
                controller.validate_refinement(claim.id, receipt, refined)
                if refined.readiness == "blocked":
                    reasons.extend(f"Verification planning blocked: {reason}" for reason in refined.reasons)
            progress.append(ClaimProgress(
                claim_id=claim.id, phase="discovery", status="captured" if receipt.observation == "captured" else "blocked",
                receipt_ids=[receipt.id], target_observations={}, reasons=reasons,
            ))
    return progress


async def main(args: argparse.Namespace) -> None:
    snapshot = None if args.snapshot is None else AssessmentInput.model_validate_json(args.snapshot.read_text(encoding="utf-8"))
    if snapshot is not None:
        args.issue = snapshot.issue.number
    if (snapshot is None and args.issue <= 0) or not args.cli_path:
        raise ValueError("An issue number and existing authenticated Copilot runtime are required")
    frozen_targets = None if args.frozen_targets is None else [
        ReproductionTarget.model_validate(item) for item in json.loads(args.frozen_targets.read_text(encoding="utf-8"))
    ]
    setup_evidence = None
    if args.setup_evidence is not None:
        if snapshot is None or frozen_targets is None or args.phase not in {"assess", "readiness"}:
            raise ValueError("Setup evidence requires a fresh controller snapshot and exact frozen target assignments")
        if args.setup_evidence.stat().st_size > 1048576:
            raise ValueError("Approved setup evidence exceeds its transport bound")
        setup_evidence = AssessmentSetupEvidence.model_validate_json(args.setup_evidence.read_bytes())
        validate_setup_evidence(
            setup_evidence,
            capture_report(snapshot.issue, snapshot.comments, report_id=snapshot.report_id), frozen_targets,
            assessment_input=snapshot,
        )
    scorer = InjectionScreening.from_environment()
    github = GitHub(scorer=scorer)
    store = None if args.target_cache is None else TargetStore(args.target_cache, target_process, registry=args.registry)
    async with CopilotClient(
        connection=RuntimeConnection.for_stdio(path=args.cli_path), working_directory=str(ROOT),
        env={**child_environment(), "USE_TGREP": "false"},
    ) as client:
        normative = [] if args.normative_evidence is None else [
            ValidityEvidence.model_validate(item) for item in json.loads(args.normative_evidence.read_text(encoding="utf-8"))
        ]
        result = await assess(
            args, github, SDK(client, args.model, BUDGET), store=store, assessment_input=snapshot,
            frozen_targets=frozen_targets, normative_evidence=normative, setup_evidence=setup_evidence,
        )
    readiness_counts = ", ".join(
        f"{state}={sum(claim.readiness == state for claim in result.plan.claims)}"
        for state in ("ready", "partial", "blocked")
    )
    execution_counts = ", ".join(
        f"{state}={sum(item.status == state for item in result.progress)}"
        for state in ("complete", "captured", "partial", "blocked", "unobserved")
    )
    show(
        f"Read-only assessment: claims [{readiness_counts}]; observations [{execution_counts}]; "
        f"phase failures={len(result.failures)}. No issue action or publication is permitted. Results: {args.state_dir}"
    )


if __name__ == "__main__":
    try:
        asyncio.run(main(arguments()))
    except (ValueError, AutomationError, OSError) as error:
        show(f"Assessment blocked: {type(error).__name__}: {error}")
        sys.exit(1)
