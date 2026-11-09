/*
 * typeEvaluator7.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Unit tests for pyright type evaluator. Tests are split
 * arbitrarily among multiple files so they can run in parallel.
 */

import * as assert from 'assert';

import { ConstraintTracker } from '../analyzer/constraintTracker';
import { assignClassToProtocol, tryFastRejectSequenceProtocol } from '../analyzer/protocols';
import { AssignTypeFlags } from '../analyzer/typeEvaluatorTypes';
import { AnyType, ClassType, isClassInstance, TypeVarType, UnknownType } from '../analyzer/types';
import { ConfigOptions } from '../common/configOptions';
import { DiagnosticAddendum } from '../common/diagnostic';
import { DiagnosticRule } from '../common/diagnosticRules';
import {
    pythonVersion3_10,
    pythonVersion3_11,
    pythonVersion3_12,
    pythonVersion3_13,
    pythonVersion3_14,
    pythonVersion3_8,
} from '../common/pythonVersion';
import { Uri } from '../common/uri/uri';
import { LocMessage } from '../localization/localize';
import { ParseNodeType } from '../parser/parseNodes';
import { getNodeAtMarker, parseAndGetTestState } from './harness/fourslash/testState';
import * as TestUtils from './testUtils';

test('GenericType1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType1.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('GenericType2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType3.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('GenericType4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType4.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericType5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType5.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericType6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType6.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericType7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType7.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('GenericType8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType8.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericType9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType9.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('GenericType10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType11.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType12.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType13.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType14.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType15.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType16.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType17', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType17.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType18', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType18.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericType19', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType19.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType20', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType20.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericType21', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType21.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType22', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType22.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericType23', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType23.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType24', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType24.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType25', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType25.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericType26', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType26.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('GenericType27', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType27.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType28', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType28.py']);

    TestUtils.validateResults(analysisResults, 18);
});

test('GenericType29', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType29.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType30', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType30.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType31', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType31.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('GenericType32', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType32.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType33', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType33.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericType34', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType34.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType35', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType35.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('GenericType36', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType36.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType37', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType37.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType38', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType38.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType39', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType39.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType40', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType40.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType41', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType41.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType42', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType42.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType43', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType43.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType44', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType44.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType45', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType45.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('GenericType46', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType46.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('GenericType47', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['genericType47.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol1.py']);

    TestUtils.validateResults(analysisResults, 9);
});

test('Protocol2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol3.py']);

    TestUtils.validateResults(analysisResults, 13);
});

test('Protocol4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol4.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('Protocol5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol6.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('Protocol7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol7.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Protocol8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol8.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Protocol9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol9.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol11.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol12.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Protocol13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol13.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol14.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol15.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol16.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Protocol17', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.reportInvalidTypeVarUse = 'error';
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol17.py']);

    TestUtils.validateResults(analysisResults, 7);
});

test('Protocol18', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol18.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Protocol19', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol19.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Protocol20', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol20.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol21', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol21.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Protocol22', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.reportInvalidTypeVarUse = 'error';
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol22.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol23', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol23.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Protocol24', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol24.py']);

    TestUtils.validateResults(analysisResults, 6);
});

test('Protocol25', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol25.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Protocol26', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol26.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol28', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol28.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol29', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol29.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol30', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol30.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Protocol31', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol31.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol32', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol32.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Protocol33', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol33.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol34', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol34.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Protocol35', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol35.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('Protocol36', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol36.py']);

    TestUtils.validateResults(analysisResults, 7);
    const protocolErrors = analysisResults[0].errors.filter((error) =>
        error.message.includes('FullNestedSequence[SupportsArray]')
    );
    expect(protocolErrors).toHaveLength(4);
    const unionCallError = protocolErrors.filter((error) => error.message.startsWith('Argument of type'));
    expect(unionCallError).toHaveLength(1);
    expect(unionCallError[0].message).toContain('__getitem__');
    expect(unionCallError[0].message).not.toContain('__iter__');
    expect(protocolErrors.some((error) => error.message.includes('__iter__'))).toBe(true);
    expect(protocolErrors.some((error) => error.message.includes('__reversed__'))).toBe(true);
});

