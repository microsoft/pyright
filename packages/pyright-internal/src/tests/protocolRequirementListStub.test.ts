import * as assert from 'assert';
import { readFileSync } from 'fs';
import { resolve } from 'path';

import { ConstraintTracker } from '../analyzer/constraintTracker';
import { assignClassToProtocol, tryFastRejectSequenceProtocol } from '../analyzer/protocols';
import { AssignTypeFlags } from '../analyzer/typeEvaluatorTypes';
import { ClassType, isClassInstance, isTypeVar } from '../analyzer/types';
import { makeTypeVarsFree } from '../analyzer/typeUtils';
import { DiagnosticAddendum } from '../common/diagnostic';
import { ParseNodeType } from '../parser/parseNodes';
import { getNodeAtMarker, parseAndGetTestState } from './harness/fourslash/testState';

test.each([
    [false, false],
    [false, true],
    [true, false],
    [true, true],
])('ProtocolRequirementListStub erased=%s diagnostics=%s', (erased, diagnostics) => {
    let builtinsStub = readFileSync(resolve(__dirname, '../../typeshed-fallback/stdlib/builtins.pyi'), 'utf8');
    if (erased) {
        const listStart = builtinsStub.indexOf('class list(MutableSequence[_T]):');
        assert.ok(listStart >= 0);
        const listEnd = builtinsStub.indexOf('\nclass ', listStart + 1);
        assert.ok(listEnd > listStart);
        const listStub = builtinsStub.slice(listStart, listEnd);
        const indexSignature = 'def __getitem__(self, i: SupportsIndex, /) -> _T:';
        const iteratorSignature = 'def __iter__(self) -> Iterator[_T]:';
        assert.ok(listStub.includes(indexSignature));
        assert.ok(listStub.includes(iteratorSignature));
        builtinsStub =
            builtinsStub.slice(0, listStart) +
            listStub
                .replace(indexSignature, 'def __getitem__(self, i: SupportsIndex, /) -> Any:')
                .replace(iteratorSignature, 'def __iter__(self) -> Iterator[Any]:') +
            builtinsStub.slice(listEnd);
    }
    const state = parseAndGetTestState(`
// @filename: /typeshed-fallback/stdlib/builtins.pyi
${builtinsStub
    .split('\n')
    .map((line) => `//// ${line}`)
    .join('\n')}
// @filename: test.py
//// from collections.abc import Callable, Iterator
//// from typing import Protocol, TypeVar
//// T_co = TypeVar("T_co", covariant=True)
//// class Leaf(Protocol[T_co]):
////     def serialize(self) -> T_co: ...
//// class NestedSequence(Protocol[T_co]):
////     def __len__(self, /) -> int: ...
////     def __getitem__(self, index: int, /) -> T_co | "NestedSequence[T_co]": ...
////     def __iter__(self, /) -> Iterator[T_co | "NestedSequence[T_co]"]: ...
//// def check[T](source: list[Callable[[], int]], destination: NestedSequence[Leaf[T]], variable: T):
////     element = source[0]
////     /*element*/element
////     /*source*/source
////     /*destination*/destination
////     /*variable*/variable
    `).state;
    const evaluator = state.program.evaluator!;
    const sourceNode = getNodeAtMarker(state, 'source');
    const destinationNode = getNodeAtMarker(state, 'destination');
    const variableNode = getNodeAtMarker(state, 'variable');
    const elementNode = getNodeAtMarker(state, 'element');
    assert.strictEqual(sourceNode.nodeType, ParseNodeType.Name);
    assert.strictEqual(destinationNode.nodeType, ParseNodeType.Name);
    assert.strictEqual(variableNode.nodeType, ParseNodeType.Name);
    assert.strictEqual(elementNode.nodeType, ParseNodeType.Name);
    const source = evaluator.getTypeOfExpression(sourceNode).type;
    const destination = evaluator.getTypeOfExpression(destinationNode).type;
    const variable = evaluator.getTypeOfExpression(variableNode).type;
    assert.ok(isClassInstance(source));
    assert.ok(isClassInstance(destination));
    assert.ok(isTypeVar(variable));
    assert.strictEqual(
        evaluator.printType(evaluator.getTypeOfExpression(elementNode).type),
        erased ? 'Any' : '() -> int'
    );
    const freeVariable = variable.priv.freeTypeVar;
    assert.ok(freeVariable?.priv.scopeId);
    const target = makeTypeVarsFree(ClassType.cloneAsInstantiable(destination), [freeVariable.priv.scopeId]);
    assert.strictEqual(
        assignClassToProtocol(
            evaluator,
            target,
            source,
            diagnostics ? new DiagnosticAddendum() : undefined,
            new ConstraintTracker(),
            AssignTypeFlags.Default,
            0
        ),
        erased
    );
});

test.each([false, true].flatMap((overlap) => ['Leaf[int]', 'int'].map((element) => ({ overlap, element }))))(
    'ProtocolRequirementIndexOverlap overlap=$overlap element=$element',
    ({ overlap, element }) => {
        let builtinsStub = readFileSync(resolve(__dirname, '../../typeshed-fallback/stdlib/builtins.pyi'), 'utf8');
        if (overlap) {
            const intDeclaration = '@disjoint_base\nclass int:';
            assert.ok(builtinsStub.includes(intDeclaration));
            builtinsStub = builtinsStub.replace(intDeclaration, 'class int(slice[Any]):');
        }
        const listStart = builtinsStub.indexOf('class list(MutableSequence[_T]):');
        const listEnd = builtinsStub.indexOf('\nclass ', listStart + 1);
        assert.ok(listStart >= 0 && listEnd > listStart);
        const listStub = builtinsStub.slice(listStart, listEnd);
        const sliceSignature = 'def __getitem__(self, s: slice[SupportsIndex | None], /) -> list[_T]:';
        assert.ok(listStub.includes(sliceSignature));
        builtinsStub =
            builtinsStub.slice(0, listStart) +
            listStub.replace(sliceSignature, sliceSignature.replace('-> list[_T]', '-> Any')) +
            builtinsStub.slice(listEnd);
        const state = parseAndGetTestState(`
// @filename: /typeshed-fallback/stdlib/builtins.pyi
${builtinsStub
    .split('\n')
    .map((line) => `//// ${line}`)
    .join('\n')}
// @filename: test.py
//// from collections.abc import Callable, Iterator
//// from typing import Any, Protocol, TypeVar
//// T_co = TypeVar("T_co", covariant=True)
//// class Leaf(Protocol[T_co]):
////     def serialize(self) -> T_co: ...
//// class NestedSequence(Protocol[T_co]):
////     def __len__(self, /) -> int: ...
////     def __getitem__(self, index: int, /) -> T_co | "NestedSequence[T_co]": ...
////     def __iter__(self, /) -> Iterator[T_co | "NestedSequence[T_co]"]: ...
//// def check(source: list[Callable[[], int]], destination: NestedSequence[${element}], integer: int, sliced: slice[Any]):
////     source_index = source.__getitem__
////     destination_index = destination.__getitem__
////     /*source_index*/source_index
////     /*destination_index*/destination_index
////     /*integer*/integer
////     /*sliced*/sliced
////     /*source*/source
////     /*destination*/destination
    `).state;
        const evaluator = state.program.evaluator!;
        const typeAt = (marker: string) => {
            const node = getNodeAtMarker(state, marker);
            assert.strictEqual(node.nodeType, ParseNodeType.Name);
            return evaluator.getTypeOfExpression(node).type;
        };
        assert.strictEqual(evaluator.assignType(typeAt('sliced'), typeAt('integer')), overlap);
        assert.strictEqual(evaluator.assignType(typeAt('destination_index'), typeAt('source_index')), overlap);
        const source = typeAt('source');
        const destination = typeAt('destination');
        assert.ok(isClassInstance(source) && isClassInstance(destination));
        assert.strictEqual(
            tryFastRejectSequenceProtocol(
                evaluator,
                ClassType.cloneAsInstantiable(destination),
                source,
                new ConstraintTracker(),
                AssignTypeFlags.Default,
                0
            ),
            overlap ? undefined : '__getitem__'
        );
        assert.strictEqual(
            assignClassToProtocol(
                evaluator,
                ClassType.cloneAsInstantiable(destination),
                source,
                new DiagnosticAddendum(),
                new ConstraintTracker(),
                AssignTypeFlags.Default,
                0
            ),
            false
        );
    }
);

describe.each(['stock', 'erased', 'extraOverload', 'explicitSelf', 'unknownReturn', 'nonOverloaded'])(
    'ProtocolRequirementListContract %s',
    (contract) => {
        test.each([false, true])('concrete=%s', (concrete) => {
            const builtinsStub = readFileSync(
                resolve(__dirname, '../../typeshed-fallback/stdlib/builtins.pyi'),
                'utf8'
            );
            const listStart = builtinsStub.indexOf('class list(MutableSequence[_T]):');
            const listEnd = builtinsStub.indexOf('\nclass ', listStart + 1);
            assert.ok(listStart >= 0 && listEnd > listStart);
            const listStub = builtinsStub.slice(listStart, listEnd);
            const indexSignature = 'def __getitem__(self, i: SupportsIndex, /) -> _T: ...';
            const sliceOverload =
                '    @overload\n    def __getitem__(self, s: slice[SupportsIndex | None], /) -> list[_T]: ...';
            assert.ok(listStub.includes(indexSignature) && listStub.includes(sliceOverload));
            let changedList = listStub;
            if (contract === 'erased') {
                changedList = listStub.replace(indexSignature, indexSignature.replace('-> _T', '-> Any'));
            } else if (contract === 'extraOverload') {
                changedList = listStub.replace(
                    indexSignature,
                    `def __getitem__(self, i: int, /) -> Any: ...\n    @overload\n    ${indexSignature}`
                );
            } else if (contract === 'explicitSelf') {
                changedList = listStub.replace(indexSignature, indexSignature.replace('self,', 'self: list[int],'));
            } else if (contract === 'unknownReturn') {
                changedList = listStub.replace(indexSignature, indexSignature.replace('-> _T', '-> MissingReturn'));
            } else if (contract === 'nonOverloaded') {
                changedList = listStub
                    .replace(sliceOverload, '')
                    .replace(`    @overload\n    ${indexSignature}`, `    ${indexSignature}`);
            }
            const state = parseAndGetTestState(`
// @filename: /typeshed-fallback/stdlib/builtins.pyi
${(builtinsStub.slice(0, listStart) + changedList + builtinsStub.slice(listEnd))
    .split('\n')
    .map((line) => `//// ${line}`)
    .join('\n')}
// @filename: test.py
//// from collections.abc import Callable, Iterator
//// from typing import Protocol, TypeVar
//// T_co = TypeVar("T_co", covariant=True)
//// class Leaf(Protocol[T_co]):
////     def serialize(self) -> T_co: ...
//// class NestedSequence(Protocol[T_co]):
////     def __len__(self, /) -> int: ...
////     def __getitem__(self, index: int, /) -> T_co | "NestedSequence[T_co]": ...
////     def __iter__(self, /) -> Iterator[T_co | "NestedSequence[T_co]"]: ...
//// def check[T](source: list[Callable[[], int]], destination: NestedSequence[${
                concrete ? 'int' : 'Leaf[T]'
            }], variable: T):
