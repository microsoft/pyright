# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import asyncio
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from pydantic import ValidationError

import issue_review_validity as validity
from issue_review_validity import (
    AuthorityReferenceReader, ClaimValidity, ReferenceRead, RetrievedReference, ValidityAssessment,
    ValidityClaimInput, ValidityEvidence, ValidityInput, ValidityResearch, assess_validity,
    build_validity_prompt, content_hash, parse_validity_response, record_hash, reference_kind,
    validate_validity_response,
)

SPEC_URL = "https://typing.python.org/en/latest/spec/annotations.html#variable-annotations"
POLICY_URL = (
    "https://github.com/microsoft/pyright/blob/"
    "576b8688fa047ec861fa66861c6322c67d7c0789/docs/type-concepts-advanced.md"
)


def evidence(identifier="source", kind="source", content='value: int = "wrong"\n', **updates):
    return ValidityEvidence.model_validate({
        "id": identifier, "kind": kind, "provenance": "controller_capture",
        "location": "controller:captured", "section": "Original source",
        "content": content, "sha256": content_hash(content), "claim_ids": ["assignment"],
        "source_id": None, "setup_id": None, "target": "not_applicable",
        "observation": "not_applicable", "version": None, "retrieved_at": None, **updates,
    })


def inputs(**updates):
    return ValidityInput.model_validate({
        "schema_version": 1, "report_id": "frozen-report", "report_text": "Assignment is rejected",
        "claims": [ValidityClaimInput(
            id="assignment", summary="Whether rejection is correct", context="Module assignment",
            source_id="source", setup_id="setup", readiness="blocked", assumptions=[],
            limitations=["Checker execution unavailable"], evidence_ids=["source", "setup", "rule"],
        )],
        "evidence": [
            evidence(), evidence("setup", "setup", '{"pythonVersion":"3.12"}'),
            evidence(
                "rule", "typing_spec", "An annotated variable is checked against its declared type.",
                provenance="retrieved_reference", location=SPEC_URL, section="Variable annotations",
                retrieved_at="2026-10-22T22:00:00Z",
            ),
        ], **updates,
    })


def claim(**updates):
    return ClaimValidity.model_validate({
        "claim_id": "assignment", "source_id": "source", "setup_id": "setup",
        "disposition": "as_designed", "status": "supported", "confidence": "high",
        "confidence_reason": "Applicable rule settles conditional rejection correctness, not execution",
        "scope": "Correctness of rejecting the exact annotated assignment, if that diagnostic is emitted",
        "basis": "specification", "reasoning": "A string literal does not satisfy the explicit int annotation",
        "rules": [{
            "domain": "static_typing", "version_status": "current", "target_python_version": None,
            "evidence_id": "rule", "section": "Variable annotations",
            "excerpt": "checked against its declared type", "rule": "Annotated variable assignability",
            "premises": [{"code_context": 'value: int = "wrong"', "application": "str is not assignable to int"}],
            "version_scope": "Current typing rule; no historical checker result inferred",
        }],
        "precedents": [], "evidence_ids": ["source", "setup", "rule"], "counterevidence_ids": [],
        "counterevidence": "Python runtime acceptance does not override annotated-variable static rules",
        "counterevidence_status": "does_not_defeat", "falsification": "An applicable assignability exception",
        "user_impact": "Program can run, but this assignment conflicts with its annotation",
        "assumptions": [], "limitations": ["Checker execution unavailable"], "information_requests": [], **updates,
    })


def assessment(controller=None, claims=None):
    controller = controller or inputs()
    return ValidityAssessment(
        schema_version=1, input_sha256=record_hash(controller),
        claims=claims or [claim()], limitations=["No execution, action or whole-issue conclusion"],
    )


def language_inputs(context=None, *, include_context=True, location="https://peps.python.org/pep-0798/"):
    source = "print([*range(x) for x in range(5)])\n"
    context = context or {
        "target_python_version": "3.15", "provenance": "reported",
        "limitations": ["No Python runtime execution was performed"],
    }
    original = inputs().model_dump()
    original["report_text"] = "Unpacking comprehension rejected with explicit Python 3.15 target"
    original["claims"][0].update(
        summary="Whether comprehension unpacking is valid Python 3.15 grammar", context="Grammar only",
        language_context=context if include_context else None,
    )
    original["evidence"][0] = evidence(content=source).model_dump()
    original["evidence"][2] = evidence(
        "rule", "python_docs", "This offline test stipulates accepted unpacking syntax for Python 3.15.",
        provenance="retrieved_reference", location=location, section="Language syntax",
        retrieved_at="2026-10-22T22:00:00Z",
    ).model_dump()
    return ValidityInput.model_validate(original)


def language_claim(**updates):
    original = claim().model_dump()
    original.update(
        basis="language_specification",
        scope="Conditional validity of unpacking comprehension syntax for the explicit Python 3.15 target",
        reasoning="The saved accepted language rule covers this exact comprehension form",
        rules=[{
            "domain": "python_language", "version_status": "accepted_for_target", "target_python_version": "3.15",
            "evidence_id": "rule", "section": "Language syntax", "excerpt": "unpacking syntax for Python 3.15",
            "rule": "Target-version grammar acceptance",
            "premises": [{"code_context": "print([*range(x) for x in range(5)])", "application": "Matches the stated grammar form"}],
            "version_scope": "Python 3.15 only; offline source/receipt fixtures, not actual fetched PEP findings",
        }],
        language_qualification={
            "static_typing_status": "not_applicable", "static_typing_reason": "Only grammar acceptance is scoped; no assignability rule is being overridden",
            "static_rule_evidence_ids": [],
        },
        limitations=["Checker execution unavailable", "No Python runtime execution was performed"],
    )
    original.update(updates)
    return ClaimValidity.model_validate(original)