test('Protocol36Overloads', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol36Overloads.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol36Slice', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol36Slice.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol36UncertainElementType', () => {
    const code = `
// @filename: test.py
//// from collections.abc import Iterator
//// from typing import Any, cast, Protocol, TypeVar
////
//// T_co = TypeVar("T_co", covariant=True)
////
//// class SupportsArray(Protocol):
////     def __array__(self) -> object: ...
////
//// class FullNestedSequence(Protocol[T_co]):
////     def __len__(self, /) -> int: ...
////     def __getitem__(self, index: int, /) -> T_co | "FullNestedSequence[T_co]": ...
////     def __contains__(self, value: object, /) -> bool: ...
////     def __iter__(self, /) -> Iterator[T_co | "FullNestedSequence[T_co]"]: ...
////     def __reversed__(self, /) -> Iterator[T_co | "FullNestedSequence[T_co]"]: ...
////     def count(self, value: Any, /) -> int: ...
////     def index(self, value: Any, /) -> int: ...
////
//// def identity[T](value: T) -> T:
////     return value
////
//// def check[T](value: T):
////     source = /*source*/[value]
////     nested_source = /*nestedSource*/[[value]]
////     concrete_source = /*concreteSource*/[1]
////     generic_callable_source = /*genericCallableSource*/[identity]
////     destination = /*destination*/cast(FullNestedSequence[SupportsArray], None)
    `;
    const state = parseAndGetTestState(code).state;
    const sourceNode = getNodeAtMarker(state, 'source');
    const nestedSourceNode = getNodeAtMarker(state, 'nestedSource');
    const concreteSourceNode = getNodeAtMarker(state, 'concreteSource');
    const genericCallableSourceNode = getNodeAtMarker(state, 'genericCallableSource');
    const destinationNode = getNodeAtMarker(state, 'destination');
    assert.strictEqual(sourceNode.nodeType, ParseNodeType.List);
    assert.strictEqual(nestedSourceNode.nodeType, ParseNodeType.List);
    assert.strictEqual(concreteSourceNode.nodeType, ParseNodeType.List);
    assert.strictEqual(genericCallableSourceNode.nodeType, ParseNodeType.List);
    assert.strictEqual(destinationNode.nodeType, ParseNodeType.Name);
    assert.strictEqual(destinationNode.parent?.nodeType, ParseNodeType.Call);

    const sourceType = state.program.evaluator!.getTypeOfExpression(sourceNode).type;
    const nestedSourceType = state.program.evaluator!.getTypeOfExpression(nestedSourceNode).type;
    const concreteSourceType = state.program.evaluator!.getTypeOfExpression(concreteSourceNode).type;
    const genericCallableSourceType = state.program.evaluator!.getTypeOfExpression(genericCallableSourceNode).type;
    const destinationType = state.program.evaluator!.getTypeOfExpression(destinationNode.parent).type;
    assert.ok(isClassInstance(sourceType));
    assert.ok(isClassInstance(nestedSourceType));
    assert.ok(isClassInstance(concreteSourceType));
    assert.ok(isClassInstance(genericCallableSourceType));
    assert.ok(isClassInstance(destinationType));

    const typeVar = TypeVarType.cloneAsUnificationVar(TypeVarType.createInstance('T'));
    const sourceWithUnificationTypeVar = ClassType.specialize(concreteSourceType, [typeVar]);
    const listOfAny = ClassType.specialize(concreteSourceType, [AnyType.create()]);
    const listOfUnknown = ClassType.specialize(concreteSourceType, [UnknownType.create()]);
    const uncertainSources = [sourceType, sourceWithUnificationTypeVar, listOfAny, listOfUnknown];

    for (const uncertainSource of uncertainSources) {
        assert.strictEqual(
            tryFastRejectSequenceProtocol(
                state.program.evaluator!,
                destinationType,
                uncertainSource,
                undefined,
                AssignTypeFlags.Default,
                0
            ),
            undefined
        );
    }

    const uncertainElements = [sourceType.priv.typeArgs![0], typeVar, AnyType.create(), UnknownType.create()];
    for (const uncertainElement of uncertainElements) {
        const constraints = new ConstraintTracker();
        constraints.setBounds(typeVar, concreteSourceType.priv.typeArgs![0]);
        const originalConstraints = constraints.clone();
        assert.strictEqual(
            tryFastRejectSequenceProtocol(
                state.program.evaluator!,
                ClassType.specialize(destinationType, [uncertainElement]),
                concreteSourceType,
                constraints,
                AssignTypeFlags.Default,
                0
            ),
            undefined
        );
        assert.ok(constraints.isSame(originalConstraints));
    }

    assert.strictEqual(
        tryFastRejectSequenceProtocol(
            state.program.evaluator!,
            destinationType,
            concreteSourceType,
            undefined,
            AssignTypeFlags.Default,
            0
        ),
        '__getitem__'
    );
    assert.strictEqual(
        tryFastRejectSequenceProtocol(
            state.program.evaluator!,
            destinationType,
            nestedSourceType,
            undefined,
            AssignTypeFlags.Default,
            0
        ),
        '__getitem__'
    );
    assert.strictEqual(
        tryFastRejectSequenceProtocol(
            state.program.evaluator!,
            destinationType,
            genericCallableSourceType,
            undefined,
            AssignTypeFlags.Default,
            0
        ),
        '__getitem__'
    );

    const getFastCacheEntryCount = () => {
        const protocolCache = concreteSourceType.shared.protocolCompatibility as
            | Map<string, { isFastRejection?: boolean }[]>
            | undefined;
        return protocolCache
            ? Array.from(protocolCache.values()).reduce(
                  (count, entries) => count + entries.filter((entry) => entry.isFastRejection).length,
                  0
              )
            : 0;
    };

    assert.strictEqual(
        assignClassToProtocol(
            state.program.evaluator!,
            ClassType.cloneAsInstantiable(destinationType),
            concreteSourceType,
            undefined,
            undefined,
            AssignTypeFlags.Default,
            0
        ),
        false
    );
    assert.strictEqual(getFastCacheEntryCount(), 1);

    assert.strictEqual(
        assignClassToProtocol(
            state.program.evaluator!,
            ClassType.cloneAsInstantiable(destinationType),
            concreteSourceType,
            new DiagnosticAddendum(),
            undefined,
            AssignTypeFlags.Default,
            0
        ),
        false
    );
    assert.strictEqual(getFastCacheEntryCount(), 0);

    for (const gradualList of [listOfAny, listOfUnknown]) {
        const nestedList = ClassType.specialize(concreteSourceType, [gradualList]);
        const originalTypeText = state.program.evaluator!.printType(nestedList);
        assert.strictEqual(
            tryFastRejectSequenceProtocol(
                state.program.evaluator!,
                destinationType,
                nestedList,
                undefined,
                AssignTypeFlags.Default,
                0
            ),
            undefined
        );
        assert.strictEqual(
            assignClassToProtocol(
                state.program.evaluator!,
                ClassType.cloneAsInstantiable(destinationType),
                nestedList,
                new DiagnosticAddendum(),
                undefined,
                AssignTypeFlags.Default,
                0
            ),
            true
        );
        assert.strictEqual(state.program.evaluator!.printType(nestedList), originalTypeText);
    }
});

test.each([false, true])('Protocol36CacheReuse positiveFirst=%s', (positiveFirst) => {
    const code = `
// @filename: test.py
//// from collections.abc import Iterator
//// from typing import Protocol, TypeVar
////
//// T_co = TypeVar("T_co", covariant=True)
////
//// class NestedSequence(Protocol[T_co]):
////     def __len__(self, /) -> int: ...
////     def __getitem__(self, index: int, /) -> T_co | "NestedSequence[T_co]": ...
////     def __iter__(self, /) -> Iterator[T_co | "NestedSequence[T_co]"]: ...
////
//// def check(source: list[int], destination: NestedSequence[str]):
////     /*source*/source
////     /*destination*/destination
    `;
    const state = parseAndGetTestState(code).state;
    const evaluator = state.program.evaluator!;
    const sourceNode = getNodeAtMarker(state, 'source');
    const destinationNode = getNodeAtMarker(state, 'destination');
    assert.strictEqual(sourceNode.nodeType, ParseNodeType.Name);
    assert.strictEqual(destinationNode.nodeType, ParseNodeType.Name);
    const sourceType = evaluator.getTypeOfExpression(sourceNode).type;
    const destinationType = evaluator.getTypeOfExpression(destinationNode).type;
    assert.ok(isClassInstance(sourceType));
    assert.ok(isClassInstance(destinationType));
    const elementType = sourceType.priv.typeArgs![0];
    const rejectedType = ClassType.cloneAsInstantiable(destinationType);
    const acceptedType = ClassType.specialize(rejectedType, [elementType]);
    const typeParam = destinationType.shared.typeParams[0];
    const genericType = ClassType.specialize(rejectedType, [typeParam]);
    const constraints = new ConstraintTracker();
    constraints.setBounds(typeParam, elementType);
    const originalConstraints = constraints.clone();
    const assign = (destination: ClassType, diag?: DiagnosticAddendum, tracker = constraints) =>
        assignClassToProtocol(evaluator, destination, sourceType, diag, tracker, AssignTypeFlags.Default, 0);

    if (positiveFirst) {
        assert.strictEqual(assign(acceptedType), true);
    }

    assert.strictEqual(assign(rejectedType), false);
    assert.ok(constraints.isSame(originalConstraints));
    assert.strictEqual(assign(rejectedType), false);
    assert.ok(constraints.isSame(originalConstraints));
    assert.strictEqual(assign(acceptedType), true);

    const diagnostics = new DiagnosticAddendum();
    assert.strictEqual(assign(rejectedType, diagnostics), false);
    const diagnosticText = diagnostics.getString();
    expect(diagnosticText).toContain('"__iter__" is an incompatible type');
    expect(diagnosticText).toContain(
        'Type "() -> Iterator[int]" is not assignable to type "() -> Iterator[str | NestedSequence[str]]"'
    );
    assert.ok(constraints.isSame(originalConstraints));
    assert.strictEqual(assign(rejectedType), false);
    assert.strictEqual(assign(acceptedType), true);

    for (let attempt = 0; attempt < 2; attempt++) {
        const inferredConstraints = new ConstraintTracker();
        assert.strictEqual(assign(genericType, undefined, inferredConstraints), true);
        assert.strictEqual(
            evaluator.printType(evaluator.solveAndApplyConstraints(typeParam, inferredConstraints)),
            'int'
        );
    }
});

