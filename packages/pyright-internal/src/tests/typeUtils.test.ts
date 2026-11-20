/*
 * typeUtils.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Unit tests for typeUtils module.
 */

import * as assert from 'assert';

import { ConstraintSolution } from '../analyzer/constraintSolution';
import { printType, PrintTypeFlags } from '../analyzer/typePrinter';
import {
    applySolvedTypeVars,
    containsLiteralType,
    mapSignatures,
    mapSubtypes,
    transformExpectedType,
    transformTypePair,
} from '../analyzer/typeUtils';
import {
    AnyType,
    ClassType,
    ClassTypeFlags,
    combineTypes,
    FunctionParam,
    FunctionType,
    FunctionTypeFlags,
    isClass,
    isFunction,
    isOverloaded,
    isTypeSame,
    isTypeVar,
    isUnion,
    OverloadedType,
    OverloadResultType,
    Type,
    TypeBase,
    TypeCategory,
    TypeVarScopeType,
    TypeVarType,
    UnionType,
    UnknownType,
    Variance,
} from '../analyzer/types';
import { Uri } from '../common/uri/uri';
import { ParamCategory } from '../parser/parseNodes';

test('Mapping union subtypes does not mutate a shared replacement union', () => {
    const value = ClassType.cloneAsInstance(createClass('Value', 1));
    const other = ClassType.cloneAsInstance(createClass('Other', 2));
    const result = combineTypes([value, other]);
    assert.ok(isUnion(result));

    const first = ClassType.specialize(ClassType.cloneAsInstance(createClass('First', 3)), [result]);
    const second = ClassType.specialize(ClassType.cloneAsInstance(createClass('Second', 4)), [result]);
    const original = TypeBase.cloneForTypeAlias(combineTypes([first, second]), {
        shared: {
            name: 'Alias',
            fullName: 'test.Alias',
            moduleName: 'test',
            fileUri: Uri.empty(),
            typeVarScopeId: 'test.Alias',
            isTypeAliasType: true,
            typeParams: undefined,
            computedVariance: undefined,
        },
        typeArgs: [result],
    });

    assert.ok(
        isTypeSame(
            mapSubtypes(original, () => result),
            result
        )
    );
    assert.strictEqual(result.priv.typeAliasSources, undefined);
});

test('Mapping union subtypes preserves aliases without modifying existing sources', () => {
    const first = ClassType.cloneAsInstance(createClass('A', 1));
    const second = ClassType.cloneAsInstance(createClass('B', 2));
    const third = ClassType.cloneAsInstance(createClass('C', 3));
    const aliasInfo = (name: string) => ({
        shared: {
            name,
            fullName: `test.${name}`,
            moduleName: 'test',
            fileUri: Uri.empty(),
            typeVarScopeId: `test.${name}`,
            isTypeAliasType: true,
            typeParams: undefined,
            computedVariance: undefined,
        },
        typeArgs: undefined,
    });
    const original = TypeBase.cloneForTypeAlias(combineTypes([first, second]), aliasInfo('X'));
    const result = combineTypes([first, second, third]);
    assert.ok(isUnion(original) && isUnion(result));
    const mapped = mapSubtypes(original, () => result);
    assert.ok(isTypeSame(mapped, result));
    assert.strictEqual(result.priv.typeAliasSources, undefined);
    assert.strictEqual(
        printType(mapped, PrintTypeFlags.PEP604, () => UnknownType.create()),
        'X | C'
    );

    const existingAlias = TypeBase.cloneForTypeAlias(combineTypes([first, third]), aliasInfo('Y'));
    assert.ok(isUnion(existingAlias));
    const existingSources = new Set([existingAlias]);
    result.priv.typeAliasSources = existingSources;
    const mappedWithSources = mapSubtypes(original, () => result);
    assert.ok(isUnion(mappedWithSources));
    assert.strictEqual(result.priv.typeAliasSources, existingSources);
    assert.deepStrictEqual([...existingSources], [existingAlias]);
    assert.notStrictEqual(mappedWithSources.priv.typeAliasSources, existingSources);
    assert.deepStrictEqual(mappedWithSources.priv.typeAliasSources, new Set([existingAlias, original]));
});

