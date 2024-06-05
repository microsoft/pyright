/*
 * typePrinter.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Unit tests for typePrinter module.
 */

import * as assert from 'assert';

import { printType, PrintTypeFlags } from '../analyzer/typePrinter';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    combineTypes,
    FunctionType,
    FunctionTypeFlags,
    ModuleType,
    NeverType,
    TypeVarType,
    UnboundType,
    UnknownType,
} from '../analyzer/types';
import { Uri } from '../common/uri/uri';
import { ParameterCategory } from '../parser/parseNodes';

function returnTypeCallback(type: FunctionType) {
    return type.details.declaredReturnType ?? UnknownType.create(/* isEllipsis */ true);
}

test('SimpleTypes', () => {
    const anyType = AnyType.create(/* isEllipsis */ false);
    assert.strictEqual(printType(anyType, PrintTypeFlags.None, returnTypeCallback), 'Any');

    const ellipsisType = AnyType.create(/* isEllipsis */ true);
    assert.strictEqual(printType(ellipsisType, PrintTypeFlags.None, returnTypeCallback), '...');

    const unknownType = UnknownType.create();
    assert.strictEqual(printType(unknownType, PrintTypeFlags.None, returnTypeCallback), 'Unknown');
    assert.strictEqual(printType(unknownType, PrintTypeFlags.PrintUnknownWithAny, returnTypeCallback), 'Any');
    assert.strictEqual(printType(unknownType, PrintTypeFlags.PythonSyntax, returnTypeCallback), 'Any');

    const unboundType = UnboundType.create();
    assert.strictEqual(printType(unboundType, PrintTypeFlags.None, returnTypeCallback), 'Unbound');
    assert.strictEqual(printType(unboundType, PrintTypeFlags.PythonSyntax, returnTypeCallback), 'Any');

    const moduleType = ModuleType.create('Test', Uri.empty());
    assert.strictEqual(printType(moduleType, PrintTypeFlags.None, returnTypeCallback), 'Module("Test")');
    assert.strictEqual(printType(moduleType, PrintTypeFlags.PythonSyntax, returnTypeCallback), 'Any');
});

test('TypeVarTypes', () => {
    const typeVarType = TypeVarType.createInstance('T');
    assert.strictEqual(printType(typeVarType, PrintTypeFlags.None, returnTypeCallback), 'T');

    const paramSpecType = TypeVarType.createInstance('P');
    paramSpecType.details.isParamSpec = true;
    assert.strictEqual(printType(paramSpecType, PrintTypeFlags.None, returnTypeCallback), 'P');

    const typeVarTupleType = TypeVarType.createInstance('Ts');
    paramSpecType.details.isVariadic = true;
    assert.strictEqual(printType(typeVarTupleType, PrintTypeFlags.None, returnTypeCallback), 'Ts');
});

test('ClassTypes', () => {
    const classTypeA = ClassType.createInstantiable(
        'A',
        '',
        '',
        Uri.empty(),
        ClassTypeFlags.None,
        0,
        /* declaredMetaclass*/ undefined,
        /* effectiveMetaclass */ undefined
    );

    const typeVarS = TypeVarType.createInstance('S');
    const typeVarT = TypeVarType.createInstance('T');

    classTypeA.details.typeParameters.push(typeVarS, typeVarT);

    assert.strictEqual(printType(classTypeA, PrintTypeFlags.None, returnTypeCallback), 'type[A[S, T]]');

    const instanceA = ClassType.cloneAsInstance(classTypeA);
    assert.strictEqual(printType(instanceA, PrintTypeFlags.None, returnTypeCallback), 'A[S, T]');

    const classTypeInt = ClassType.createInstantiable(
        'int',
        '',
        '',
        Uri.empty(),
        ClassTypeFlags.None,
        0,
        /* declaredMetaclass*/ undefined,
        /* effectiveMetaclass */ undefined
    );
    const instanceInt = ClassType.cloneAsInstance(classTypeInt);

    const specializedA = ClassType.cloneForSpecialization(
        instanceA,
        [instanceInt, instanceInt],
        /* isTypeArgumentExplicit */ true
    );

    assert.strictEqual(printType(specializedA, PrintTypeFlags.None, returnTypeCallback), 'A[int, int]');

    const unionType = combineTypes([instanceInt, specializedA, typeVarS]);
    assert.strictEqual(printType(unionType, PrintTypeFlags.None, returnTypeCallback), 'Union[int, A[int, int], S]');
    assert.strictEqual(printType(unionType, PrintTypeFlags.PEP604, returnTypeCallback), 'int | A[int, int] | S');
});