test('ProtocolMethodTypeParamBound', () => {
    const code = `
// @filename: test.py
//// from typing import Protocol
////
//// class Expected(Protocol):
////     def f[U: str](self, value: U) -> U: ...
////
//// class Actual:
////     def f[U: int](self, value: U) -> U: ...
////
//// def check(source: Actual):
////     invalid: Expected = source
    `;
    const state = parseAndGetTestState(code).state;
    const file = state.testData.files[0];
    const results = TestUtils.getAnalysisResults(state.program, [file.fileUri], state.configOptions);
    TestUtils.validateResults(results, 1);
    const message = results[0].errors[0].message;
    expect(message).toContain('"f" is an incompatible type');
    expect(message).toContain('Type "U@f" is not assignable to type "int"');
});

test('ProtocolMethodParamNameAndKind', () => {
    const code = `
// @filename: test.py
//// from typing import Protocol
////
//// class NameProto[T](Protocol):
////     def f(self, x: T) -> None: ...
////
//// class NameImpl:
////     def f(self, y: int) -> None: ...
////
//// class KindProto[T](Protocol):
////     def f(self, *, x: T) -> None: ...
////
//// class KindImpl:
////     def f(self, x: int, /) -> None: ...
////
//// def check(a: NameImpl, b: KindImpl):
////     v1: NameProto[int] = a
////     v2: KindProto[int] = b
    `;
    const state = parseAndGetTestState(code).state;
    const file = state.testData.files[0];
    const results = TestUtils.getAnalysisResults(state.program, [file.fileUri], state.configOptions);
    TestUtils.validateResults(results, 2);
    const [nameError, kindError] = results[0].errors;
    expect(nameError.message).toContain('Type "(y: int) -> None" is not assignable to type "(x: T@NameProto) -> None"');
    expect(kindError.message).toContain(
        'Type "(x: int, /) -> None" is not assignable to type "(*, x: T@KindProto) -> None"'
    );
});

test.each([
    ['list[int]', false],
    ['list[list[int]]', false],
    ['list[ArrayImpl]', true],
    ['list[list[ArrayImpl]]', true],
    ['list[list[Any]]', true],
    ['list[Callable[[int], int]]', false],
    ['list[Callable[[T], T]]', false],
    ['list[tuple[T, int]]', false],
] as const)('Protocol36StructuralComparison %s', (annotation, expected) => {
    const compare = (withDiagnostics: boolean) => {
        const code = `
// @filename: test.py
//// from collections.abc import Callable, Iterator
//// from typing import Any, Protocol, TypeVar
////
//// T_co = TypeVar("T_co", covariant=True)
////
//// class SupportsArray(Protocol):
////     def __array__(self) -> object: ...
////
//// class ArrayImpl:
////     def __array__(self) -> object: ...
////
//// class NestedSequence(Protocol[T_co]):
////     def __len__(self, /) -> int: ...
////     def __getitem__(self, index: int, /) -> T_co | "NestedSequence[T_co]": ...
////     def __iter__(self, /) -> Iterator[T_co | "NestedSequence[T_co]"]: ...
////
//// def check[T](source: ${annotation}, destination: NestedSequence[SupportsArray], valid: list[ArrayImpl]):
////     /*source*/source
////     /*destination*/destination
////     /*valid*/valid
        `;
        const state = parseAndGetTestState(code).state;
        const evaluator = state.program.evaluator!;
        const types = ['source', 'destination', 'valid'].map((marker) => {
            const node = getNodeAtMarker(state, marker);
            assert.strictEqual(node.nodeType, ParseNodeType.Name);
            const type = evaluator.getTypeOfExpression(node).type;
            assert.ok(isClassInstance(type));
            return type;
        });
        const [sourceType, destinationType, validType] = types;
        const destination = ClassType.cloneAsInstantiable(destinationType);
        const typeParam = destination.shared.typeParams[0];
        const constraints = new ConstraintTracker();
        const originalConstraints = constraints.clone();
        assert.strictEqual(evaluator.isSpeculativeModeInUse(undefined), false);
        const diagnostics = withDiagnostics ? new DiagnosticAddendum() : undefined;
        const compatible = assignClassToProtocol(
            evaluator,
            destination,
            sourceType,
            diagnostics,
            constraints,
            AssignTypeFlags.Default,
            0
        );
        assert.strictEqual(compatible, expected);
        assert.ok(constraints.isSame(originalConstraints));
        if (diagnostics && !expected) {
            expect(diagnostics.getString()).not.toBe('');
        }

        const genericDestination = ClassType.specialize(destination, [typeParam]);
        const inferredTypes: string[] = [];
        for (let attempt = 0; attempt < 2; attempt++) {
            const inferredConstraints = new ConstraintTracker();
            assert.strictEqual(
                assignClassToProtocol(
                    evaluator,
                    genericDestination,
                    validType,
                    undefined,
                    inferredConstraints,
                    AssignTypeFlags.Default,
                    0
                ),
                true
            );
            inferredTypes.push(evaluator.printType(evaluator.solveAndApplyConstraints(typeParam, inferredConstraints)));
        }
        expect(inferredTypes).toEqual(['ArrayImpl', 'ArrayImpl']);
        return { compatible, inferredTypes };
    };

    expect(compare(false)).toEqual(compare(true));
});

