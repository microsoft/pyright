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
    FunctionParam,
    FunctionParamFlags,
    FunctionType,
    FunctionTypeFlags,
    ModuleType,
    NeverType,
    ParamSpecType,
    TypeVarKind,
    TypeVarTupleType,
    TypeVarType,
    UnboundType,
    UnknownType,
} from '../analyzer/types';
import { Uri } from '../common/uri/uri';
import { ParamCategory } from '../parser/parseNodes';

function returnTypeCallback(type: FunctionType) {
    return type.shared.declaredReturnType ?? UnknownType.create(/* isEllipsis */ true);
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

    const paramSpecType = TypeVarType.createInstance('P', TypeVarKind.ParamSpec);
    assert.strictEqual(printType(paramSpecType, PrintTypeFlags.None, returnTypeCallback), 'P');

    const typeVarTupleType = TypeVarType.createInstance('Ts', TypeVarKind.TypeVarTuple);
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

    classTypeA.shared.typeParams.push(typeVarS, typeVarT);

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

    const specializedA = ClassType.specialize(instanceA, [instanceInt, instanceInt]);

    assert.strictEqual(printType(specializedA, PrintTypeFlags.None, returnTypeCallback), 'A[int, int]');

    const unionType = combineTypes([instanceInt, specializedA, typeVarS]);
    assert.strictEqual(printType(unionType, PrintTypeFlags.None, returnTypeCallback), 'Union[int, A[int, int], S]');
    assert.strictEqual(printType(unionType, PrintTypeFlags.PEP604, returnTypeCallback), 'int | A[int, int] | S');
});

test('ClassTypes PythonSyntax omits type args for stub-only generics', () => {
    // Simulate operator.attrgetter — defined in a stub, not built-in, no __class_getitem__.
    const attrgetter = ClassType.createInstantiable(
        'attrgetter',
        'operator',
        'operator.attrgetter',
        Uri.empty(),
        ClassTypeFlags.DefinedInStub,
        0,
        /* declaredMetaclass*/ undefined,
        /* effectiveMetaclass */ undefined
    );

    const typeVarT = TypeVarType.createInstance('_T');
    attrgetter.shared.typeParams.push(typeVarT);

    const classTypeStr = ClassType.createInstantiable(
        'str',
        'builtins',
        'builtins.str',
        Uri.empty(),
        ClassTypeFlags.BuiltIn,
        0,
        /* declaredMetaclass*/ undefined,
        /* effectiveMetaclass */ undefined
    );
    const instanceStr = ClassType.cloneAsInstance(classTypeStr);

    const instanceAttrgetter = ClassType.cloneAsInstance(attrgetter);
    const specialized = ClassType.specialize(instanceAttrgetter, [instanceStr]);

    // Without PythonSyntax, type args are shown normally.
    assert.strictEqual(printType(specialized, PrintTypeFlags.None, returnTypeCallback), 'attrgetter[str]');

    // With PythonSyntax, type args are omitted because the class is not runtime-subscriptable.
    assert.strictEqual(printType(specialized, PrintTypeFlags.PythonSyntax, returnTypeCallback), 'attrgetter');

    // Built-in classes that are also defined in stubs should still show type args in PythonSyntax.
    const listClass = ClassType.createInstantiable(
        'list',
        'builtins',
        'builtins.list',
        Uri.empty(),
        ClassTypeFlags.BuiltIn | ClassTypeFlags.DefinedInStub,
        0,
        /* declaredMetaclass*/ undefined,
        /* effectiveMetaclass */ undefined
    );
    const typeVarE = TypeVarType.createInstance('_E');
    listClass.shared.typeParams.push(typeVarE);

    const instanceList = ClassType.cloneAsInstance(listClass);
    const specializedList = ClassType.specialize(instanceList, [instanceStr]);

    assert.strictEqual(printType(specializedList, PrintTypeFlags.PythonSyntax, returnTypeCallback), 'list[str]');
});