test('FunctionTypes', () => {
    const funcTypeA = FunctionType.createInstance('A', '', '', FunctionTypeFlags.None);

    FunctionType.addParameter(funcTypeA, {
        category: ParameterCategory.Simple,
        hasDeclaredType: true,
        type: AnyType.create(),
        name: 'a',
    });

    FunctionType.addPositionOnlyParameterSeparator(funcTypeA);

    FunctionType.addParameter(funcTypeA, {
        category: ParameterCategory.ArgsList,
        hasDeclaredType: true,
        type: AnyType.create(),
        name: 'args',
    });

    FunctionType.addParameter(funcTypeA, {
        category: ParameterCategory.KwargsDict,
        hasDeclaredType: true,
        type: AnyType.create(),
        name: 'kwargs',
    });

    funcTypeA.details.declaredReturnType = NeverType.createNoReturn();

    assert.strictEqual(
        printType(funcTypeA, PrintTypeFlags.None, returnTypeCallback),
        '(a: Any, /, *args: Any, **kwargs: Any) -> NoReturn'
    );
    assert.strictEqual(
        printType(funcTypeA, PrintTypeFlags.PythonSyntax, returnTypeCallback),
        'Callable[..., NoReturn]'
    );

    const funcTypeB = FunctionType.createInstance('B', '', '', FunctionTypeFlags.None);

    FunctionType.addParameter(funcTypeB, {
        category: ParameterCategory.Simple,
        hasDeclaredType: true,
        type: AnyType.create(),
        name: 'a',
    });

    FunctionType.addPositionOnlyParameterSeparator(funcTypeB);

    const paramSpecP = TypeVarType.createInstance('P');
    paramSpecP.details.isParamSpec = true;
    FunctionType.addParamSpecVariadics(funcTypeB, paramSpecP);

    funcTypeB.details.declaredReturnType = NeverType.createNever();

    assert.strictEqual(printType(funcTypeB, PrintTypeFlags.None, returnTypeCallback), '(a: Any, /, **P) -> Never');
    assert.strictEqual(
        printType(funcTypeB, PrintTypeFlags.PythonSyntax, returnTypeCallback),
        'Callable[Concatenate[Any, P], Never]'
    );

    const funcTypeC = FunctionType.createInstance('C', '', '', FunctionTypeFlags.None);

    const typeVarTupleTs = TypeVarType.createInstance('Ts');
    typeVarTupleTs.details.isVariadic = true;
    const unpackedTs = TypeVarType.cloneForUnpacked(typeVarTupleTs);

    FunctionType.addParameter(funcTypeC, {
        category: ParameterCategory.ArgsList,
        hasDeclaredType: true,
        type: unpackedTs,
        name: 'args',
    });

    assert.strictEqual(printType(funcTypeC, PrintTypeFlags.None, returnTypeCallback), '(*args: *Ts) -> Unknown');
    assert.strictEqual(
        printType(funcTypeC, PrintTypeFlags.UseTypingUnpack, returnTypeCallback),
        '(*args: Unpack[Ts]) -> Unknown'
    );
    assert.strictEqual(printType(funcTypeC, PrintTypeFlags.PythonSyntax, returnTypeCallback), 'Callable[..., Any]');

    const funcTypeD = FunctionType.createInstance('D', '', '', FunctionTypeFlags.None);

    funcTypeD.details.declaredReturnType = AnyType.create();
    FunctionType.addParamSpecVariadics(funcTypeD, paramSpecP);

    assert.strictEqual(printType(funcTypeD, PrintTypeFlags.None, returnTypeCallback), '(**P) -> Any');
    assert.strictEqual(printType(funcTypeD, PrintTypeFlags.PythonSyntax, returnTypeCallback), 'Callable[P, Any]');
});