test('Protocol37', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol37.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol38', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol38.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol39', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol39.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol40', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol40.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol41', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol41.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol42', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol42.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol43', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol43.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol44', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol44.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol45', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol45.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol46', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol46.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol47', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol47.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Protocol48', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol48.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol49', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol49.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol50', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol50.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol51', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol51.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol52', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol52.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol53', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    // Note: This test exposes some inconsistencies between override checks
    // and protocol matching. Both of these should generate 8 errors.
    configOptions.diagnosticRuleSet.reportAssignmentType = 'none';
    configOptions.diagnosticRuleSet.reportIncompatibleMethodOverride = 'error';
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['protocol53.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 10);

    configOptions.diagnosticRuleSet.reportAssignmentType = 'error';
    configOptions.diagnosticRuleSet.reportIncompatibleMethodOverride = 'none';
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['protocol53.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 8);
});

test('Protocol54', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol54.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Protocol55', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol55.py']);

    TestUtils.validateResults(analysisResults, 5);

    const decoratorErrors = analysisResults[0].errors.filter(
        (diag) => diag.getRule() === DiagnosticRule.reportGeneralTypeIssues
    );
    assert.deepStrictEqual(
        decoratorErrors.map((diag) => ({ message: diag.message, range: diag.range })),
        [13, 24, 45, 156].map((line) => ({
            message: LocMessage.runtimeCheckableNotProtocol(),
            range: { start: { line, character: 1 }, end: { line, character: 18 } },
        }))
    );
    const protocolErrors = analysisResults[0].errors.filter(
        (diag) => diag.getRule() === DiagnosticRule.reportArgumentType
    );
    assert.deepStrictEqual(
        protocolErrors.map((diag) => diag.range.start.line),
        [97]
    );
});

test('Protocol55UntypedDecorators', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.reportUntypedClassDecorator = 'error';
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol55.py'], configOptions);

    TestUtils.validateResults(analysisResults, 12);
    const untypedDecoratorErrors = analysisResults[0].errors.filter(
        (diag) => diag.getRule() === DiagnosticRule.reportUntypedClassDecorator
    );
    assert.deepStrictEqual(
        untypedDecoratorErrors.map((diag) => diag.range.start.line),
        [127, 135, 142, 149, 158, 165, 190]
    );
});

test('Protocol56', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocol56.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('ProtocolExplicit1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocolExplicit1.py']);

    TestUtils.validateResults(analysisResults, 5);
});

