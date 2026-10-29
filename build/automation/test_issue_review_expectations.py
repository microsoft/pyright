# Copyright (c) Microsoft Corporation.
# Licensed under the MIT license.

import json
import tempfile
import unittest
from pathlib import Path

from pydantic import ValidationError

from evaluate_issue_design import validate_findings
from issue_review_models import Adjudication, Audit, Entry
from review_issues import (
    AutomationError, ChunkResult, claim_evidence_summary, dry_run_proposal, save_overnight_report,
)
from test_evaluate_issue_design import blind_findings
from test_review_issues import audit, issue, no_duplicates, product_record


def bug_data() -> dict:
    data = audit().model_dump(mode="json")
    data["claims"][0]["disposition"] = "bug"
    return data


def intent_data(basis: str = "maintainer_decision") -> dict:
    data = bug_data()
    location = {
        "maintainer_decision": "https://github.com/microsoft/pyright/issues/123#issuecomment-1",
        "documented_contract": "docs\\type-concepts-advanced.md",
        "regression_test": "packages\\pyright-internal\\src\\tests\\samples\\sample.py",
    }[basis]
    data["sources"][0].update(
        kind="maintainer_decision" if basis == "maintainer_decision" else "repository",
        location=location, finding="This behavior is supported.",
        applicability="The accepted decision applies to this exact scope; it predates the reported regression.",
    )
    data["claims"][0]["expectation"].update(
        kind="intended_behavior", reason="The accepted contract establishes the expectation",
        evidence=[{
            "source_id": "spec", "authority": "accepted_policy", "intent_basis": basis,
            "excerpt": "This behavior is supported.",
            "application": "This example meets the accepted contract's settings, version and scope premises.",
        }],
    )
    return data


