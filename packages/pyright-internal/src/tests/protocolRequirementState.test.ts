import * as assert from 'assert';

import { ConstraintTracker } from '../analyzer/constraintTracker';
import { assignClassToProtocol, tryFastRejectSequenceProtocol } from '../analyzer/protocols';
import { AssignTypeFlags } from '../analyzer/typeEvaluatorTypes';
import { ClassType, isClassInstance, isTypeVar } from '../analyzer/types';
import { makeTypeVarsFree } from '../analyzer/typeUtils';
import { DiagnosticAddendum } from '../common/diagnostic';
import { ParseNodeType } from '../parser/parseNodes';
import { getNodeAtMarker, parseAndGetTestState } from './harness/fourslash/testState';

const cases = ['Plain', 'Plain | Callable[[], int]'].flatMap((element) =>
    ['serialize', 'read'].flatMap((member) =>
        [false, true].flatMap((concrete) =>
            ['empty', 'literal', 'integer', 'none'].map((seed) => ({ element, member, concrete, seed }))
        )
    )
);

test.each(cases)(
    'ProtocolRequirementState $element $member concrete=$concrete seed=$seed',
    ({ element, member, concrete, seed }) => {
        const run = (diagnostics: boolean) => {
            const state = parseAndGetTestState(`
// @filename: test.py
//// from collections.abc import Callable, Iterator
//// from typing import Literal, Protocol, TypeVar
//// T_co = TypeVar("T_co", covariant=True)
//// class Leaf(Protocol[T_co]):
////     def ${member}(self) -> T_co: ...
//// class NestedSequence(Protocol[T_co]):
////     def __len__(self, /) -> int: ...
${member === 'read' ? '////     def __iter__(self, /) -> Iterator[T_co | "NestedSequence[T_co]"]: ...' : ''}
////     def __getitem__(self, index: int, /) -> T_co | "NestedSequence[T_co]": ...
${member === 'serialize' ? '////     def __iter__(self, /) -> Iterator[T_co | "NestedSequence[T_co]"]: ...' : ''}
//// class Plain: pass
//// def check[T](source: list[${element}], rejected: NestedSequence[Leaf[${
                concrete ? 'int' : 'T'
            }]], accepted: NestedSequence[${element}], variable: T, literal: Literal[7], other: Literal[8], integer: int, text: str, container: list[T]):
////     /*source*/source
////     /*rejected*/rejected
////     /*accepted*/accepted
////     /*variable*/variable
////     /*literal*/literal
////     /*other*/other
////     /*integer*/integer
////     /*text*/text
////     /*container*/container
            `).state;
            const evaluator = state.program.evaluator!;
            const typeAt = (marker: string) => {
                const node = getNodeAtMarker(state, marker);
                assert.strictEqual(node.nodeType, ParseNodeType.Name);
                return evaluator.getTypeOfExpression(node).type;
            };
            const source = typeAt('source');
            const rejected = typeAt('rejected');
            const accepted = typeAt('accepted');
            const variable = typeAt('variable');
            assert.ok(isClassInstance(source) && isClassInstance(rejected) && isClassInstance(accepted));
            assert.ok(isTypeVar(variable));
            const freeVariable = variable.priv.freeTypeVar;
            assert.ok(freeVariable?.priv.scopeId);
            const scopes = [freeVariable.priv.scopeId];
            const target = makeTypeVarsFree(ClassType.cloneAsInstantiable(rejected), scopes);
            const container = makeTypeVarsFree(typeAt('container'), scopes);
            const initial = new ConstraintTracker();
            if (seed !== 'empty') {
                initial.setBounds(freeVariable, typeAt('literal'), seed === 'none' ? undefined : typeAt(seed), false);
            }
            initial.getMainConstraintSet().addScopeId('caller');
            const observe = (tracker: ConstraintTracker) => ({
                solved: evaluator.printType(evaluator.solveAndApplyConstraints(freeVariable, tracker)),
                nested: evaluator.printType(evaluator.solveAndApplyConstraints(container, tracker)),
                score: tracker.getScore(),
                sets: tracker.getConstraintSets().map((set) => ({
                    scopes: [...set.getScopeIds()],
                    bounds: set.getTypeVars().map((entry) => ({
                        variable: evaluator.printType(entry.typeVar),
                        lower: entry.lowerBound && evaluator.printType(entry.lowerBound),
                        upper: entry.upperBound && evaluator.printType(entry.upperBound),
                        retain: entry.retainLiterals,
                    })),
                })),
            });
            const before = observe(initial);
            const sourceBefore = evaluator.printType(source);
            const eligible = concrete || seed === 'empty';
            assert.strictEqual(
                tryFastRejectSequenceProtocol(evaluator, target, source, initial, AssignTypeFlags.Default, 0),
                eligible ? '__getitem__' : undefined
            );
            assert.deepStrictEqual(observe(initial), before);
            const results = [];
            for (const matchFlags of [AssignTypeFlags.Default, AssignTypeFlags.RetainLiteralsForTypeVar]) {
                const constraints = initial.clone();
                for (let repetition = 0; repetition < 2; repetition++) {
                    assert.strictEqual(
                        assignClassToProtocol(
                            evaluator,
                            target,
                            source,
                            diagnostics ? new DiagnosticAddendum() : undefined,
                            constraints,
                            matchFlags,
                            0
                        ),
                        false
                    );
                    if (eligible) {
                        assert.deepStrictEqual(observe(constraints), before);
                    } else {
                        assert.strictEqual(observe(constraints).solved, seed === 'literal' ? 'Literal[7]' : 'int');
                    }
                    results.push(observe(constraints));
                }
                for (const flags of [
                    AssignTypeFlags.Default,
                    AssignTypeFlags.Invariant,
                    AssignTypeFlags.Contravariant,
                ]) {
                    for (const transfer of ['clone', 'signature', 'copy']) {
                        const parentBefore = observe(constraints);
                        const continued =
                            transfer === 'signature' ? constraints.cloneWithSignature('caller') : constraints.clone();
                        if (transfer === 'copy') {
                            continued.copyFromClone(constraints);
                        }
                        for (const marker of ['literal', 'other', 'integer', 'text']) {
                            results.push({
                                assigned: evaluator.assignType(
                                    freeVariable,
                                    typeAt(marker),
                                    undefined,
                                    continued,
                                    flags
                                ),
                                observation: observe(continued),
                                parent: observe(constraints),
                            });
                        }
                        assert.deepStrictEqual(observe(initial), before);
                        if (transfer === 'signature') {
                            assert.strictEqual(continued.getMainConstraintSet(), constraints.getMainConstraintSet());
                            assert.deepStrictEqual(observe(constraints), observe(continued));
                        } else {
                            assert.notStrictEqual(continued.getMainConstraintSet(), constraints.getMainConstraintSet());
                            assert.deepStrictEqual(observe(constraints), parentBefore);
                        }
                    }
                }
                assert.strictEqual(
                    assignClassToProtocol(
                        evaluator,
                        ClassType.cloneAsInstantiable(accepted),
                        source,
                        undefined,
                        constraints,
                        AssignTypeFlags.Default,
                        0
                    ),
                    true
                );
                results.push(observe(constraints));
                assert.strictEqual(evaluator.printType(source), sourceBefore);
            }
            return results;
        };
        assert.deepStrictEqual(run(false), run(true));
    }
);