test('ProtocolExplicit3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['protocolExplicit3.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test.each(
    (['cache', 'recursiveArgument', 'recursiveReturn'] as const).flatMap((path) =>
        (['standard', 'positionalOnly', 'keywordOnly'] as const).flatMap((kind) =>
            (
                [
                    ['optional', 'required', false],
                    ['required', 'optional', false],
                    ['optional', 'optional', true],
                ] as const
            ).map(([first, second, compatible]) => ({ path, kind, first, second, compatible }))
        )
    )
)('TypedDictCallableIdentity $path $kind $first/$second', ({ path, kind, first, second, compatible }) => {
    const suffix = kind === 'positionalOnly' ? ', /' : '';
    const prefix = kind === 'keywordOnly' ? '*, ' : '';
    const recursive = path !== 'cache';
    const code = `
// @filename: test.py
//// from typing import Callable, ReadOnly, TypedDict
////
//// def optional(${prefix}x: int = 0${suffix}) -> None:
////     pass
////
//// def required(${prefix}x: int${suffix}) -> None:
////     pass
////
${
    recursive
        ? `//// class A[T](TypedDict, total=False):
////     next: ReadOnly["A[T]"]
////     value: ReadOnly[T]
////
//// class B[T, U](TypedDict, total=False):
////     next: ReadOnly["B[U, T]"]
////     value: ReadOnly[T]
////     other: ReadOnly[U]
////
//// def source[T, U](t: T, u: U) -> B[T, U]:
////     child: B[U, T] = {"value": u, "other": t}
////     return {"value": t, "other": u, "next": child}
////
//// def consume(result: A[Callable[[], None]]) -> None:
////     if "next" in result and "value" in result["next"]:
////         result["next"]["value"]()
////
${
    path === 'recursiveReturn'
        ? `//// def bad() -> A[Callable[[], None]]:
////     /*error*/return source(${first}, ${second})
////
//// consume(bad())`
        : `//// /*error*/consume(source(${first}, ${second}))`
}`
        : `//// class A(TypedDict):
////     value: ReadOnly[Callable[[], None]]
////
//// class B[T](TypedDict):
////     value: ReadOnly[T]
////
//// class Source[T, U](TypedDict):
////     first: ReadOnly[B[T]]
////     second: ReadOnly[B[U]]
////
//// class Dest(TypedDict):
////     first: ReadOnly[A]
////     second: ReadOnly[A]
////
//// def source[T, U](t: T, u: U) -> Source[T, U]:
////     return {"first": {"value": t}, "second": {"value": u}}
////
//// def bad() -> Dest:
////     /*error*/return source(${first}, ${second})
////
//// bad()["second"]["value"]()`
}
    `;
    const state = parseAndGetTestState(code).state;
    state.configOptions.defaultPythonVersion = pythonVersion3_13;
    const file = state.testData.files[0];
    const results = TestUtils.getAnalysisResults(state.program, [file.fileUri], state.configOptions);
    TestUtils.validateResults(results, compatible ? 0 : 1);
    if (!compatible) {
        const diagnostic = results[0].errors[0];
        assert.strictEqual(
            diagnostic.getRule(),
            path === 'recursiveArgument' ? DiagnosticRule.reportArgumentType : DiagnosticRule.reportReturnType
        );
        const marker = state.getMarkerByName('error');
        const line = file.content.slice(0, marker.position).split('\n').length - 1;
        assert.strictEqual(diagnostic.range.start.line, line);
        const callable = (name: string) => `(${prefix}x: int${name === 'optional' ? ' = 0' : ''}${suffix}) -> None`;
        const source = `${recursive ? 'B' : 'Source'}[${callable(first)}, ${callable(second)}]`;
        const destination = recursive ? 'A[() -> None]' : 'Dest';
        const header =
            path === 'recursiveArgument'
                ? `Argument of type "${source}" cannot be assigned to parameter "result" of type "${destination}" in function "consume"`
                : `Type "${source}" is not assignable to return type "${destination}"`;
        const indent = '\u00a0\u00a0';
        const entry =
            path === 'cache'
                ? [`${indent}"${first === 'required' ? 'first' : 'second'}" is an incompatible type`]
                : first === 'optional'
                ? [`${indent}"next" is an incompatible type`]
                : [];
        const depth = entry.length + 1;
        assert.strictEqual(
            diagnostic.message,
            [
                header,
                ...entry,
                `${indent.repeat(depth)}"value" is an incompatible type`,
                `${indent.repeat(depth + 1)}Type "${callable('required')}" is not assignable to type "() -> None"`,
                ...(kind === 'positionalOnly'
                    ? [
                          `${indent.repeat(depth + 2)}Position-only parameter mismatch; expected 0 but received 1`,
                          `${indent.repeat(
                              depth + 2
                          )}Function accepts too many positional parameters; expected 0 but received 1`,
                      ]
                    : [`${indent.repeat(depth + 2)}Extra parameter "x"`]),
            ].join('\n')
        );
    }
});

test.each([
    ['optional', 'required', false],
    ['required', 'optional', false],
    ['optional', 'optional', true],
] as const)('TypedDictCallableConstructor %s/%s', (first, second, compatible) => {
    const code = `
// @filename: test.py
//// from typing import Callable, ReadOnly, TypedDict, assert_type
////
//// class A[T](TypedDict):
////     value: ReadOnly[T]
////
//// class B[T](TypedDict):
////     value: ReadOnly[T]
////
//// class Dest(TypedDict):
////     first: ReadOnly[A[Callable[[], int]]]
////     second: ReadOnly[A[Callable[[], int]]]
////
//// class Source[T, U](TypedDict):
////     first: ReadOnly[B[T]]
////     second: ReadOnly[B[U]]
////
//// def optional(x: int = 0) -> int:
////     return x
////
//// def required(x: int) -> int:
////     return x
////
//// def expose() -> Dest:
////     source = Source(first=B(value=${first}), second=B(value=${second}))
////     /*error*/return source
////
//// def consumer() -> int:
////     assert_type(expose()["second"]["value"], Callable[[], int])
////     return expose()["second"]["value"]()
    `;
    const state = parseAndGetTestState(code).state;
    state.configOptions.defaultPythonVersion = pythonVersion3_13;
    const file = state.testData.files[0];
    const results = TestUtils.getAnalysisResults(state.program, [file.fileUri], state.configOptions);
    TestUtils.validateResults(results, compatible ? 0 : 1);
    if (!compatible) {
        const diagnostic = results[0].errors[0];
        assert.strictEqual(diagnostic.getRule(), DiagnosticRule.reportReturnType);
        const marker = state.getMarkerByName('error');
        const line = file.content.slice(0, marker.position).split('\n').length - 1;
        assert.strictEqual(diagnostic.range.start.line, line);
        const callable = (name: string) => `(x: int${name === 'optional' ? ' = 0' : ''}) -> int`;
        const indent = '\u00a0\u00a0';
        assert.strictEqual(
            diagnostic.message,
            [
                `Type "Source[${callable(first)}, ${callable(second)}]" is not assignable to return type "Dest"`,
                `${indent}"${first === 'required' ? 'first' : 'second'}" is an incompatible type`,
                `${indent.repeat(2)}"value" is an incompatible type`,
                `${indent.repeat(3)}Type "(x: int) -> int" is not assignable to type "() -> int"`,
                `${indent.repeat(4)}Extra parameter "x"`,
            ].join('\n')
        );
    }
});

test('TypedDictNestedSiblingDiagnostics', () => {
    const classes = (['Int', 'Str'] as const)
        .map(
            (prefix) => `
//// class ${prefix}Leaf(TypedDict):
////     value: ReadOnly[${prefix === 'Int' ? 'int' : 'str'}]
////
//// class ${prefix}Pair(TypedDict):
////     first: ReadOnly[${prefix}Leaf]
////     second: ReadOnly[${prefix}Leaf]
////
//// class ${prefix}Root(TypedDict):
////     inside: ReadOnly[${prefix}Pair]
////
//// class ${prefix}Outer(TypedDict):
////     outer: ReadOnly[${prefix}Root]
////`
        )
        .join('\n');
    const code = `
// @filename: test.py
//// from typing import TypedDict
//// from typing_extensions import ReadOnly
////
${classes}
//// def check(a: IntOuter, b: StrOuter):
////     /*a*/a
////     /*b*/b
    `;
    const state = parseAndGetTestState(code).state;
    const evaluator = state.program.evaluator!;
    const [aType, bType] = ['a', 'b'].map((marker) => {
        const node = getNodeAtMarker(state, marker);
        assert.strictEqual(node.nodeType, ParseNodeType.Name);
        return evaluator.getTypeOfExpression(node).type;
    });
    const diagnostics = new DiagnosticAddendum();
    assert.strictEqual(evaluator.assignType(aType, bType, diagnostics), false);
    const rendered = diagnostics.getString(undefined, 1000);
    const indent = '\u00a0\u00a0';
    assert.strictEqual(
        rendered,
        [
            '',
            `${indent}"outer" is an incompatible type`,
            `${indent.repeat(2)}"inside" is an incompatible type`,
            `${indent.repeat(3)}"first" is an incompatible type`,
            `${indent.repeat(4)}"value" is an incompatible type`,
            `${indent.repeat(5)}"str" is not assignable to "int"`,
            `${indent.repeat(3)}"second" is an incompatible type`,
            `${indent.repeat(4)}"value" is an incompatible type`,
            `${indent.repeat(5)}"str" is not assignable to "int"`,
        ].join('\n')
    );
});