test('ClassTypes PythonSyntax formats ParamSpec-specialized generic arguments', () => {
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

    const paramSpecP = TypeVarType.createInstance('P', TypeVarKind.ParamSpec);
    const typeVarR = TypeVarType.createInstance('R');
    classTypeA.shared.typeParams.push(paramSpecP, typeVarR);

    const instanceA = ClassType.cloneAsInstance(classTypeA);

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

    const classTypeStr = ClassType.createInstantiable(
        'str',
        '',
        '',
        Uri.empty(),
        ClassTypeFlags.None,
        0,
        /* declaredMetaclass*/ undefined,
        /* effectiveMetaclass */ undefined
    );
    const instanceStr = ClassType.cloneAsInstance(classTypeStr);

    const simpleParamSpecValue = FunctionType.createInstance('', '', '', FunctionTypeFlags.ParamSpecValue);
    FunctionType.addParam(
        simpleParamSpecValue,
        FunctionParam.create(ParamCategory.Simple, instanceInt, FunctionParamFlags.TypeDeclared, 'a')
    );

    const specializedA = ClassType.specialize(instanceA, [simpleParamSpecValue, instanceStr]);
    assert.strictEqual(printType(specializedA, PrintTypeFlags.None, returnTypeCallback), 'A[(a: int), str]');
    assert.strictEqual(printType(specializedA, PrintTypeFlags.PythonSyntax, returnTypeCallback), 'A[[int], str]');

    const multiParamSpecValue = FunctionType.createInstance('', '', '', FunctionTypeFlags.ParamSpecValue);
    FunctionType.addParam(
        multiParamSpecValue,
        FunctionParam.create(ParamCategory.Simple, instanceInt, FunctionParamFlags.TypeDeclared, 'a')
    );
    FunctionType.addParam(
        multiParamSpecValue,
        FunctionParam.create(ParamCategory.Simple, instanceStr, FunctionParamFlags.TypeDeclared, 'b')
    );

    assert.strictEqual(
        printType(
            ClassType.specialize(instanceA, [multiParamSpecValue, instanceStr]),
            PrintTypeFlags.PythonSyntax,
            returnTypeCallback
        ),
        'A[[int, str], str]'
    );

    // Positional-only separator (`/`) is a nameless Simple param — it should be
    // skipped in the bracketed form, not cause a Callable fallback.
    const positionalOnlyParamSpecValue = FunctionType.createInstance('', '', '', FunctionTypeFlags.ParamSpecValue);
    FunctionType.addParam(
        positionalOnlyParamSpecValue,
        FunctionParam.create(ParamCategory.Simple, instanceInt, FunctionParamFlags.TypeDeclared, 'a')
    );
    FunctionType.addPositionOnlyParamSeparator(positionalOnlyParamSpecValue);

    assert.strictEqual(
        printType(
            ClassType.specialize(instanceA, [positionalOnlyParamSpecValue, instanceStr]),
            PrintTypeFlags.None,
            returnTypeCallback
        ),
        'A[(a: int, /), str]'
    );

    assert.strictEqual(
        printType(
            ClassType.specialize(instanceA, [positionalOnlyParamSpecValue, instanceStr]),
            PrintTypeFlags.PythonSyntax,
            returnTypeCallback
        ),
        'A[[int], str]'
    );

    const complexParamSpecValue = FunctionType.createInstance('', '', '', FunctionTypeFlags.ParamSpecValue);
    FunctionType.addParam(
        complexParamSpecValue,
        FunctionParam.create(ParamCategory.Simple, instanceInt, FunctionParamFlags.TypeDeclared, 'a')
    );
    FunctionType.addKeywordOnlyParamSeparator(complexParamSpecValue);
    FunctionType.addParam(
        complexParamSpecValue,
        FunctionParam.create(ParamCategory.Simple, instanceStr, FunctionParamFlags.TypeDeclared, 'b')
    );

    assert.strictEqual(
        printType(
            ClassType.specialize(instanceA, [complexParamSpecValue, instanceStr]),
            PrintTypeFlags.PythonSyntax,
            returnTypeCallback
        ),
        'A[Callable[..., Any], str]'
    );
});