test('Expected types preserve borrowed bound variables but unify out-of-scope free variables', () => {
    const caller = TypeVarType.cloneForScopeId(
        TypeVarType.createInstance('K'),
        'caller',
        'caller',
        TypeVarScopeType.Function
    );
    const boundCaller = TypeVarType.cloneAsBound(caller);
    const local = TypeVarType.cloneForScopeId(
        TypeVarType.createInstance('V'),
        'local',
        'local',
        TypeVarScopeType.Function
    );

    for (const liveScopes of [[], ['local']]) {
        assert.strictEqual(transformExpectedType(boundCaller, liveScopes, 100), boundCaller);
        assert.strictEqual(boundCaller.priv.scopeId, TypeVarType.makeBoundScopeId('caller'));
        assert.strictEqual(boundCaller.priv.freeTypeVar, caller);
        assert.ok(!TypeVarType.isUnification(boundCaller));
    }

    assert.strictEqual(transformExpectedType(caller, ['caller'], 100), caller);
    assert.strictEqual(transformExpectedType(boundCaller, ['caller'], 100), boundCaller);
    assert.strictEqual(transformExpectedType(local, ['local'], 100), local);
    const unified = transformExpectedType(caller, ['local'], 100);
    assert.ok(isTypeVar(unified));
    assert.ok(TypeVarType.isUnification(unified));
    assert.ok(!TypeVarType.isBound(unified));
    assert.notStrictEqual(unified.priv.scopeId, caller.priv.scopeId);
    assert.strictEqual(caller.priv.scopeId, 'caller');

    const container = createClass('Container');
    container.shared.typeParams.push(caller, local);
    const nested = ClassType.specialize(ClassType.cloneAsInstance(container), [boundCaller, local]);
    const transformed = transformExpectedType(nested, [], 200);
    assert.ok(isClass(transformed));
    assert.strictEqual(transformed.priv.typeArgs?.[0], boundCaller);
    const nestedFree = transformed.priv.typeArgs?.[1];
    assert.ok(nestedFree && isTypeVar(nestedFree) && TypeVarType.isUnification(nestedFree));
});

test('Literal detection keeps cancellation and type-argument options local to each walk', () => {
    const plain = ClassType.cloneAsInstance(createClass('Value'));
    const literal = ClassType.cloneWithLiteral(plain, 1);
    const nested = ClassType.specialize(ClassType.cloneAsInstance(createClass('Container')), [literal]);

    for (let i = 0; i < 3; i++) {
        assert.strictEqual(containsLiteralType(literal), true);
        assert.strictEqual(containsLiteralType(plain), false);
        assert.strictEqual(containsLiteralType(nested, true), true);
        assert.strictEqual(containsLiteralType(nested), false);
        assert.strictEqual(containsLiteralType(nested, false), false);
    }
    assert.strictEqual(nested.priv.typeArgs?.[0], literal);
    assert.strictEqual(plain.priv.literalValue, undefined);
});

test('Literal detection visits callable, union and overload-result components', () => {
    const plain = ClassType.cloneAsInstance(createClass('Value'));
    const literal = ClassType.cloneWithLiteral(plain, 'value');
    const first = createFunction(plain, plain, plain);
    const second = createFunction(plain, plain, literal);
    const overloads = OverloadedType.create([first, second]);
    const union = UnionType.create();
    union.priv.subtypes = [plain, literal];
    const result = OverloadResultType.create([plain, literal], plain, TypeCategory.Any);

    for (const type of [second, overloads, union, result]) {
        assert.strictEqual(containsLiteralType(type), true);
        assert.strictEqual(containsLiteralType(first), false);
    }
});

test('Literal detection does not retain recursion-limit state between walks', () => {
    const recursive = ClassType.cloneAsInstance(createClass('Recursive'));
    recursive.priv.typeArgs = [recursive];
    const literal = ClassType.cloneWithLiteral(ClassType.cloneAsInstance(createClass('Value')), 1);

    assert.strictEqual(containsLiteralType(recursive, true), false);
    assert.strictEqual(containsLiteralType(literal), true);
    assert.strictEqual(containsLiteralType(recursive, true), false);
});