test.each([64, 65].flatMap((width) => [false, true].map((hotFirst) => ({ width, hotFirst }))))(
    'TypedDictDestinationWorkingSet width=$width hotFirst=$hotFirst',
    ({ width, hotFirst }) => {
        const layers = 4;
        const classes = Array.from({ length: layers }, (_, layer) => {
            const indices = Array.from({ length: width }, (_, index) => index);
            const fields = (prefix: string) => {
                if (layer === 0) {
                    return '////     value: ReadOnly[int]';
                }
                const hot = Array.from({ length: 8 }, (_, index) => (hotFirst ? index : width - 8 + index));
                const repeatedHot = Array.from({ length: 8 }, () => hot).flat();
                const targets = hotFirst ? [...repeatedHot, ...indices] : [...indices, ...repeatedHot];
                return targets
                    .map(
                        (target, field) =>
                            `////     field${field}: ReadOnly["${
                                prefix === 'Source' ? `Source${layer - 1}` : `Dest${layer - 1}_${target}`
                            }"]`
                    )
                    .join('\n');
            };
            return (
                `//// class Source${layer}(TypedDict):\n${fields('Source')}\n////\n` +
                indices
                    .map((index) => `//// class Dest${layer}_${index}(TypedDict):\n${fields('Dest')}\n////`)
                    .join('\n')
            );
        }).join('\n');
        const code = `
// @filename: test.py
//// from typing import TypedDict
//// from typing_extensions import ReadOnly
////
${classes}
//// def check(dest: Dest${layers - 1}_0, source: Source${layers - 1}):
////     /*dest*/dest
////     /*source*/source
    `;
        const state = parseAndGetTestState(code).state;
        const evaluator = state.program.evaluator!;
        const [destType, sourceType] = ['dest', 'source'].map((marker) => {
            const node = getNodeAtMarker(state, marker);
            assert.strictEqual(node.nodeType, ParseNodeType.Name);
            return evaluator.getTypeOfExpression(node).type;
        });
        const assignType = evaluator.assignType;
        let comparisons = 0;
        const spy = jest.spyOn(evaluator, 'assignType').mockImplementation((...args) => {
            assert.ok(++comparisons < 20000, 'Destination classes evicted each other from the comparison cache');
            return assignType(...args);
        });
        try {
            assert.strictEqual(evaluator.assignType(destType, sourceType), true);
        } finally {
            spy.mockRestore();
        }
    }
);

test('TypedDictRecursive1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDictRecursive1.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypedDictRecursive2', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_13;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDictRecursive2.py'], configOptions);

    TestUtils.validateResults(analysisResults, 5);
    const indent = '\u00a0\u00a0';
    assert.deepStrictEqual(
        analysisResults[0].errors.map((diagnostic) => diagnostic.message),
        [
            [
                'Type "ReadOnlyStr" is not assignable to declared type "ReadOnlyInt"',
                `${indent}"value" is an incompatible type`,
                `${indent.repeat(2)}"str" is not assignable to "int"`,
            ].join('\n'),
            [
                'Type "StrParent" is not assignable to declared type "IntParent"',
                `${indent}"value" is an incompatible type`,
                `${indent.repeat(2)}"str" is not assignable to "int"`,
            ].join('\n'),
            [
                'Type "StrChild" is not assignable to declared type "IntChild"',
                `${indent}"parent" is an incompatible type`,
                `${indent.repeat(2)}"value" is an incompatible type`,
                `${indent.repeat(3)}"str" is not assignable to "int"`,
            ].join('\n'),
            [
                'Type "StrWrapper" is not assignable to declared type "IntWrapper"',
                `${indent}"parent" is an incompatible type`,
                `${indent.repeat(2)}"value" is an incompatible type`,
                `${indent.repeat(3)}"str" is not assignable to "int"`,
                `${indent}"child" is an incompatible type`,
                `${indent.repeat(2)}"parent" is an incompatible type`,
                `${indent.repeat(3)}"value" is an incompatible type`,
                `${indent.repeat(4)}"str" is not assignable to "int"`,
                `${indent}"again" is an incompatible type`,
            ].join('\n'),
            [
                'Type "GenericB[str]" is not assignable to declared type "GenericA[int]"',
                `${indent}"value" is an incompatible type`,
                `${indent.repeat(2)}"str" is not assignable to "int"`,
            ].join('\n'),
        ]
    );
});

test('TypedDictRecursive3', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_13;
    configOptions.diagnosticRuleSet.enableExperimentalFeatures = true;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDictRecursive3.py'], configOptions);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypedDictRecursiveRecursionBudget', () => {
    const chains = ['A', 'B']
        .map((prefix) =>
            Array.from(
                { length: 19 },
                (_, index) => `
//// class ${prefix}Chain${index}(TypedDict):
////     next: ReadOnly["${prefix}${index === 18 ? 'Leaf' : `Chain${index + 1}`}"]
////`
            ).join('\n')
        )
        .join('\n');
    const code = `
// @filename: test.py
//// from typing import TypedDict
//// from typing_extensions import ReadOnly
////
//// class ALeaf(TypedDict):
////     value: ReadOnly[int]
////
//// class BLeaf(TypedDict):
////     value: ReadOnly[str]
////
${chains}
//// class ARoot(TypedDict):
////     deep: ReadOnly[AChain0]
////     shallow: ReadOnly[ALeaf]
////
//// class BRoot(TypedDict):
////     deep: ReadOnly[BChain0]
////     shallow: ReadOnly[BLeaf]
////
//// def check(a: ARoot, b: BRoot):
////     /*a*/a
////     /*b*/b
    `;
    const state = parseAndGetTestState(code).state;
    const evaluator = state.program.evaluator!;
    const [aType, bType] = ['a', 'b'].map((marker) => {
        const node = getNodeAtMarker(state, marker);
        assert.strictEqual(node.nodeType, ParseNodeType.Name);
        return evaluator.getTypeOfExpression(node).type;
    });

    assert.strictEqual(evaluator.assignType(aType, bType), false);
    const diagnostics = new DiagnosticAddendum();
    assert.strictEqual(evaluator.assignType(aType, bType, diagnostics), false);
    const indent = '\u00a0\u00a0';
    assert.strictEqual(
        diagnostics.getString(),
        [
            '',
            `${indent}"shallow" is an incompatible type`,
            `${indent.repeat(2)}"value" is an incompatible type`,
            `${indent.repeat(3)}"str" is not assignable to "int"`,
        ].join('\n')
    );
});

