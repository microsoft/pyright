import * as assert from 'assert';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { ConstraintTracker } from '../analyzer/constraintTracker';
import { assignClassToProtocol, tryFastRejectSequenceProtocol } from '../analyzer/protocols';
import { AssignTypeFlags } from '../analyzer/typeEvaluatorTypes';
import { ClassType, isClassInstance, isFunction, isTypeVar } from '../analyzer/types';
import { makeTypeVarsFree } from '../analyzer/typeUtils';
import { DiagnosticAddendum } from '../common/diagnostic';
import { ParseNodeType } from '../parser/parseNodes';
import { getNodeAtMarker, parseAndGetTestState } from './harness/fourslash/testState';

const cases = ['serialize', 'read', '__array__'].flatMap((member) =>
    ['missing', 'leaf', 'sequence'].flatMap((capability) =>
        ['shortcut', 'cold', 'diagnostic'].map((mode) => ({ member, capability, mode }))
    )
);

cases.push(...['shortcut', 'cold', 'diagnostic'].map((mode) => ({ member: '__call__', capability: 'callback', mode })));

test.each(cases)('ProtocolRequirementGeneral $member $capability $mode', ({ member, capability, mode }) => {
    let typesStub = readFileSync(resolve(__dirname, '../../typeshed-fallback/stdlib/types.pyi'), 'utf8');
    assert.ok(typesStub.includes('class FunctionType:'));
    if (capability === 'leaf') {
        typesStub = typesStub.replace(
            'class FunctionType:',
            `class FunctionType:\n    def ${member}(self) -> int: ...`
        );
    } else if (capability === 'sequence') {
        typesStub = typesStub.replace(
            'class FunctionType:',
            'class FunctionType:\n    def __len__(self) -> int: ...\n' +
                '    def __getitem__(self, index: int, /) -> Any: ...\n' +
                '    def __iter__(self) -> Iterator[Any]: ...'
        );
    }
    const state = parseAndGetTestState(`
// @filename: /typeshed-fallback/stdlib/types.pyi
${typesStub
    .split('\n')
    .map((line) => `//// ${line}`)
    .join('\n')}
// @filename: test.py
//// from collections.abc import Iterator
//// from typing import Protocol, TypeVar
//// T_co = TypeVar("T_co", covariant=True)
//// class Leaf(Protocol[T_co]):
////     def ${member}(self) -> T_co: ...
//// class NestedSequence(Protocol[T_co]):
////     def __len__(self, /) -> int: ...
////     def __getitem__(self, index: int, /) -> T_co | "NestedSequence[T_co]": ...
////     def __iter__(self, /) -> Iterator[T_co | "NestedSequence[T_co]"]: ...
//// def operation() -> int:
////     return 1
//// def check[T](variable: T, destination: NestedSequence[Leaf[T]]):
////     /*operation*/operation
////     /*source*/[operation]
////     /*destination*/destination
////     /*variable*/variable
    `).state;
    const evaluator = state.program.evaluator!;
    const sourceNode = getNodeAtMarker(state, 'source');
    const destinationNode = getNodeAtMarker(state, 'destination');
    const operationNode = getNodeAtMarker(state, 'operation');
    const variableNode = getNodeAtMarker(state, 'variable');
    assert.strictEqual(sourceNode.nodeType, ParseNodeType.List);
    assert.strictEqual(destinationNode.nodeType, ParseNodeType.Name);
    assert.strictEqual(operationNode.nodeType, ParseNodeType.Name);
    assert.strictEqual(variableNode.nodeType, ParseNodeType.Name);
    const source = evaluator.getTypeOfExpression(sourceNode).type;
    const destination = evaluator.getTypeOfExpression(destinationNode).type;
    const operation = evaluator.getTypeOfExpression(operationNode).type;
    const variable = evaluator.getTypeOfExpression(variableNode).type;
    assert.ok(isClassInstance(source));
    assert.ok(isClassInstance(destination));
    assert.ok(isFunction(operation));
    assert.ok(isTypeVar(variable));
    const freeVariable = variable.priv.freeTypeVar;
    assert.ok(freeVariable?.priv.scopeId);
    const target = makeTypeVarsFree(ClassType.cloneAsInstantiable(destination), [freeVariable.priv.scopeId]);
    const sourceType = ClassType.specialize(source, [operation]);
    const constraints = new ConstraintTracker();
    constraints.getMainConstraintSet().addScopeId('caller');
    if (mode === 'shortcut') {
        assert.strictEqual(
            tryFastRejectSequenceProtocol(evaluator, target, sourceType, constraints, AssignTypeFlags.Default, 0),
            capability === 'missing' ? '__getitem__' : undefined
        );
    } else {
        assert.strictEqual(
            assignClassToProtocol(
                evaluator,
                target,
                sourceType,
                mode === 'diagnostic' ? new DiagnosticAddendum() : undefined,
                constraints,
                AssignTypeFlags.Default,
                0
            ),
            capability !== 'missing'
        );
        if (capability === 'leaf' || capability === 'callback') {
            assert.strictEqual(
                evaluator.printType(evaluator.solveAndApplyConstraints(freeVariable, constraints)),
                'int'
            );
        }
    }
    if (mode === 'shortcut' || capability === 'missing') {
        expect(
            constraints
                .getConstraintSets()
                .map((set) => ({ scopes: [...set.getScopeIds()], bindings: set.getTypeVars() }))
        ).toEqual([{ scopes: ['caller'], bindings: [] }]);
    }
});