test('Map signatures preserves replaced overloads and their order', () => {
    const unknown = UnknownType.create();
    const any = AnyType.create();
    const first = createFunction(unknown, unknown, unknown);
    const second = createFunction(any, any, any);
    const implementation = createFunction(unknown, any, unknown);
    const original = OverloadedType.create([first, second], implementation);
    const replacement = createFunction(unknown, unknown, any);

    const mapped = mapSignatures(original, (signature) => (signature === first ? replacement : signature));

    assert.ok(mapped && isOverloaded(mapped));
    assert.deepStrictEqual(OverloadedType.getOverloads(mapped), [replacement, second]);
    assert.strictEqual(OverloadedType.getImplementation(mapped), implementation);
    assert.deepStrictEqual(OverloadedType.getOverloads(original), [first, second]);
    assert.strictEqual(
        mapSignatures(first, () => replacement),
        replacement
    );
});

test('Solved callable types preserve parameters and defaults before the first replacement', () => {
    const typeVar = TypeVarType.cloneForScopeId(
        TypeVarType.createInstance('T'),
        'callable-scope',
        'callable',
        TypeVarScopeType.Function
    );
    const plain = ClassType.cloneAsInstance(createClass('Plain'));
    const replacement = ClassType.cloneAsInstance(createClass('Replacement'));
    const source = createFunction(plain, plain, typeVar);
    FunctionType.addParam(source, FunctionParam.create(ParamCategory.Simple, typeVar, undefined, 'second', typeVar));
    FunctionType.addParam(source, FunctionParam.create(ParamCategory.Simple, plain, undefined, 'third'));
    const solution = new ConstraintSolution();
    solution.setType(typeVar, replacement);

    const result = applySolvedTypeVars(source, solution);

    assert.ok(isFunction(result));
    assert.strictEqual(FunctionType.getParamType(result, 0), plain);
    assert.strictEqual(FunctionType.getParamType(result, 1), replacement);
    assert.strictEqual(FunctionType.getParamType(result, 2), plain);
    assert.strictEqual(FunctionType.getParamDefaultType(result, 0), plain);
    assert.strictEqual(FunctionType.getParamDefaultType(result, 1), replacement);
    assert.strictEqual(FunctionType.getParamDefaultType(result, 2), undefined);
    assert.strictEqual(FunctionType.getEffectiveReturnType(result), replacement);
    assert.strictEqual(FunctionType.getParamType(source, 1), typeVar);
    assert.strictEqual(FunctionType.getParamDefaultType(source, 1), typeVar);

    const unrelated = TypeVarType.cloneForScopeId(
        TypeVarType.createInstance('U'),
        'other-scope',
        'other',
        TypeVarScopeType.Function
    );
    const defaultOnly = createFunction(unrelated, typeVar, plain);
    const defaultResult = applySolvedTypeVars(defaultOnly, solution);
    assert.ok(isFunction(defaultResult));
    assert.strictEqual(FunctionType.getParamType(defaultResult, 0), unrelated);
    assert.strictEqual(FunctionType.getParamDefaultType(defaultResult, 0), replacement);
    assert.strictEqual(FunctionType.getEffectiveReturnType(defaultResult), plain);
});

test('Solved callable returns retain existing specialized parameters and defaults', () => {
    const typeVar = TypeVarType.cloneForScopeId(
        TypeVarType.createInstance('T'),
        'return-scope',
        'callable',
        TypeVarScopeType.Function
    );
    const plain = ClassType.cloneAsInstance(createClass('Plain'));
    const specialized = ClassType.cloneAsInstance(createClass('Specialized'));
    const replacement = ClassType.cloneAsInstance(createClass('Replacement'));
    const source = FunctionType.specialize(createFunction(plain, plain, typeVar), {
        parameterTypes: [specialized],
        parameterDefaultTypes: [specialized],
        returnType: typeVar,
    });
    const solution = new ConstraintSolution();
    solution.setType(typeVar, replacement);

    const result = applySolvedTypeVars(source, solution);

    assert.ok(isFunction(result));
    assert.strictEqual(FunctionType.getParamType(result, 0), specialized);
    assert.strictEqual(FunctionType.getParamDefaultType(result, 0), specialized);
    assert.strictEqual(FunctionType.getEffectiveReturnType(result), replacement);
    assert.strictEqual(FunctionType.getEffectiveReturnType(source), typeVar);
});