test.each([true, false])('TypedDictRecursiveSharedGraph compatible=%s', (compatible) => {
    const width = compatible ? 64 : 16;
    const layers = compatible ? 4 : 3;
    const classes = ['A', 'B']
        .map((prefix) =>
            Array.from({ length: layers }, (_, layer) =>
                Array.from({ length: width }, (_, index) => {
                    const fields = Array.from(
                        { length: layer === 0 ? 1 : width },
                        (_, field) =>
                            `////     field${field}: ReadOnly["${
                                layer === 0 ? `${prefix}Leaf` : `${prefix}${layer - 1}_${field}`
                            }"]`
                    ).join('\n');
                    return `//// class ${prefix}${layer}_${index}(TypedDict):\n${fields}\n////`;
                }).join('\n')
            ).join('\n')
        )
        .join('\n');
    const code = `
// @filename: test.py
//// from typing import TypedDict
//// from typing_extensions import ReadOnly
////
//// class ALeaf(TypedDict):
////     value: ReadOnly[int]
////
//// class BLeaf(TypedDict):
////     value: ReadOnly[${compatible ? 'int' : 'str'}]
////
${classes}
//// def check(a: A${layers - 1}_0, b: B${layers - 1}_0):
////     /*a*/a
////     /*b*/b
    `;
    const state = parseAndGetTestState(code).state;
    const evaluator = state.program.evaluator!;
    const [aType, bType] = ['a', 'b'].map((marker) => {
        const node = getNodeAtMarker(state, marker);
        assert.strictEqual(node.nodeType, ParseNodeType.Name);
        return evaluator.getTypeOfExpression(node).type;
    });
    const assignType = evaluator.assignType;
    let comparisons = 0;
    const spy = jest.spyOn(evaluator, 'assignType').mockImplementation((...args) => {
        assert.ok(++comparisons < 20000, 'Shared TypedDict subgraphs were repeatedly recomputed');
        return assignType(...args);
    });
    try {
        assert.strictEqual(evaluator.assignType(aType, bType), compatible);
        if (!compatible) {
            const diagnostics = new DiagnosticAddendum();
            assert.strictEqual(evaluator.assignType(aType, bType, diagnostics), false);
            const indent = '\u00a0\u00a0';
            // Assert the complete 1000-line rendering, including its line-budget boundary:
            // 15 full outer fields (65 lines each) and a final field with 6 children (25 lines).
            const expectedLines = Array.from({ length: 16 }, (_, outer) => [
                `${indent}"field${outer}" is an incompatible type`,
                ...Array.from({ length: outer === 15 ? 6 : 16 }, (_, inner) => [
                    `${indent.repeat(2)}"field${inner}" is an incompatible type`,
                    `${indent.repeat(3)}"field0" is an incompatible type`,
                    `${indent.repeat(4)}"value" is an incompatible type`,
                    `${indent.repeat(5)}"str" is not assignable to "int"`,
                ]).flat(),
            ]).flat();
            assert.strictEqual(diagnostics.getString(undefined, 1000), ['', ...expectedLines].join('\n'));
        }
    } finally {
        spy.mockRestore();
    }
});

test.each([
    [false, true],
    [true, true],
    [false, false],
    [true, false],
])('TypedDictRecursiveWide constraints=%s compatible=%s', (withConstraints, expectedCompatibility) => {
    const fields = (prefix: string) =>
        Array.from({ length: 56 }, (_, index) => `////     rel${index}: bool | "${prefix}Args"`).join('\n');
    const code = `
// @filename: test.py
//// from typing import TypedDict
////
//// class AInclude(TypedDict, total=False):
${fields('A')}
////     value: int
////
//// class AArgs(TypedDict, total=False):
////     include: "AInclude"
////
//// class BInclude(TypedDict, total=False):
${fields('B')}
////     value: ${expectedCompatibility ? 'int' : 'str'}
////
//// class BArgs(TypedDict, total=False):
////     include: "BInclude"
////
//// def check(a: AInclude, b: BInclude):
////     /*a*/a
////     /*b*/b
    `;
    const state = parseAndGetTestState(code).state;
    const evaluator = state.program.evaluator!;
    const [aType, bType] = ['a', 'b'].map((marker) => {
        const node = getNodeAtMarker(state, marker);
        assert.strictEqual(node.nodeType, ParseNodeType.Name);
        return evaluator.getTypeOfExpression(node).type;
    });

    const assignType = evaluator.assignType;
    let comparisons = 0;
    const spy = jest.spyOn(evaluator, 'assignType').mockImplementation((...args) => {
        // Bound work rather than wall-clock time, and fail promptly if recursion returns.
        assert.ok(++comparisons < 2000, 'Recursive TypedDict comparison exceeded its work budget');
        return assignType(...args);
    });
    try {
        const constraints = withConstraints ? new ConstraintTracker() : undefined;
        assert.strictEqual(evaluator.assignType(bType, aType, undefined, constraints), expectedCompatibility);
        const diagnostics = new DiagnosticAddendum();
        assert.strictEqual(evaluator.assignType(aType, bType, diagnostics, constraints), expectedCompatibility);
        if (!expectedCompatibility) {
            const indent = '\u00a0\u00a0';
            const expectedLines = Array.from({ length: 56 }, (_, index) => [
                `${indent}"rel${index}" is an incompatible type`,
                `${indent.repeat(2)}Type "bool | BArgs" is not assignable to type "bool | AArgs"`,
                `${indent.repeat(3)}Type "BArgs" is not assignable to type "bool | AArgs"`,
                `${indent.repeat(4)}"BArgs" is not assignable to "bool"`,
            ]).flat();
            assert.strictEqual(
                diagnostics.getString(undefined, 1000),
                [
                    '',
                    ...expectedLines,
                    `${indent}"value" is an incompatible type`,
                    `${indent.repeat(2)}"str" is not assignable to "int"`,
                ].join('\n')
            );
        }
    } finally {
        spy.mockRestore();
    }
});

test('TypedDict1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict1.py']);

    TestUtils.validateResults(analysisResults, 11);
});

test('TypedDict2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict2.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('TypedDict3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict3.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('TypedDict4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict4.py']);

    TestUtils.validateResults(analysisResults, 7);
});

test('TypedDict5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict5.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('TypedDict6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict6.py']);

    TestUtils.validateResults(analysisResults, 15);
});

