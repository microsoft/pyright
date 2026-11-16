import * as assert from 'assert';

import { ConstraintSet, ConstraintTracker } from '../analyzer/constraintTracker';
import { assignClassToProtocol } from '../analyzer/protocols';
import { AssignTypeFlags } from '../analyzer/typeEvaluatorTypes';
import { ClassType, combineTypes, isClassInstance, isFunctionOrOverloaded } from '../analyzer/types';
import { ParseNodeType } from '../parser/parseNodes';
import { getNodeAtMarker, parseAndGetTestState } from './harness/fourslash/testState';
import * as TestUtils from './testUtils';

test.each([2, 4, 8, 16])('ProtocolRequirementComplexity overloads=%s', (overloadCount) => {
    const declarations = (name: string, count: number) =>
        Array.from(
            { length: count },
            (_, index) => `//// @overload\n//// def ${name}[T](value: T, tag: Literal[${index}]) -> T: ...`
        ).join('\n') + `\n//// def ${name}(value, tag): return value`;
    const state = parseAndGetTestState(`
// @filename: test.py
//// from collections.abc import Iterator
//// from typing import Literal, Protocol, TypeVar, overload
//// T_co = TypeVar("T_co", covariant=True)
//// class Leaf(Protocol[T_co]):
////     def serialize(self) -> T_co: ...
//// class NestedSequence(Protocol[T_co]):
////     def __len__(self, /) -> int: ...
////     def __getitem__(self, index: int, /) -> T_co | "NestedSequence[T_co]": ...
////     def __iter__(self, /) -> Iterator[T_co | "NestedSequence[T_co]"]: ...
${declarations('first', overloadCount)}
${declarations('second', overloadCount + 1)}
//// def check(source: list[object], destination: NestedSequence[Leaf[int]]):
////     /*first*/first
////     /*second*/second
////     /*source*/source
////     /*destination*/destination
    `).state;
    const evaluator = state.program.evaluator!;
    const typeAt = (marker: string) => {
        const node = getNodeAtMarker(state, marker);
        assert.strictEqual(node.nodeType, ParseNodeType.Name);
        return evaluator.getTypeOfExpression(node).type;
    };
    const source = typeAt('source');
    const destination = typeAt('destination');
    const first = typeAt('first');
    const second = typeAt('second');
    assert.ok(isClassInstance(source) && isClassInstance(destination));
    assert.ok(isFunctionOrOverloaded(first) && isFunctionOrOverloaded(second));
    const sourceType = ClassType.specialize(source, [combineTypes([first, second])]);
    const originalType = evaluator.printType(sourceType);
    assert.ok(originalType.includes('Overload['));
    const constraints = new ConstraintTracker();
    constraints.getMainConstraintSet().addScopeId('caller');
    const originalClone = ConstraintSet.prototype.clone;
    let clones = 0;
    const spy = jest.spyOn(ConstraintSet.prototype, 'clone').mockImplementation(function (this: ConstraintSet) {
        clones++;
        assert.ok(clones <= 64, `overloads=${overloadCount}: exceeded 64 constraint-set clones`);
        return originalClone.call(this);
    });
    try {
        assert.strictEqual(
            assignClassToProtocol(
                evaluator,
                ClassType.cloneAsInstantiable(destination),
                sourceType,
                undefined,
                constraints,
                AssignTypeFlags.Default,
                0
            ),
            false
        );
        assert.ok(clones > 0, 'The work counter must observe the assignment');
        assert.deepStrictEqual(
            constraints
                .getConstraintSets()
                .map((set) => ({ scopes: [...set.getScopeIds()], bounds: set.getTypeVars() })),
            [{ scopes: ['caller'], bounds: [] }]
        );
        assert.strictEqual(evaluator.printType(sourceType), originalType);
    } finally {
        spy.mockRestore();
    }
});

test('ProtocolRequirementComplexityPreservesOverloadSelection', () => {
    const results = TestUtils.typeAnalyzeSampleFiles(['protocolRequirementOverloads.py']);
    TestUtils.validateResults(results, 0);
});

describe.each([2, 4, 6])('ProtocolRequirementComplexity depth=%s', (depth) => {
    test.each([2, 3])('members=%s', (memberCount) => {
        for (const compatible of [true, false]) {
            const declarations = (prefix: string, protocol: boolean) =>
                Array.from({ length: depth }, (_, level) => {
                    const next = `${prefix}${(level + 1) % depth}`;
                    const members = Array.from(
                        { length: memberCount },
                        (_, member) => `////     def member${member}(self) -> "${next}": ...`
                    ).join('\n');
                    const leaf = protocol || compatible ? 'int' : 'str';
                    return (
                        `//// class ${prefix}${level}${protocol ? '(Protocol)' : ''}:\n${members}` +
                        (level === depth - 1 ? `\n////     def value(self) -> ${leaf}: ...` : '')
                    );
                }).join('\n');
            const state = parseAndGetTestState(`
// @filename: test.py
//// from typing import Protocol
${declarations('Target', true)}
${declarations('Source', false)}
//// def check(source: Source0, destination: Target0):
////     /*source*/source
////     /*destination*/destination
            `).state;
            const evaluator = state.program.evaluator!;
            const typeAt = (marker: string) => {
                const node = getNodeAtMarker(state, marker);
                assert.strictEqual(node.nodeType, ParseNodeType.Name);
                return evaluator.getTypeOfExpression(node).type;
            };
            const source = typeAt('source');
            const destination = typeAt('destination');
            assert.ok(isClassInstance(source) && isClassInstance(destination));
            const sourceBefore = evaluator.printType(source);
            const constraints = new ConstraintTracker();
            constraints.getMainConstraintSet().addScopeId('caller');
            const originalLookup = evaluator.getDeclaredTypeOfSymbol;
            const budget = 32 * depth * memberCount;
            let lookups = 0;
            const spy = jest.spyOn(evaluator, 'getDeclaredTypeOfSymbol').mockImplementation((...args) => {
                lookups++;
                assert.ok(
                    lookups <= budget,
                    `depth=${depth}, members=${memberCount}, compatible=${compatible}: exceeded ${budget} member lookups`
                );
                return originalLookup(...args);
            });
            try {
                for (let repetition = 0; repetition < 2; repetition++) {
                    assert.strictEqual(
                        assignClassToProtocol(
                            evaluator,
                            ClassType.cloneAsInstantiable(destination),
                            source,
                            undefined,
                            constraints,
                            AssignTypeFlags.Default,
                            0
                        ),
                        compatible
                    );
                    assert.strictEqual(evaluator.printType(source), sourceBefore);
                    assert.deepStrictEqual(
                        constraints.getConstraintSets().map((set) => ({
                            scopes: [...set.getScopeIds()],
                            bounds: set.getTypeVars(),
                        })),
                        [{ scopes: ['caller'], bounds: [] }]
                    );
                }
                assert.ok(lookups >= depth * memberCount, 'The work counter must observe the recursive walk');
            } finally {
                spy.mockRestore();
            }
        }
    });
});