class ExpectationTests(unittest.TestCase):
    def test_requirements_and_established_intent_are_distinct_supported_bug_bases(self):
        requirement = Audit.model_validate(bug_data())
        self.assertTrue(requirement.observed_bug())
        for basis in ("maintainer_decision", "documented_contract", "regression_test"):
            with self.subTest(basis=basis):
                intended = Audit.model_validate(intent_data(basis))
                self.assertTrue(intended.observed_bug())
                self.assertTrue(intended.resolved_claims())
                assert intended.claims[0].expectation is not None
                self.assertEqual(intended.claims[0].expectation.kind, "intended_behavior")
                self.assertEqual(
                    Audit.model_validate_json(intended.model_dump_json()).sources[0].applicability,
                    intended.sources[0].applicability,
                )

    def test_extra_coverage_is_not_a_bug_even_at_high_confidence_with_observed_product(self):
        data = bug_data()
        claim = data["claims"][0]
        claim["disposition"] = "enhancement"
        claim["expectation"].update(
            kind="additional_analysis", reason="The useful extra analysis has no established requirement",
            evidence=[],
        )
        report = Audit.model_validate(data)
        self.assertTrue(report.observed_product())
        self.assertFalse(report.observed_bug())
        self.assertFalse(report.closure_candidate())
        self.assertFalse(report.resolved_claims())
        for disposition in ("bug", "specification_correct", "intentional_limitation"):
            claim["disposition"] = disposition
            with self.subTest(disposition=disposition), self.assertRaises(ValidationError):
                Audit.model_validate(data)

    def test_parity_proposals_labels_and_current_implementation_are_not_authority(self):
        for authority, kind, location in (
            ("comparison", "checker_comparison", "mypy 1.18"),
            ("proposal", "maintainer_decision", "https://github.com/microsoft/pyright/pull/456"),
            ("behavior_only", "repository", "packages\\pyright-internal\\src\\analyzer\\typeEvaluator.ts"),
            ("behavior_only", "reporter", "An issue label"),
        ):
            data = bug_data()
            data["sources"][0].update(kind=kind, location=location)
            data["claims"][0]["expectation"]["evidence"][0]["authority"] = authority
            for category in ("mandatory_rule", "intended_behavior"):
                data["claims"][0]["expectation"]["kind"] = category
                with self.subTest(authority=authority, category=category), self.assertRaises(ValidationError):
                    Audit.model_validate(data)

    def test_accepted_intent_needs_its_actual_decision_documentation_or_test(self):
        for mutation in ("no_basis", "implementation", "wrong_kind", "invented_excerpt", "other_claim"):
            data = intent_data("documented_contract")
            support = data["claims"][0]["expectation"]["evidence"][0]
            if mutation == "no_basis":
                support["intent_basis"] = None
            elif mutation == "implementation":
                data["sources"][0]["location"] = "packages\\pyright-internal\\src\\analyzer\\typeEvaluator.ts"
            elif mutation == "wrong_kind":
                data["sources"][0]["kind"] = "reporter"
            elif mutation == "invented_excerpt":
                support["excerpt"] = "Invented policy"
            else:
                data["claims"][0]["source_ids"] = []
            with self.subTest(mutation=mutation), self.assertRaises(ValidationError):
                Audit.model_validate(data)

    def test_runtime_documentation_cannot_be_relabelled_as_a_typing_requirement(self):
        data = bug_data()
        data["sources"][0]["kind"] = "python_docs"
        with self.assertRaisesRegex(ValidationError, "authority does not match"):
            Audit.model_validate(data)
        support = data["claims"][0]["expectation"]["evidence"][0]
        support["authority"] = "language_requirement"
        support["application"] = "The exact Python language rule applies; static typing must be assessed separately."
        self.assertTrue(Audit.model_validate(data).observed_bug())

    def test_missing_spec_example_preserves_unsettled_asymmetry_without_forcing_design(self):
        data = bug_data()
        claim = data["claims"][0]
        claim.update(
            disposition="inconclusive",
            basis="The asymmetry is observed; composition of the rule's premises for the reversed spelling is unsettled.",
            counterevidence="Equivalent runtime behavior alone does not establish a static mandate.",
        )
        claim["expectation"].update(
            kind="unresolved", reason="Need the applicable rule's missing premise or accepted intended-behavior contract",
            evidence=[],
        )
        report = Audit.model_validate(data)
        self.assertTrue(report.observed_product())
        self.assertFalse(report.observed_bug())
        self.assertFalse(report.closure_candidate())
        self.assertIn("missing premise", claim_evidence_summary(report))
        self.assertIn(claim["counterevidence"], claim_evidence_summary(report))

    def test_core_bug_survives_ancillary_uncertainty_but_cannot_close_a_duplicate(self):
        data = bug_data()
        ancillary = json.loads(json.dumps(data["claims"][0]))
        ancillary.update(id="history", disposition="inconclusive", confidence="low")
        ancillary["expectation"].update(kind="unresolved", reason="Historical setup is missing", evidence=[])
        for target in ancillary["reproduction"]:
            target.update(status="blocked", check_ids=[])
        data["claims"].append(ancillary)
        report = Audit.model_validate(data)
        result = Adjudication(
            issue_number=123, report_hash="hash", validity="bug", duplicate_status="no dupe found",
            duplicate_of=None, rationale="The core requirement fails; historical and ancillary claims remain open.",
        )
        result.validate_reports(report, no_duplicates())
        self.assertTrue(report.observed_bug())
        self.assertFalse(report.resolved_claims())
        self.assertFalse(report.closure_candidate())
        entry = Entry(
            input_hash="input", context_hash="context", issue=issue(), review=report,
            duplicates=no_duplicates(), adjudication=result,
        )
        self.assertIsNone(entry.closure_reason())
        result.validity = "by design"
        with self.assertRaises(ValueError):
            result.validate_reports(report, no_duplicates())

    def test_legacy_record_is_readable_unupgraded_and_fails_fresh_review_gate(self):
        data = bug_data()
        del data["claims"][0]["expectation"]
        report = Audit.model_validate(data)
        self.assertIsNone(report.claims[0].expectation)
        self.assertFalse(report.observed_bug())
        self.assertFalse(report.resolved_claims())
        self.assertIn("not recorded", claim_evidence_summary(report))
        with self.assertRaisesRegex(ValueError, "Fresh reviews require"):
            report.require_expectations()
        result = Adjudication(
            issue_number=123, report_hash="saved-old-hash", validity="bug", duplicate_status="no dupe found",
            duplicate_of=None, rationale="Historical saved classification",
        )
        entry = Entry(
            input_hash="input", context_hash="context", issue=issue(), review=report,
            duplicates=no_duplicates(), adjudication=result,
        )
        loaded = Entry.model_validate_json(entry.model_dump_json())
        assert loaded.adjudication is not None
        self.assertEqual(loaded.adjudication.report_hash, "saved-old-hash")
        self.assertIsNone(loaded.closure_reason())
        proposal = dry_run_proposal(ChunkResult(issue(), loaded), rca_enabled=False)
        self.assertEqual(proposal["validity"], "bug")
        self.assertFalse(proposal["supported_bug"])
        self.assertEqual(proposal["proposed_action"], "leave_open")
        blockers = proposal["blocking_reasons"]
        assert isinstance(blockers, list)
        self.assertTrue(any(isinstance(reason, str) and "not upgraded" in reason for reason in blockers))
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            save_overnight_report(directory, "new-report-only", [issue()], [ChunkResult(issue(), loaded)],
                                  read_only=True, finished=True)
            summary = json.loads((directory / "overnight-report.json").read_text(encoding="utf-8"))
            self.assertEqual(summary["counts"]["keep_open_bug"], 0)
            self.assertEqual(summary["claim_expectation_counts"]["not_recorded"], 1)
            self.assertIn("not recorded", (directory / "overnight-report.md").read_text(encoding="utf-8"))

    def test_fresh_null_and_absent_expectations_fail_even_for_an_unresolved_verdict(self):
        for explicit_null in (False, True):
            findings = blind_findings(verdict="needs investigation")
            findings.claims[0].expectation = None
            data = findings.model_dump(mode="json")
            if not explicit_null:
                del data["claims"][0]["expectation"]
            loaded = type(findings).model_validate(data)
            with self.subTest(explicit_null=explicit_null), self.assertRaisesRegex(ValueError, "Fresh reviews require"):
                validate_findings(loaded, [])

    def test_legacy_design_expectations_are_readable_but_cannot_support_a_new_closure(self):
        data = audit().model_dump(mode="json")
        del data["claims"][0]["expectation"]
        report = Audit.model_validate(data)
        with self.subTest(gate="design"):
            self.assertFalse(report.design_claims_supported())
        with self.subTest(gate="resolved"):
            self.assertFalse(report.resolved_claims())
        entry = Entry(
            input_hash="input", context_hash="context", issue=issue(), review=report,
            duplicates=no_duplicates(), adjudication=Adjudication(
                issue_number=123, report_hash="saved-old-hash", validity="by design",
                duplicate_status="no dupe found", duplicate_of=None, rationale="Saved historical classification",
            ),
        )
        loaded = Entry.model_validate_json(entry.model_dump_json())
        with self.subTest(gate="closure"):
            self.assertIsNone(loaded.closure_reason())

    def test_legacy_ancillary_design_does_not_resolve_a_supported_core_bug(self):
        data = bug_data()
        ancillary = json.loads(json.dumps(data["claims"][0]))
        ancillary.update(id="legacy-design", disposition="intentional_limitation")
        del ancillary["expectation"]
        data["claims"].append(ancillary)
        report = Audit.model_validate(data)
        self.assertTrue(report.observed_bug())
        self.assertFalse(report.resolved_claims())

    def test_overall_blind_bug_verdict_cannot_promote_an_enhancement(self):
        findings = blind_findings(verdict="bug")
        claim = findings.claims[0]
        claim.disposition = "enhancement"
        assert claim.expectation is not None
        claim.expectation.kind = "additional_analysis"
        claim.expectation.evidence = []
        with self.assertRaisesRegex(AutomationError, "mandatory-rule or intended-behavior"):
            validate_findings(findings, [product_record(audit())])


if __name__ == "__main__":
    unittest.main()