////     /*source*/source
////     /*destination*/destination
////     /*variable*/variable
            `).state;
            const evaluator = state.program.evaluator!;
            const sourceNode = getNodeAtMarker(state, 'source');
            const destinationNode = getNodeAtMarker(state, 'destination');
            const variableNode = getNodeAtMarker(state, 'variable');
            assert.strictEqual(sourceNode.nodeType, ParseNodeType.Name);
            assert.strictEqual(destinationNode.nodeType, ParseNodeType.Name);
            assert.strictEqual(variableNode.nodeType, ParseNodeType.Name);
            const source = evaluator.getTypeOfExpression(sourceNode).type;
            const destination = evaluator.getTypeOfExpression(destinationNode).type;
            const variable = evaluator.getTypeOfExpression(variableNode).type;
            assert.ok(isClassInstance(source) && isClassInstance(destination) && isTypeVar(variable));
            const scopeId = variable.priv.freeTypeVar?.priv.scopeId;
            assert.ok(scopeId);
            const target = makeTypeVarsFree(ClassType.cloneAsInstantiable(destination), [scopeId]);
            const constraints = new ConstraintTracker();
            constraints.getMainConstraintSet().addScopeId('caller');
            assert.strictEqual(
                tryFastRejectSequenceProtocol(evaluator, target, source, constraints, AssignTypeFlags.Default, 0),
                contract === 'stock' ? '__getitem__' : undefined
            );
            expect(
                constraints
                    .getConstraintSets()
                    .map((set) => ({ scopes: [...set.getScopeIds()], bindings: set.getTypeVars() }))
            ).toEqual([{ scopes: ['caller'], bindings: [] }]);
        });
    }
);