test('Solved tuple types recompute combined arguments only when elements change', () => {
    const typeVar = TypeVarType.cloneForScopeId(
        TypeVarType.createInstance('T'),
        'tuple-scope',
        'Tuple',
        TypeVarScopeType.Class
    );
    const unrelated = TypeVarType.cloneForScopeId(
        TypeVarType.createInstance('U'),
        'other-scope',
        'Other',
        TypeVarScopeType.Class
    );
    const plain = ClassType.cloneAsInstance(createClass('Plain'));
    const replacement = ClassType.cloneAsInstance(createClass('Replacement'));
    const source = ClassType.cloneAsInstance(createClass('Tuple'));
    source.shared.flags |= ClassTypeFlags.TupleClass;
    source.shared.typeParams = [typeVar];
    source.priv.tupleTypeArgs = [
        { type: typeVar, isUnbounded: false },
        { type: plain, isUnbounded: false },
    ];
    source.priv.typeArgs = [combineTypes([typeVar, plain])];
    const unrelatedSolution = new ConstraintSolution();
    unrelatedSolution.setType(unrelated, replacement);
    assert.strictEqual(applySolvedTypeVars(source, unrelatedSolution), source);

    const solution = new ConstraintSolution();
    solution.setType(typeVar, replacement);
    const result = applySolvedTypeVars(source, solution);

    assert.ok(isClass(result));
    assert.strictEqual(result.priv.tupleTypeArgs?.[0].type, replacement);
    assert.strictEqual(result.priv.tupleTypeArgs?.[1].type, plain);
    assert.ok(result.priv.typeArgs && isTypeSame(result.priv.typeArgs[0], combineTypes([replacement, plain])));
    assert.strictEqual(source.priv.tupleTypeArgs[0].type, typeVar);
});

test('Transform aligned function types', () => {
    const sourceLeaf = UnknownType.create();
    const targetLeaf = AnyType.create();
    const sourceFunction = createFunction(sourceLeaf, sourceLeaf, sourceLeaf);
    const targetFunction = createFunction(targetLeaf, targetLeaf, targetLeaf);

    const result = transformTypePair(sourceFunction, targetFunction, replacePair(sourceLeaf, targetLeaf));

    assert.ok(isFunction(result));
    assert.notStrictEqual(result, sourceFunction);
    assert.strictEqual(FunctionType.getParamType(result, 0), targetLeaf);
    assert.strictEqual(FunctionType.getParamDefaultType(result, 0), targetLeaf);
    assert.strictEqual(FunctionType.getEffectiveReturnType(result), targetLeaf);
    assert.strictEqual(FunctionType.getParamType(sourceFunction, 0), sourceLeaf);
    assert.strictEqual(FunctionType.getParamDefaultType(sourceFunction, 0), sourceLeaf);
    assert.strictEqual(FunctionType.getEffectiveReturnType(sourceFunction), sourceLeaf);
});

test('Transform type variable metadata without changing its identity', () => {
    const sourceLeaf = UnknownType.create();
    const targetLeaf = AnyType.create();
    const sourceTypeVar = TypeVarType.cloneForScopeId(
        TypeVarType.createInstance('T'),
        'source-scope',
        'source',
        TypeVarScopeType.Class
    );
    sourceTypeVar.shared.constraints = [sourceLeaf];
    sourceTypeVar.shared.boundType = sourceLeaf;
    sourceTypeVar.shared.defaultType = sourceLeaf;
    sourceTypeVar.shared.declaredVariance = Variance.Covariant;

    const targetTypeVar = TypeVarType.createInstance('U');
    targetTypeVar.shared.constraints = [targetLeaf];
    targetTypeVar.shared.boundType = targetLeaf;
    targetTypeVar.shared.defaultType = targetLeaf;

    const result = transformTypePair(sourceTypeVar, targetTypeVar, replacePair(sourceLeaf, targetLeaf));

    assert.ok(isTypeVar(result));
    assert.notStrictEqual(result, sourceTypeVar);
    assert.strictEqual(result.shared.name, 'T');
    assert.strictEqual(result.shared.declaredVariance, Variance.Covariant);
    assert.strictEqual(result.priv.scopeId, sourceTypeVar.priv.scopeId);
    assert.deepStrictEqual(result.shared.constraints, [targetLeaf]);
    assert.strictEqual(result.shared.boundType, targetLeaf);
    assert.strictEqual(result.shared.defaultType, targetLeaf);

    const recursiveSource = TypeVarType.createInstance('RecursiveSource');
    const recursiveTarget = TypeVarType.createInstance('RecursiveTarget');
    recursiveSource.shared.boundType = recursiveSource;
    recursiveTarget.shared.boundType = recursiveTarget;
    assert.strictEqual(
        transformTypePair(recursiveSource, recursiveTarget, () => undefined),
        recursiveSource
    );
});