test('FunctionTypes', () => {
    const funcTypeA = FunctionType.createInstance('A', '', '', FunctionTypeFlags.None);

    FunctionType.addParam(
        funcTypeA,
        FunctionParam.create(ParamCategory.Simple, AnyType.create(), FunctionParamFlags.TypeDeclared, 'a')
    );

    FunctionType.addPositionOnlyParamSeparator(funcTypeA);

    FunctionType.addParam(
        funcTypeA,
        FunctionParam.create(ParamCategory.ArgsList, AnyType.create(), FunctionParamFlags.TypeDeclared, 'args')
    );

    FunctionType.addParam(
        funcTypeA,
        FunctionParam.create(ParamCategory.KwargsDict, AnyType.create(), FunctionParamFlags.TypeDeclared, 'kwargs')
    );

    funcTypeA.shared.declaredReturnType = NeverType.createNoReturn();

    assert.strictEqual(
        printType(funcTypeA, PrintTypeFlags.None, returnTypeCallback),
        '(a: Any, /, *args: Any, **kwargs: Any) -> NoReturn'
    );
    assert.strictEqual(
        printType(funcTypeA, PrintTypeFlags.PythonSyntax, returnTypeCallback),
        'Callable[..., NoReturn]'
    );

    const funcTypeB = FunctionType.createInstance('B', '', '', FunctionTypeFlags.None);

    FunctionType.addParam(
        funcTypeB,
        FunctionParam.create(ParamCategory.Simple, AnyType.create(), FunctionParamFlags.TypeDeclared, 'a')
    );

    FunctionType.addPositionOnlyParamSeparator(funcTypeB);

    const paramSpecP = TypeVarType.createInstance('P', TypeVarKind.ParamSpec);
    FunctionType.addParamSpecVariadics(funcTypeB, paramSpecP as ParamSpecType);

    funcTypeB.shared.declaredReturnType = NeverType.createNever();

    assert.strictEqual(printType(funcTypeB, PrintTypeFlags.None, returnTypeCallback), '(a: Any, /, **P) -> Never');
    assert.strictEqual(
        printType(funcTypeB, PrintTypeFlags.PythonSyntax, returnTypeCallback),
        'Callable[Concatenate[Any, P], Never]'
    );

    const funcTypeC = FunctionType.createInstance('C', '', '', FunctionTypeFlags.None);

    const typeVarTupleTs = TypeVarType.createInstance('Ts', TypeVarKind.TypeVarTuple);
    const unpackedTs = TypeVarType.cloneForUnpacked(typeVarTupleTs as TypeVarTupleType);

    FunctionType.addParam(
        funcTypeC,
        FunctionParam.create(ParamCategory.ArgsList, unpackedTs, FunctionParamFlags.TypeDeclared, 'args')
    );

    assert.strictEqual(printType(funcTypeC, PrintTypeFlags.None, returnTypeCallback), '(*args: *Ts) -> Unknown');
    assert.strictEqual(
        printType(funcTypeC, PrintTypeFlags.UseTypingUnpack, returnTypeCallback),
        '(*args: Unpack[Ts]) -> Unknown'
    );
    assert.strictEqual(printType(funcTypeC, PrintTypeFlags.PythonSyntax, returnTypeCallback), 'Callable[..., Any]');

    const funcTypeD = FunctionType.createInstance('D', '', '', FunctionTypeFlags.None);

    funcTypeD.shared.declaredReturnType = AnyType.create();
    FunctionType.addParamSpecVariadics(funcTypeD, paramSpecP as ParamSpecType);

    assert.strictEqual(printType(funcTypeD, PrintTypeFlags.None, returnTypeCallback), '(**P) -> Any');
    assert.strictEqual(printType(funcTypeD, PrintTypeFlags.PythonSyntax, returnTypeCallback), 'Callable[P, Any]');
});