class ValidityContractTests(unittest.TestCase):
    def test_experimental_receipts_retain_only_conditional_observations(self):
        for observation in ("discovery_only", "unobserved"):
            with self.subTest(observation=observation):
                experiment = evidence(
                    "experiment", "execution", "Conditional saved checker receipt",
                    provenance="controller_execution", source_id="source", setup_id="setup",
                    target="experimental", observation=observation, version="1.1.414",
                )
                controller = inputs(evidence=[*inputs().evidence, experiment])
                finding = claim(
                    status="qualified", assumptions=["Deliberately chosen release/target"],
                    evidence_ids=["source", "setup", "rule", "experiment"],
                )
                validate_validity_response(controller, assessment(controller, [finding]))
                self.assertIn("target=experimental", build_validity_prompt(controller))

    def test_experimental_receipts_cannot_be_promoted_to_verified_facts(self):
        for observation in ("verified_reproduced", "verified_absent"):
            with self.subTest(observation=observation), self.assertRaisesRegex(
                ValueError, "Experimental targets cannot",
            ):
                evidence(
                    "experiment", "execution", "Conditional saved checker receipt",
                    provenance="controller_execution", source_id="source", setup_id="setup",
                    target="experimental", observation=observation, version="1.1.414",
                )
        with self.assertRaisesRegex(ValueError, "Only execution evidence"):
            evidence(target="experimental")

    def test_experimental_receipt_cannot_support_a_settled_product_defect(self):
        experiment = evidence(
            "experiment", "execution", "Conditional saved checker receipt",
            provenance="controller_execution", source_id="source", setup_id="setup",
            target="experimental", observation="discovery_only", version="1.1.414",
        )
        controller = inputs(evidence=[*inputs().evidence, experiment])
        finding = claim(disposition="bug", evidence_ids=["source", "setup", "rule", "experiment"])
        with self.assertRaisesRegex(ValueError, "independently verified observation"):
            validate_validity_response(controller, assessment(controller, [finding]))

    def test_experimental_receipt_does_not_overturn_verified_negative_originals(self):
        absent = evidence(
            "absent", "execution", "Independently verified original absence",
            provenance="controller_execution", source_id="source", setup_id="setup",
            target="historical", observation="verified_absent", version="1.1.414",
        )
        experiment = evidence(
            "experiment", "execution", "Conditional saved checker receipt",
            provenance="controller_execution", source_id="source", setup_id="setup",
            target="experimental", observation="discovery_only", version="1.1.414",
        )
        controller = inputs(evidence=[*inputs().evidence, absent, experiment])
        finding = claim(
            disposition="bug", status="qualified", assumptions=["Deliberately chosen configuration"],
            evidence_ids=["source", "setup", "rule", "absent", "experiment"],
        )
        with self.assertRaisesRegex(ValueError, "all independently qualified original observations are absent"):
            validate_validity_response(controller, assessment(controller, [finding]))

    def test_controller_attaches_qualifications_and_captured_section_without_model_retyping(self):
        controller = language_inputs()
        raw = assessment(controller, [language_claim()]).model_dump()
        raw["claims"][0]["rules"][0]["section"] = None
        raw["claims"][0]["limitations"] = ["Additional model uncertainty"]
        before = json.dumps(raw, sort_keys=True)
        proposal = ValidityAssessment.model_validate(raw)
        result = validity.finalize_validity_response(controller, proposal)
        validate_validity_response(controller, result)
        self.assertEqual(result.claims[0].rules[0].section, controller.evidence[2].section)
        self.assertEqual(result.claims[0].limitations, [
            "Checker execution unavailable", "No Python runtime execution was performed", "Additional model uncertainty",
        ])
        self.assertIsNone(proposal.claims[0].rules[0].section)
        self.assertEqual(json.dumps(raw, sort_keys=True), before)

    def test_attached_controller_assumptions_reject_settled_output_not_silently_downgrade_it(self):
        original = inputs().model_dump()
        original["claims"][0]["assumptions"] = ["Explicitly chosen checking mode"]
        controller = ValidityInput.model_validate(original)
        with self.assertRaisesRegex(ValueError, "settled claim"):
            validity.finalize_validity_response(controller, assessment(controller))
        proposal = assessment(controller, [claim(
            status="qualified", assumptions=["Additional conditional premise"], limitations=["Model caveat"],
        )])
        result = validity.finalize_validity_response(controller, proposal)
        self.assertEqual(result.claims[0].assumptions, [
            "Explicitly chosen checking mode", "Additional conditional premise",
        ])
        self.assertEqual(result.claims[0].status, "qualified")

    def test_empty_additional_qualifications_use_frozen_ones_but_unqualified_final_records_fail(self):
        controller = inputs()
        proposal = assessment(controller, [claim(status="qualified", limitations=[])])
        result = validity.finalize_validity_response(controller, proposal)
        self.assertEqual(result.claims[0].limitations, controller.claims[0].limitations)
        with self.assertRaisesRegex(ValueError, "explicit limitations"):
            validate_validity_response(controller, proposal)
        original = controller.model_dump()
        original["claims"][0]["limitations"] = []
        with self.assertRaisesRegex(ValueError, "explicit limitations"):
            validity.finalize_validity_response(ValidityInput.model_validate(original), assessment(
                ValidityInput.model_validate(original), [claim(status="qualified", limitations=[])],
            ))

    def test_finalizer_does_not_repair_invented_sections_excerpts_ids_or_claim_scope(self):
        for updates in (
            {"section": "Invented section"}, {"evidence_id": "unknown", "section": None},
            {"excerpt": "Never captured", "section": None}, {"domain": "python_language", "section": None},
        ):
            raw = assessment().model_dump()
            raw["claims"][0]["rules"][0].update(updates)
            with self.subTest(updates=updates), self.assertRaises(ValueError):
                validity.finalize_validity_response(inputs(), ValidityAssessment.model_validate(raw))
        for update in ({"input_sha256": "0" * 64}, {"claims": [claim(claim_id="unknown").model_dump()]}):
            with self.subTest(update=update), self.assertRaises(ValueError):
                validity.finalize_validity_response(inputs(), ValidityAssessment.model_validate({
                    **assessment().model_dump(), **update,
                }))

    def test_rule_section_is_canonical_capture_metadata_and_stays_required_in_final_records(self):
        raw = claim().model_dump()
        raw["rules"][0]["section"] = None
        with self.assertRaisesRegex(ValueError, "section"):
            validate_validity_response(inputs(), assessment(claims=[ClaimValidity.model_validate(raw)]))

    def test_claim_local_evidence_catalog_and_feedback_preserve_scopes_for_additional_claims(self):
        controller = inputs()
        second = controller.claims[0].model_copy(update={
            "id": "additional", "source_id": "source-additional", "setup_id": "setup-additional",
            "evidence_ids": ["source-additional", "setup-additional"],
        })
        controller = inputs(claims=[*controller.claims, second], evidence=[
            *controller.evidence,
            evidence("source-additional", claim_ids=["additional"]),
            evidence("setup-additional", "setup", "{}", claim_ids=["additional"]),
        ])
        prompt = build_validity_prompt(controller)
        self.assertIn("Claim-local reference catalog", prompt)
        self.assertIn('"additional": ["source-additional", "setup-additional"]', prompt)
        raw = assessment(controller, [
            claim(), claim(
                claim_id="additional", source_id=second.source_id, setup_id=second.setup_id,
                disposition="inconclusive", status="inconclusive", basis="insufficient", rules=[],
                evidence_ids=[*second.evidence_ids, "rule"],
                information_requests=[{
                    "requested": "An applicable rule for the additional claim", "reason": "Authority is not scoped to it",
                    "distinguishes": "Required behavior versus optional analysis",
                }],
            ),
        ])
        with self.assertRaisesRegex(ValueError, "additional.*rule.*assignment"):
            validity.finalize_validity_response(controller, raw)
        raw.claims[1].evidence_ids = second.evidence_ids
        result = validity.finalize_validity_response(controller, raw)
        self.assertEqual(result.claims[1].disposition, "inconclusive")

    def test_rule_catalog_exposes_actual_domains_and_controller_target_without_relabeling_peps(self):
        controller = language_inputs()
        prompt = build_validity_prompt(controller)
        self.assertIn("Rule-domain and language-target catalog", prompt)
        self.assertIn('"allowed_rule_domain": "python_language"', prompt)
        self.assertIn('"target_python_version": "3.15"', prompt)
        self.assertIn("An inconclusive conclusion does not permit a mismatched rule", prompt)
        self.assertNotIn('"allowed_rule_domain": "static_typing"', prompt)

    def test_prompt_distinguishes_conditional_scope_absence_and_actual_reference_capability(self):
        controller = inputs()
        frozen = record_hash(controller)
        for exposed in (False, True):
            prompt = build_validity_prompt(controller, reference_reads=exposed)
            self.assertIn(
                "Reference capability: " + (
                    "bounded read_reference is exposed." if exposed else "unavailable; use only saved input evidence."
                ), prompt,
            )
            self.assertIn("a nonempty set of independently qualified original observations", prompt)
            self.assertIn("No verified original observations is not the same as verified-negative originals", prompt)
            self.assertIn("Rules may be composed when their actual premises cover the example", prompt)
            self.assertIn("Retain every variant obligation", prompt)
        self.assertEqual(record_hash(controller), frozen)

    def test_language_rule_target_rejection_identifies_claim_reference_and_expected_target(self):
        controller = language_inputs()
        result = assessment(controller, [language_claim()])
        result.claims[0].rules[0].target_python_version = "3.14"
        with self.assertRaisesRegex(ValueError, "assignment.*rule.*3.14.*3.15"):
            validity.finalize_validity_response(controller, result)

    def test_blocked_execution_does_not_prevent_exact_conditional_normative_research(self):
        controller = inputs()
        result = assessment(controller)
        validate_validity_response(controller, result)
        self.assertEqual(result.claims[0].disposition, "as_designed")
        self.assertNotIn("closure", ValidityAssessment.model_fields)
        self.assertNotIn("reproduction", ValidityAssessment.model_fields)

    def test_unknown_claim_source_and_setup_references_are_rejected(self):
        controller = inputs()
        for updates in (
            {"claim_id": "invented"}, {"source_id": "invented"}, {"setup_id": "invented"},
            {"evidence_ids": ["source", "setup", "invented"]}, {"counterevidence_ids": ["invented"]},
            {"evidence_ids": ["rule"]},
        ):
            with self.subTest(updates=updates), self.assertRaises(ValueError):
                validate_validity_response(controller, assessment(controller, [claim(**updates)]))

    def test_source_and_setup_input_kinds_and_claim_membership_are_validated(self):
        original = inputs().model_dump()
        original["claims"][0]["source_id"] = "rule"
        with self.assertRaises(ValueError):
            ValidityInput.model_validate(original)
        original = inputs().model_dump()
        original["evidence"][0]["claim_ids"] = ["unknown"]
        with self.assertRaises(ValueError):
            ValidityInput.model_validate(original)

    def test_actual_content_hashes_and_retrieved_provenance_are_required(self):
        for updates in (
            {"sha256": "0" * 64}, {"kind": "typing_spec"},
            {"kind": "typing_spec", "location": SPEC_URL},
        ):
            with self.subTest(updates=updates), self.assertRaises(ValueError):
                evidence(**updates)

    def test_model_cannot_invent_authority_or_replace_actual_content_with_a_url(self):
        controller = inputs()
        original = claim().model_dump()
        for updates in (
            {"evidence_id": "invented"}, {"excerpt": "A rule that was never retrieved"},
            {"section": "Unretrieved section"},
        ):
            modified = {**original, "rules": [{**original["rules"][0], **updates}]}
            with self.subTest(updates=updates), self.assertRaises(ValueError):
                validate_validity_response(controller, assessment(controller, [ClaimValidity.model_validate(modified)]))

    def test_mypy_runtime_label_and_absent_mandate_do_not_settle_design(self):
        for basis in ("environment", "requested_capability", "insufficient"):
            with self.subTest(basis=basis), self.assertRaises(ValidationError):
                claim(basis=basis)
        with self.assertRaises(ValidationError):
            claim(rules=[])
        modified = claim().model_dump()
        modified["rules"][0]["evidence_id"] = "setup"
        with self.assertRaises(ValueError):
            validate_validity_response(inputs(), assessment(claims=[ClaimValidity.model_validate(modified)]))

    def test_documented_policy_requires_actual_pinned_policy_not_old_precedent_alone(self):
        controller = inputs()
        original = controller.model_dump()
        policy = evidence(
            "rule", "policy", "For this unspecified case the documented policy applies.",
            location=POLICY_URL, section="Policy", provenance="retrieved_reference",
            retrieved_at="2026-10-22T22:00:00Z",
        )
        original["evidence"][2] = policy.model_dump()
        controller = ValidityInput.model_validate(original)
        policy_claim = claim().model_dump()
        policy_claim["basis"] = "documented_policy"
        policy_claim["rules"][0].update(domain="project_policy", section="Policy", excerpt="documented policy")
        validate_validity_response(controller, assessment(controller, [ClaimValidity.model_validate(policy_claim)]))
        original["evidence"][2].update(kind="precedent", location="https://github.com/microsoft/pyright/issues/123")
        controller = ValidityInput.model_validate(original)
        with self.assertRaises(ValueError):
            validate_validity_response(controller, assessment(controller, [ClaimValidity.model_validate(policy_claim)]))

    def test_precedent_requires_actual_decision_underlying_match_and_qualifications(self):
        controller = inputs()
        precedent = evidence(
            "precedent", "precedent", "Decision: a distinct case was intentional, under earlier rules.",
            location="https://github.com/microsoft/pyright/issues/123#issuecomment-456",
            section="Decision", provenance="retrieved_reference", retrieved_at="2026-10-22T22:00:00Z",
        )
        controller = inputs(evidence=[*controller.evidence, precedent])
        application = {
            "evidence_id": "precedent", "decision_excerpt": "a distinct case was intentional",
            "underlying_match": "No exact match", "chronology": "Predates current rule",
            "configuration_match": "Different settings", "qualifications": "Not controlling; considered counterevidence",
        }
        validate_validity_response(controller, assessment(controller, [claim(precedents=[application])]))
        for missing in ("underlying_match", "chronology", "configuration_match", "qualifications"):
            with self.subTest(missing=missing), self.assertRaises(ValueError):
                claim(precedents=[{key: value for key, value in application.items() if key != missing}])

    def test_supported_claim_cannot_hide_assumptions_or_unresolved_counterevidence(self):
        for updates in (
            {"assumptions": ["Assumed mode"]}, {"counterevidence_status": "unresolved"},
            {"counterevidence_status": "defeats"},
            {"information_requests": [{"requested": "Mode", "reason": "Missing", "distinguishes": "Override versus defect"}]},
        ):
            with self.subTest(updates=updates), self.assertRaises(ValueError):
                claim(**updates)
        original = inputs().model_dump()
        original["claims"][0]["assumptions"] = ["Mode was chosen, not reported"]
        controller = ValidityInput.model_validate(original)
        with self.assertRaises(ValueError):
            validate_validity_response(controller, assessment(controller))
        qualified = claim(status="qualified", assumptions=["Mode was chosen, not reported"])
        validate_validity_response(controller, assessment(controller, [qualified]))

    def test_every_material_claim_must_be_preserved(self):
        controller = inputs()
        second = controller.claims[0].model_copy(update={"id": "integration"})
        evidence_items = [item.model_copy(update={"claim_ids": ["assignment", "integration"]}) for item in controller.evidence]
        controller = inputs(claims=[controller.claims[0], second], evidence=evidence_items)
        with self.assertRaises(ValueError):
            validate_validity_response(controller, assessment(controller))
        with self.assertRaises(ValueError):
            assessment(controller, [claim(), claim()])

    def test_supported_bug_and_environment_need_independent_verified_observation(self):
        controller = inputs()
        for disposition, basis, rules in (("bug", "specification", claim().rules), ("stub_or_environment", "environment", [])):
            finding = claim(disposition=disposition, basis=basis, rules=rules)
            with self.subTest(disposition=disposition), self.assertRaises(ValueError):
                validate_validity_response(controller, assessment(controller, [finding]))
        discovery = evidence(
            "execution", "execution", "Raw historical diagnostic", provenance="controller_execution",
            source_id="source", setup_id="setup", target="historical", observation="discovery_only", version="1.1.406",
        )
        for status in ("discovery_only", "verified_absent", "verified_reproduced"):
            execution = discovery.model_copy(update={"observation": status})
            current = inputs(evidence=[*controller.evidence, execution])
            finding = claim(disposition="bug", evidence_ids=["source", "setup", "rule", "execution"])
            if status != "verified_reproduced":
                with self.assertRaises(ValueError):
                    validate_validity_response(current, assessment(current, [finding]))
            else:
                validate_validity_response(current, assessment(current, [finding]))

    def test_inconclusive_needs_precise_requests_not_empty_abstention(self):
        with self.assertRaises(ValueError):
            claim(disposition="inconclusive", status="inconclusive", rules=[], basis="insufficient")
        finding = claim(
            disposition="inconclusive", status="inconclusive", rules=[], basis="insufficient",
            information_requests=[{
                "requested": "Exact effective diagnostic setting", "reason": "Not reported",
                "distinguishes": "Disabled diagnostic versus checker omission",
            }],
        )
        validate_validity_response(inputs(), assessment(claims=[finding]))

    def test_all_negative_originals_require_inconclusive_not_a_conditional_bug(self):
        controller = inputs()
        executions = [
            evidence(
                f"original-{target}", "execution", "Original symptom independently absent",
                provenance="controller_execution", source_id="source", setup_id="setup",
                target=target, observation="verified_absent", version="1.1.414",
            ) for target in ("historical", "main", "latest")
        ]
        controller = inputs(evidence=[*controller.evidence, *executions])
        conditional = claim(disposition="bug", status="qualified")
        with self.assertRaisesRegex(ValueError, "all independently qualified original observations are absent"):
            validate_validity_response(controller, assessment(controller, [conditional]))
        unresolved = claim(
            disposition="inconclusive", status="inconclusive",
            reasoning="The hypothetical diagnostic would violate the rule, but its occurrence is unestablished.",
            information_requests=[{
                "requested": "Original receipt exhibiting the reported symptom",
                "reason": "Every qualified original contradicts the allegation",
                "distinguishes": "An actual defect from a hypothetical rule violation",
            }],
        )
        validate_validity_response(controller, assessment(controller, [unresolved]))

    def test_zero_verified_originals_allow_only_a_conditional_not_supported_bug_finding(self):
        controller = inputs(
            report_text="The valid assignment value: int = 1 is reportedly rejected.",
            evidence=[evidence(content="value: int = 1\n"), *inputs().evidence[1:]],
        )
        conditional = claim(
            disposition="bug", status="qualified",
            scope="If the reported rejection of this valid assignment occurs, it contradicts assignability.",
            reasoning="The literal integer 1 satisfies int; no original execution confirms the alleged rejection.",
        )
        conditional.rules[0].premises[0].code_context = "value: int = 1"
        conditional.rules[0].premises[0].application = "An integer literal is assignable to int."
        validate_validity_response(controller, assessment(controller, [conditional]))
        conditional.status = "supported"
        with self.assertRaisesRegex(ValueError, "independently verified observation"):
            validate_validity_response(controller, assessment(controller, [conditional]))

    def test_historical_reproduction_and_discovery_only_remain_distinct_from_all_negative_originals(self):
        controller = inputs()
        conditional = claim(disposition="bug", status="qualified")
        for observation in ("discovery_only", "unobserved", "verified_reproduced"):
            observed = evidence(
                "historical", "execution", "Offline qualified observation fixture",
                provenance="controller_execution", source_id="source", setup_id="setup",
                target="historical", observation=observation, version="1.1.414",
            )
            current = inputs(evidence=[*controller.evidence, observed])
            validate_validity_response(current, assessment(current, [conditional]))
        reproduced = observed
        absent = reproduced.model_copy(update={"id": "main", "target": "main", "observation": "verified_absent"})
        current = inputs(evidence=[*controller.evidence, reproduced, absent])
        validate_validity_response(current, assessment(current, [conditional]))
        discovery = reproduced.model_copy(update={"observation": "discovery_only"})
        current = inputs(evidence=[*controller.evidence, discovery, absent])
        with self.assertRaisesRegex(ValueError, "all independently qualified"):
            validate_validity_response(current, assessment(current, [conditional]))

    def test_negative_original_does_not_borrow_another_claims_reproduction(self):
        controller = inputs()
        second = controller.claims[0].model_copy(update={"id": "independent"})
        records = [item.model_copy(update={"claim_ids": ["assignment", "independent"]}) for item in controller.evidence]
        for identifier, ids, observation in (
            ("first-original", ["assignment"], "verified_absent"),
            ("other-original", ["independent"], "verified_reproduced"),
        ):
            records.append(evidence(
                identifier, "execution", "Offline original fixture", claim_ids=ids,
                provenance="controller_execution", source_id="source", setup_id="setup",
                target="historical", observation=observation, version="1.1.414",
            ))
        controller = inputs(claims=[controller.claims[0], second], evidence=records)
        with self.assertRaisesRegex(ValueError, "all independently qualified"):
            validate_validity_response(controller, assessment(controller, [
                claim(disposition="bug", status="qualified"), claim(claim_id="independent"),
            ]))

    def test_json_decoder_rejects_duplicates_nonfinite_and_open_wire_fields(self):
        raw = assessment().model_dump_json()
        self.assertEqual(parse_validity_response(raw), assessment())
        for broken in (
            raw.replace('"schema_version":1', '"schema_version":1,"schema_version":1', 1),
            raw.replace('"schema_version":1', '"schema_version":NaN', 1),
            raw[:-1] + ',"publish":true}',
        ):
            with self.subTest(broken=broken[:100]), self.assertRaises(ValueError):
                parse_validity_response(broken)

    def test_authority_allowlist_is_exact_and_rejects_encoded_traversal(self):
        for location in (
            "http://typing.python.org/en/latest/spec/annotations.html",
            "https://typing.python.org.evil.test/en/latest/spec/annotations.html",
            "https://typing.python.org/en/latest/spec/index.html",
            "https://typing.python.org/en/latest/spec/../../other.html",
            "https://typing.python.org/en/latest/spec/%2e%2e/other.html",
            "https://user@typing.python.org/en/latest/spec/annotations.html",
            "https://typing.python.org:444/en/latest/spec/annotations.html",
            "https://typing.python.org/en/latest/spec/annotations.html?next=evil",
            "https://github.com/microsoft/pyright/blob/main/docs/type-concepts-advanced.md",
            "https://github.com/rchiodo/pyright/issues/123", r"docs\type-concepts-advanced.md",
        ):
            with self.subTest(location=location), self.assertRaises(ValueError):
                reference_kind(location)
        self.assertEqual(reference_kind(SPEC_URL), "typing_spec")
        self.assertEqual(reference_kind(POLICY_URL), "policy")
        self.assertEqual(reference_kind("https://github.com/microsoft/pyright/issues/123#issuecomment-1"), "precedent")

    def test_provider_schema_has_no_open_objects(self):
        def visit(value):
            if isinstance(value, dict):
                if value.get("type") == "object":
                    self.assertIs(value.get("additionalProperties"), False)
                for child in value.values():
                    visit(child)
            elif isinstance(value, list):
                for child in value:
                    visit(child)
        visit(ValidityAssessment.model_json_schema())
        self.assertIn("untrusted", build_validity_prompt(inputs()))

    def test_language_rule_can_support_exact_target_language_correctness_without_impersonating_typing_spec(self):
        controller = language_inputs()
        result = assessment(controller, [language_claim()])
        validate_validity_response(controller, result)
        self.assertEqual(result.claims[0].basis, "language_specification")
        python_docs = language_inputs(location="https://docs.python.org/3.15/reference/expressions.html")
        finding = language_claim().model_dump()
        finding["rules"][0]["version_status"] = "current"
        validate_validity_response(python_docs, assessment(python_docs, [ClaimValidity.model_validate(finding)]))

    def test_language_bug_still_requires_actual_bound_product_observation(self):
        controller = language_inputs()
        finding = language_claim(disposition="bug")
        with self.assertRaisesRegex(ValueError, "independently verified"):
            validate_validity_response(controller, assessment(controller, [finding]))
        execution = evidence(
            "execution", "execution", "Offline controller receipt fixture: reported grammar rejection",
            provenance="controller_execution", source_id="source", setup_id="setup",
            target="main", observation="verified_reproduced", version="offline-pyright-version",
        )
        controller = inputs(**{**controller.model_dump(), "evidence": [*controller.evidence, execution]})
        finding = language_claim(disposition="bug", evidence_ids=["source", "setup", "rule", "execution"])
        validate_validity_response(controller, assessment(controller, [finding]))

    def test_missing_assumed_mismatched_or_provisional_language_versions_cannot_settle(self):
        for controller in (
            language_inputs(include_context=False),
            language_inputs({"target_python_version": "3.15", "provenance": "assumed", "limitations": ["Chosen target"]}),
            language_inputs({"target_python_version": "3.14", "provenance": "reported", "limitations": []}),
        ):
            with self.subTest(context=controller.claims[0].language_context), self.assertRaises(ValueError):
                validate_validity_response(controller, assessment(controller, [language_claim()]))
        controller = language_inputs()
        raw = language_claim().model_dump()
        raw["rules"][0]["version_status"] = "provisional"
        with self.assertRaisesRegex(ValueError, "current/accepted"):
            validate_validity_response(controller, assessment(controller, [ClaimValidity.model_validate(raw)]))
        finding = language_claim(status="qualified", assumptions=["If the omitted target is Python 3.15"])
        controller = language_inputs(include_context=False)
        validate_validity_response(controller, assessment(controller, [finding]))

    def test_language_or_runtime_documents_cannot_override_or_stand_in_for_static_typing_rules(self):
        controller = language_inputs()
        finding = language_claim().model_dump()
        finding["basis"] = "specification"
        with self.assertRaisesRegex(ValueError, "primary domain"):
            validate_validity_response(controller, assessment(controller, [ClaimValidity.model_validate(finding)]))
        finding["rules"][0]["domain"] = "static_typing"
        with self.assertRaisesRegex(ValueError, "retrieved rule"):
            validate_validity_response(controller, assessment(controller, [ClaimValidity.model_validate(finding)]))
        for status in ("unresolved", "conflicts"):
            with self.subTest(status=status), self.assertRaises(ValueError):
                language_claim(language_qualification={
                    "static_typing_status": status, "static_typing_reason": "Applicable static rule unresolved",
                    "static_rule_evidence_ids": [],
                })
        with self.assertRaisesRegex(ValueError, "static rule evidence"):
            language_claim(language_qualification={
                "static_typing_status": "consistent", "static_typing_reason": "Unsupported assertion",
                "static_rule_evidence_ids": [],
            })

    def test_accepted_pep_claim_needs_actual_pep_source_and_cannot_fabricate_a_rule_domain(self):
        controller = language_inputs(location="https://docs.python.org/3.15/reference/expressions.html")
        with self.assertRaisesRegex(ValueError, "actual retrieved PEP"):
            validate_validity_response(controller, assessment(controller, [language_claim()]))
        raw = language_claim().model_dump()
        del raw["rules"][0]["domain"]
        with self.assertRaises(ValueError):
            ClaimValidity.model_validate(raw)


class ValidityExecutionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.directory = Path(self.temporary.name)
        self.reader = AsyncMock()
        self.reader.read_reference.return_value = RetrievedReference(
            location=SPEC_URL, section="Variable annotations", content="Actual retrieved normative content.",
            offset=0, anchor_offset=0, total_chars=35, retrieved_at="2026-10-22T22:00:00Z",
        )
        self.research = ValidityResearch(self.reader, self.directory, ["assignment"])

    async def asyncTearDown(self):
        self.temporary.cleanup()

    async def test_frozen_no_tools_sdk_path_has_one_explicit_shared_budget(self):
        capability = AsyncMock()
        capability.run.return_value = assessment().model_dump_json()
        result = await assess_validity(inputs(), capability, budget_seconds=180)
        self.assertEqual(result.claims[0].disposition, "as_designed")
        self.assertEqual(capability.run.await_count, 1)
        self.assertIsNone(capability.run.call_args.kwargs["research"])
        self.assertEqual(capability.run.call_args.kwargs["budget_seconds"], 180)
        self.assertIn("Reference capability: unavailable", capability.run.call_args.args[0])

    async def test_no_retry_or_new_budget_on_failed_response(self):
        capability = AsyncMock()
        capability.run.return_value = '{"schema_version":1}'
        with self.assertRaises(ValueError):
            await assess_validity(inputs(), capability, budget_seconds=1)
        self.assertEqual(capability.run.await_count, 1)
        for budget in (0, -1, 181, float("inf"), float("nan")):
            with self.subTest(budget=budget), self.assertRaises(ValueError):
                await assess_validity(inputs(), capability, budget_seconds=budget)
        self.assertEqual(capability.run.await_count, 1)

    async def test_timeout_does_not_create_replacement_attempt(self):
        capability = AsyncMock()
        capability.run.side_effect = lambda *args, **kwargs: None

        async def slow(*args, **kwargs):
            await asyncio.sleep(1)
            return assessment().model_dump_json()
        capability.run.side_effect = slow
        with self.assertRaises(TimeoutError):
            await assess_validity(inputs(), capability, budget_seconds=0.001)
        self.assertEqual(capability.run.await_count, 1)

    async def test_research_saves_actual_bounded_evidence_and_refuses_reuse(self):
        saved = await self.research.read_reference(ReferenceRead(location=SPEC_URL))
        path = self.directory / f"{saved.id}.json"
        self.assertEqual(ValidityEvidence.model_validate_json(path.read_bytes()), saved)
        saved.content = "Caller mutation"
        self.assertNotEqual(self.research.evidence[0].content, saved.content)
        second = ValidityResearch(self.reader, self.directory, ["assignment"])
        with self.assertRaises(FileExistsError):
            await second.read_reference(ReferenceRead(location=SPEC_URL))

    async def test_research_screens_validated_excerpts_before_saving_or_authorizing_them(self):
        async def screen(value, source):
            self.assertEqual(value["content"], self.reader.read_reference.return_value.content)
            self.assertEqual(source, "validity-reference:1")
            self.assertFalse(self.research.evidence)
            self.assertFalse(list(self.directory.iterdir()))

        screening = AsyncMock(side_effect=screen)
        saved = await self.research.read_reference(ReferenceRead(location=SPEC_URL), screen=screening)
        screening.assert_awaited_once()
        self.assertEqual(self.research.evidence, [saved])

    async def test_blocked_reference_never_becomes_saved_or_citable_evidence(self):
        from issue_review_safety import ScreeningBlocked

        screening = AsyncMock(side_effect=ScreeningBlocked("Blocked reference"))
        with self.assertRaisesRegex(ScreeningBlocked, "Blocked reference"):
            await self.research.read_reference(ReferenceRead(location=SPEC_URL), screen=screening)
        self.assertFalse(self.research.evidence)
        self.assertFalse(list(self.directory.iterdir()))
        saved = await self.research.read_reference(ReferenceRead(location=SPEC_URL))
        self.assertEqual(saved.id, "validity-reference-2")

    async def test_cancelled_reference_screening_never_creates_usable_evidence(self):
        screening = AsyncMock(side_effect=asyncio.CancelledError)
        with self.assertRaises(asyncio.CancelledError):
            await self.research.read_reference(ReferenceRead(location=SPEC_URL), screen=screening)
        self.assertFalse(self.research.evidence)
        self.assertFalse(list(self.directory.iterdir()))

    async def test_real_screening_retains_a_rejected_excerpt_without_authorizing_its_evidence_id(self):
        from issue_review_safety import InjectionScreening, ScreeningBlocked
        from review_issues import GitHub
        from test_issue_review_safety import classification

        classifier = AsyncMock()
        classifier.configuration_hash = "offline-reference-screening"
        classifier.classify.return_value = classification(0.35)
        github = GitHub(scorer=InjectionScreening(classifier))
        role = self.directory / "roles" / "validity"

        async def screen(value, source):
            await github.screen(value, role, source)

        with self.assertRaisesRegex(ScreeningBlocked, "uncertain"):
            await self.research.read_reference(ReferenceRead(location=SPEC_URL), screen=screen)
        self.assertFalse(self.research.evidence)
        self.assertFalse(list(self.directory.glob("validity-reference-*.json")))
        path, = (role / "screening-diagnostics").glob("*.json")
        with self.assertRaises(ValueError):
            ValidityEvidence.model_validate_json(path.read_bytes())
        diagnostic = json.loads(path.read_bytes())
        self.assertEqual(json.loads(diagnostic["evidence_json"])["id"], "validity-reference-1")

    async def test_disallowed_authority_requests_also_consume_the_shared_read_allowance(self):
        for _ in range(12):
            with self.assertRaises(ValueError):
                await self.research.read_reference(ReferenceRead(location="file:///not-an-authority"))
        with self.assertRaisesRegex(ValueError, "budget"):
            await self.research.read_reference(ReferenceRead(location=SPEC_URL))
        self.reader.read_reference.assert_not_awaited()

    async def test_research_budget_counts_failed_requests_and_never_truncates(self):
        self.reader.read_reference.side_effect = OSError("Unavailable")
        for _ in range(12):
            with self.assertRaises(OSError):
                await self.research.read_reference(ReferenceRead(location=SPEC_URL))
        with self.assertRaisesRegex(ValueError, "budget"):
            await self.research.read_reference(ReferenceRead(location=SPEC_URL))
        self.assertEqual(self.reader.read_reference.await_count, 12)

    async def test_overlapping_reads_reserve_distinct_ids_before_out_of_order_completion(self):
        first_started = asyncio.Event()
        release_first = asyncio.Event()
        second_url = "https://typing.python.org/en/latest/spec/callables.html#callable"

        async def out_of_order(request):
            if request.location == SPEC_URL:
                first_started.set()
                await release_first.wait()
                content = "First requested source, completed second"
            else:
                await first_started.wait()
                release_first.set()
                content = "Second requested source, completed first"
            return RetrievedReference(
                location=request.location, section="Exact requested section", content=content,
                offset=0, anchor_offset=0, total_chars=len(content), retrieved_at="2026-10-22T22:00:00Z",
            )

        self.reader.read_reference.side_effect = out_of_order
        first, second = await asyncio.gather(
            self.research.read_reference(ReferenceRead(location=SPEC_URL)),
            self.research.read_reference(ReferenceRead(location=second_url)),
        )
        self.assertEqual((first.id, second.id), ("validity-reference-1", "validity-reference-2"))
        for item, location in ((first, SPEC_URL), (second, second_url)):
            saved = ValidityEvidence.model_validate_json((self.directory / f"{item.id}.json").read_bytes())
            self.assertEqual(saved, item)
            self.assertEqual(saved.location, location)
            self.assertEqual(saved.sha256, content_hash(item.content))
        self.assertEqual([item.id for item in self.research.evidence], ["validity-reference-2", "validity-reference-1"])
        for _ in range(10):
            await self.research.read_reference(ReferenceRead(location=SPEC_URL))
        with self.assertRaisesRegex(ValueError, "budget"):
            await self.research.read_reference(ReferenceRead(location=SPEC_URL))
        self.assertEqual(self.reader.read_reference.await_count, 12)
        self.assertEqual(len(list(self.directory.glob("validity-reference-*.json"))), 12)

    async def test_redirect_or_mismatched_reference_cannot_be_saved(self):
        for updates in (
            {"location": "https://evil.test"}, {"offset": 1},
            {"total_chars": 1},
        ):
            self.reader.read_reference.side_effect = None
            self.reader.read_reference.return_value = self.reader.read_reference.return_value.model_copy(update=updates)
            with self.subTest(updates=updates), self.assertRaises(ValueError):
                await self.research.read_reference(ReferenceRead(location=SPEC_URL))
        self.assertFalse(list(self.directory.iterdir()))

    async def test_default_reader_is_authority_only_and_refuses_redirects(self):
        reader = AuthorityReferenceReader()
        with self.assertRaises(ValueError):
            await reader.read_reference(ReferenceRead(location="https://github.com/microsoft/pyright/issues/123"))
        connection = MagicMock()
        connection.getresponse.return_value.status = 302
        connection.getresponse.return_value.read.return_value = b"redirect"
        with patch("issue_review_validity.http.client.HTTPSConnection", return_value=connection):
            with self.assertRaisesRegex(ValueError, "redirects"):
                await reader.read_reference(ReferenceRead(location=SPEC_URL))
        connection.close.assert_called_once()

    async def test_default_reader_reuses_visible_text_and_returns_only_bounded_actual_content(self):
        reader = AuthorityReferenceReader()
        connection = MagicMock()
        connection.getresponse.return_value.status = 200
        connection.getresponse.return_value.read.return_value = (
            b'<html><script>not normative text</script><h1 id="variable-annotations">Variable annotations</h1>'
            b"<p>An annotated variable is checked against its declared type.</p></html>"
        )
        with patch("issue_review_validity.http.client.HTTPSConnection", return_value=connection):
            page = await reader.read_reference(ReferenceRead(location=SPEC_URL, max_chars=100))
        self.assertNotIn("not normative text", page.content)
        self.assertIn("checked against its declared type", page.content)
        self.assertLessEqual(len(page.content), 100)
        self.assertEqual(page.location, SPEC_URL)
        self.assertEqual(page.section, "variable-annotations")

    async def test_default_reader_follows_the_actual_anchor_beyond_a_long_introduction(self):
        reader = AuthorityReferenceReader()
        connection = MagicMock()
        connection.getresponse.return_value.status = 200
        connection.getresponse.return_value.read.return_value = (
            '<html><nav><a href="#variable-annotations">Variable annotations</a></nav>'
            "<p>" + "Unrelated introductory text. " * 200 + "</p>"
            '<section id="variable-annotations"><h2>Variable annotations</h2>'
            "<p>The specifically requested assignability rule.</p></section></html>"
        ).encode()
        with patch("issue_review_validity.http.client.HTTPSConnection", return_value=connection):
            page = await reader.read_reference(ReferenceRead(location=SPEC_URL, max_chars=150))
        self.assertIn("specifically requested assignability rule", page.content)
        self.assertNotIn("Unrelated introductory text", page.content)
        self.assertGreater(page.offset, 4000)
        self.assertEqual(page.anchor_offset, page.offset)
        self.assertLessEqual(len(page.content), 150)

    async def test_percent_encoded_named_anchor_and_unicode_find_keep_actual_visible_offsets(self):
        reader = AuthorityReferenceReader()
        connection = MagicMock()
        connection.getresponse.return_value.status = 200
        html = (
            '<html><p>Stra&#223;e &#304; in the introduction.</p>'
            '<a id="variable-annotations" name="variable-annotations"></a><p>'
            + "Context. " * 30 + "A specific NEEDLE appears here.</p></html>"
        )
        connection.getresponse.return_value.read.return_value = html.encode()
        with patch("issue_review_validity.http.client.HTTPSConnection", return_value=connection):
            page = await reader.read_reference(ReferenceRead(
                location=SPEC_URL.replace("#variable-annotations", "#variable%2Dannotations"),
                find="needle", max_chars=10,
            ))
            with self.assertRaisesRegex(ValueError, "excerpt size"):
                await reader.read_reference(ReferenceRead(location=SPEC_URL, find="needle", max_chars=5))
        from evaluate_issue_design import VisibleText

        parser = VisibleText()
        parser.feed(html)
        content = "".join(parser.text)
        self.assertIn("NEEDLE", page.content)
        self.assertEqual(page.content, content[page.offset:page.offset + 10])
        self.assertEqual(page.anchor_offset, parser.anchors["variable-annotations"][0])
        self.assertEqual(len(parser.anchors["variable-annotations"]), 1)

    async def test_missing_ambiguous_or_hidden_anchor_is_an_error_not_unrelated_page_content(self):
        reader = AuthorityReferenceReader()
        for html in (
            '<html><h1 id="different">Unrelated content</h1></html>',
            '<html><p id="variable-annotations">First</p><p id="variable-annotations">Second</p></html>',
            '<html><script id="variable-annotations">Not visible authority</script><p>Unrelated</p></html>',
        ):
            connection = MagicMock()
            connection.getresponse.return_value.status = 200
            connection.getresponse.return_value.read.return_value = html.encode()
            with self.subTest(html=html), patch(
                "issue_review_validity.http.client.HTTPSConnection", return_value=connection,
            ), self.assertRaisesRegex(ValueError, "anchor"):
                await reader.read_reference(ReferenceRead(location=SPEC_URL))

    async def test_explicit_paging_and_find_respect_the_anchored_document(self):
        reader = AuthorityReferenceReader()
        connection = MagicMock()
        connection.getresponse.return_value.status = 200
        connection.getresponse.return_value.read.return_value = (
            '<html><p>Needle in the navigation</p><section id="variable-annotations">'
            "<p>Needle in the requested section.</p></section></html>"
        ).encode()
        with patch("issue_review_validity.http.client.HTTPSConnection", return_value=connection):
            first = await reader.read_reference(ReferenceRead(location=SPEC_URL, find="Needle"))
            page = await reader.read_reference(ReferenceRead(location=SPEC_URL, offset=5, max_chars=10))
            with self.assertRaisesRegex(ValueError, "find"):
                await reader.read_reference(ReferenceRead(location=SPEC_URL, find="Missing phrase"))
        self.assertNotIn("navigation", first.content)
        self.assertIn("requested section", first.content)
        self.assertEqual(page.offset, 5)
        self.assertEqual(len(page.content), 10)
        self.assertIsNone(page.anchor_offset)

    async def test_research_preserves_actual_anchor_offset_without_allowing_arbitrary_offset_changes(self):
        self.reader.read_reference.return_value = RetrievedReference(
            location=SPEC_URL, section="variable-annotations", content="Actual scoped rule.",
            offset=50, anchor_offset=50, total_chars=100, retrieved_at="2026-10-22T22:00:00Z",
        )
        saved = await self.research.read_reference(ReferenceRead(location=SPEC_URL))
        assert saved.reference_span is not None
        self.assertEqual(saved.reference_span.offset, 50)
        self.assertEqual(saved.reference_span.total_chars, 100)
        original = self.reader.read_reference.return_value
        for updates in (
            {"offset": 51}, {"anchor_offset": None},
            {"anchor_offset": 49}, {"anchor_offset": 101},
        ):
            self.reader.read_reference.return_value = original.model_copy(update=updates)
            with self.subTest(updates=updates), self.assertRaises(ValueError):
                await self.research.read_reference(ReferenceRead(location=SPEC_URL))

    async def test_research_result_must_be_saved_before_it_can_support_a_claim(self):
        controller = inputs()
        self.reader.read_reference.return_value = RetrievedReference(
            location=SPEC_URL, section="Variable annotations", content="checked against its declared type",
            offset=0, anchor_offset=0, total_chars=33, retrieved_at="2026-10-22T22:00:00Z",
        )
        capability = AsyncMock()

        async def read_and_assess(*args, **kwargs):
            self.assertIn("Reference capability: bounded read_reference is exposed.", args[0])
            retrieved = await kwargs["research"].read_reference(ReferenceRead(location=SPEC_URL))
            result = assessment(controller).model_dump()
            result["claims"][0]["rules"][0]["evidence_id"] = retrieved.id
            return json.dumps(result)

        capability.run.side_effect = read_and_assess
        result = await assess_validity(controller, capability, self.research, budget_seconds=1)
        self.assertEqual(result.claims[0].rules[0].evidence_id, "validity-reference-1")
        with self.assertRaises(ValueError):
            validate_validity_response(controller, result)

    async def test_input_mutation_is_rejected_even_when_response_matches_original_hash(self):
        controller = inputs()
        capability = AsyncMock()

        async def mutate(*args, **kwargs):
            result = assessment(controller).model_dump_json()
            controller.report_text = "Mutated report"
            return result
        capability.run.side_effect = mutate
        with self.assertRaisesRegex(ValueError, "mutated"):
            await assess_validity(controller, capability, budget_seconds=1)


if __name__ == "__main__":
    unittest.main()