test('Transform aligned class arguments but preserve mismatched wrappers', () => {
    const sourceLeaf = UnknownType.create();
    const targetLeaf = AnyType.create();
    const sourceOther = TypeVarType.createInstance('T');
    const targetOther = TypeVarType.createInstance('T');
    const sourceUnion = UnionType.create();
    sourceUnion.priv.subtypes = [sourceLeaf, sourceOther];
    const targetUnion = UnionType.create();
    targetUnion.priv.subtypes = [targetLeaf, targetOther];

    const wrapper = ClassType.cloneAsInstance(createClass('Wrapper'));
    const sourceClass = ClassType.specialize(
        wrapper,
        [sourceUnion],
        /* isTypeArgExplicit */ true,
        /* includeSubclasses */ false,
        [{ type: sourceLeaf, isUnbounded: true, isOptional: true }]
    );
    const targetClass = ClassType.specialize(
        wrapper,
        [targetUnion],
        /* isTypeArgExplicit */ true,
        /* includeSubclasses */ false,
        [{ type: targetLeaf, isUnbounded: false, isOptional: false }]
    );

    const result = transformTypePair(sourceClass, targetClass, replacePair(sourceLeaf, targetLeaf));

    assert.ok(isClass(result));
    assert.notStrictEqual(result, sourceClass);
    assert.strictEqual(result.priv.typeArgs?.[0].category, sourceUnion.category);
    assert.strictEqual((result.priv.typeArgs?.[0] as typeof sourceUnion).priv.subtypes[0], targetLeaf);
    assert.strictEqual(result.priv.tupleTypeArgs?.[0].type, targetLeaf);
    assert.strictEqual(result.priv.tupleTypeArgs?.[0].isUnbounded, true);
    assert.strictEqual(result.priv.tupleTypeArgs?.[0].isOptional, true);

    const mismatchedTarget = ClassType.specialize(ClassType.cloneAsInstance(createClass('Other')), [targetLeaf]);
    assert.strictEqual(
        transformTypePair(sourceClass, mismatchedTarget, replacePair(sourceLeaf, targetLeaf)),
        sourceClass
    );

    const shortTargetUnion = UnionType.create();
    shortTargetUnion.priv.subtypes = [targetLeaf];
    assert.strictEqual(
        transformTypePair(sourceUnion, shortTargetUnion, replacePair(sourceLeaf, targetLeaf)),
        sourceUnion
    );
});

function createFunction(parameterType: Type, defaultType: Type, returnType: Type) {
    const functionType = FunctionType.createInstance('', '', '', FunctionTypeFlags.None);
    FunctionType.addParam(
        functionType,
        FunctionParam.create(ParamCategory.Simple, parameterType, undefined, 'value', defaultType)
    );
    functionType.shared.declaredReturnType = returnType;
    return functionType;
}

function createClass(name: string, typeSourceId = 0) {
    return ClassType.createInstantiable(
        name,
        'test',
        `test.${name}`,
        Uri.empty(),
        ClassTypeFlags.None,
        typeSourceId,
        /* declaredMetaclass */ undefined,
        /* effectiveMetaclass */ undefined
    );
}

function replacePair(source: Type, target: Type) {
    return (sourceNode: Type, targetNode: Type) =>
        sourceNode === source && targetNode === target ? targetNode : undefined;
}