test('TypedDict7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict7.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypedDict8', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict8.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('TypedDict9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict9.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('TypedDict10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict10.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('TypedDict11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict11.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypedDict12', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict12.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('TypedDict13', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict13.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('TypedDict14', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict14.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('TypedDict15', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict15.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('TypedDict16', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict16.py']);

    TestUtils.validateResults(analysisResults, 7);
});

test('TypedDict17', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict17.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('TypedDict18', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict18.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('TypedDict19', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict19.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('TypedDict20', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict20.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypedDict21', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict21.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('TypedDict22', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict22.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypedDict23', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict23.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('TypedDict24', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict24.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('TypedDict25', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict25.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypedDict26', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_13;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict26.py'], configOptions);

    TestUtils.validateResults(analysisResults, 1);
});

test('TypedDict27', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_13;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict27.py'], configOptions);

    TestUtils.validateResults(analysisResults, 7);
});

test('TypedDict28', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_13;
    configOptions.defaultPythonPlatform = 'Linux';
    configOptions.defineConstant.set('ENABLE_FAST_PATH', true);
    configOptions.defineConstant.set('FEATURE_SET', 'modern');

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict28.py'], configOptions);

    TestUtils.validateResults(analysisResults, 13);
});

test('TypedDict29', () => {
    const modernConfigOptions = new ConfigOptions(Uri.empty());
    modernConfigOptions.defaultPythonVersion = pythonVersion3_13;
    modernConfigOptions.defaultPythonPlatform = 'Linux';
    modernConfigOptions.defineConstant.set('FEATURE_SET', 'modern');

    const modernResults = TestUtils.typeAnalyzeSampleFiles(['typedDict29.py'], modernConfigOptions);
    TestUtils.validateResults(modernResults, 0);

    const legacyConfigOptions = new ConfigOptions(Uri.empty());
    legacyConfigOptions.defaultPythonVersion = pythonVersion3_10;
    legacyConfigOptions.defaultPythonPlatform = 'Windows';
    legacyConfigOptions.defineConstant.set('FEATURE_SET', 'legacy');

    const legacyResults = TestUtils.typeAnalyzeSampleFiles(['typedDict29.py'], legacyConfigOptions);
    TestUtils.validateResults(legacyResults, 3);

    const repeatedModernResults = TestUtils.typeAnalyzeSampleFiles(['typedDict29.py'], modernConfigOptions);
    TestUtils.validateResults(repeatedModernResults, 0);
});

test('TypedDict31', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_13;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict31.py'], configOptions);

    TestUtils.validateResults(analysisResults, 1);
    assert.deepStrictEqual(
        analysisResults[0].errors.map((diagnostic) => [diagnostic.range.start.line + 1, diagnostic.getRule()]),
        [[90, DiagnosticRule.reportAssignmentType]]
    );
});

test('TypedDict32', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_13;
    configOptions.diagnosticRuleSet.strictDictionaryInference = true;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict32.py'], configOptions);

    TestUtils.validateResults(analysisResults, 5);
    assert.deepStrictEqual(
        analysisResults[0].errors.map((diagnostic) => [diagnostic.range.start.line + 1, diagnostic.getRule()]).sort(),
        [
            [102, DiagnosticRule.reportArgumentType],
            [105, DiagnosticRule.reportAssignmentType],
            [118, DiagnosticRule.reportArgumentType],
            [126, DiagnosticRule.reportArgumentType],
            [134, DiagnosticRule.reportArgumentType],
        ]
    );
});

test('TypedDict33', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.defaultPythonVersion = pythonVersion3_13;
    // These typing checks need the typing_extensions stubs, not its runtime package.
    configOptions.diagnosticRuleSet.reportMissingModuleSource = 'none';

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict33.py'], configOptions);

    TestUtils.validateResults(analysisResults, 8);
    assert.strictEqual(
        analysisResults[0].errors.filter((diagnostic) => diagnostic.getRule() === DiagnosticRule.reportAssignmentType)
            .length,
        2
    );
});

test('TypedDictInline1', () => {
    const configOptions = new ConfigOptions(Uri.empty());
    configOptions.diagnosticRuleSet.enableExperimentalFeatures = true;

    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDictInline1.py'], configOptions);
    TestUtils.validateResults(analysisResults, 6);
});

test('TypedDict30', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typedDict30.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ClassVar1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classVar1.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('ClassVar2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classVar2.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('ClassVar3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classVar3.py']);

    TestUtils.validateResults(analysisResults, 13);
});

test('ClassVar4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classVar4.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ClassVar5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classVar5.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('ClassVar6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classVar6.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('ClassVar7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['classVar7.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('TypeVar1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar1.py']);

    TestUtils.validateResults(analysisResults, 3);
});

test('TypeVar2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeVar3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar3.py']);

    TestUtils.validateResults(analysisResults, 12);
});

test('TypeVar4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar4.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('TypeVar5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar5.py']);

    TestUtils.validateResults(analysisResults, 18);
});

test('TypeVar6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar6.py']);

    TestUtils.validateResults(analysisResults, 20);
});

test('TypeVar7', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar7.py']);

    TestUtils.validateResults(analysisResults, 26);
});

test('TypeVar8', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_12;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['typeVar8.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 4);

    configOptions.defaultPythonVersion = pythonVersion3_13;
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['typeVar8.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 2);
});

test('TypeVar9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar9.py']);

    TestUtils.validateResults(analysisResults, 13);
});

test('TypeVar10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar10.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TypeVar11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['typeVar11.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Annotated1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_8;
    const analysisResults38 = TestUtils.typeAnalyzeSampleFiles(['annotated1.py'], configOptions);
    TestUtils.validateResults(analysisResults38, 5);

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults39 = TestUtils.typeAnalyzeSampleFiles(['annotated1.py'], configOptions);
    TestUtils.validateResults(analysisResults39, 3);
});

test('Annotated2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['annotated2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('Circular1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    // This test requires 3.13 or older because 3.14 uses deferred
    // type annotation evaluation.
    configOptions.defaultPythonVersion = pythonVersion3_13;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['circular1.py'], configOptions);

    TestUtils.validateResults(analysisResults, 2);
});

test('Circular2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['circular2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TryExcept1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept1.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('TryExcept2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept2.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TryExcept3', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept3.py']);

    TestUtils.validateResults(analysisResults, 0);
});

test('TryExcept4', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept4.py']);

    TestUtils.validateResults(analysisResults, 4);
});

test('TryExcept5', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept5.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('TryExcept6', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept6.py']);

    TestUtils.validateResults(analysisResults, 1);
});

test('TryExcept8', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept8.py'], configOptions);
    TestUtils.validateResults(analysisResults, 3);
});

test('TryExcept9', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept9.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('TryExcept10', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept10.py']);
    TestUtils.validateResults(analysisResults, 1);
});

test('TryExcept11', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['tryExcept11.py']);
    TestUtils.validateResults(analysisResults, 0);
});

test('TryExcept12', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_13;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['tryExcept12.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 3);

    configOptions.defaultPythonVersion = pythonVersion3_14;
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['tryExcept12.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 1);
});

test('exceptionGroup1', () => {
    const configOptions = new ConfigOptions(Uri.empty());

    configOptions.defaultPythonVersion = pythonVersion3_10;
    const analysisResults1 = TestUtils.typeAnalyzeSampleFiles(['exceptionGroup1.py'], configOptions);
    TestUtils.validateResults(analysisResults1, 46);

    configOptions.defaultPythonVersion = pythonVersion3_11;
    const analysisResults2 = TestUtils.typeAnalyzeSampleFiles(['exceptionGroup1.py'], configOptions);
    TestUtils.validateResults(analysisResults2, 10);
});

test('Del1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['del1.py']);
    TestUtils.validateResults(analysisResults, 6);
});

test('Del2', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['del2.py']);

    TestUtils.validateResults(analysisResults, 2);
});

test('Any1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['any1.py']);

    TestUtils.validateResults(analysisResults, 8);
});

test('Type1', () => {
    const analysisResults = TestUtils.typeAnalyzeSampleFiles(['type1.py']);

    TestUtils.validateResults(analysisResults, 8);
});
