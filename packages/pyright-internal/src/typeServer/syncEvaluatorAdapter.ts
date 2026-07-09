/*
 * syncEvaluatorAdapter.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Option B adapter: implement the async `IAsyncTypeEvaluator` surface the type server
 * was written against by delegating to Pyright's *synchronous* `TypeEvaluator`.
 *
 * The type server originally targeted an asynchronous fork of Pyright's evaluator so it
 * could yield mid-evaluation and cooperate with snapshot-based cancellation. For the
 * standalone Pyright type server we keep Pyright's evaluator unforked and instead wrap it:
 * every async method resolves immediately with the synchronous result. Cancellation is
 * still honored through Pyright's own `runWithCancellationToken` /
 * `OperationCanceledException` machinery, which the sync evaluator already implements.
 *
 * `createTypeEvaluatorCaches` / `TypeEvaluatorCaches` are retained as no-op stubs so the
 * program wrapper (`asyncWrapper.ts`) can keep its snapshot-reset bookkeeping unchanged.
 */

import { CancellationToken } from 'vscode-languageserver-protocol';

import { Program } from '../analyzer/program';
import { Declaration } from '../analyzer/declaration';
import { SymbolWithScope } from '../analyzer/scope';
import { Symbol } from '../analyzer/symbol';
import {
    AbstractSymbol,
    Arg,
    CallSignatureInfo,
    CallSiteEvaluationInfo,
    ClassTypeResult,
    DeclaredSymbolTypeInfo,
    EvaluatorUsage,
    ExpectedTypeResult,
    FunctionTypeResult,
    PrintTypeOptions,
    ResolveAliasOptions,
    SymbolDeclInfo,
    TypeEvaluator,
    TypeResult,
} from '../analyzer/typeEvaluatorTypes';
import { PrintTypeFlags } from '../analyzer/typePrinter';
import { ClassType, FunctionType, OverloadedType, Type, TypeVarType } from '../analyzer/types';
import { ClassMember, MemberAccessFlags } from '../analyzer/typeUtils';
import {
    CallNode,
    ClassNode,
    ExpressionNode,
    FunctionNode,
    NameNode,
    ParseNode,
    StringNode,
} from '../parser/parseNodes';

import { IAsyncTypeEvaluator } from './asyncTypeEvaluatorTypes';
import { IAsyncSymbolLookup } from './programTypes';

/**
 * Placeholder for the per-evaluator caches the async fork used to carry across calls.
 * Pyright's synchronous evaluator owns its own caches, so nothing is stored here.
 */
export type TypeEvaluatorCaches = Record<string, never>;

export function createTypeEvaluatorCaches(): TypeEvaluatorCaches {
    return {};
}

/**
 * Build an `IAsyncTypeEvaluator` backed by the `Program`'s synchronous `TypeEvaluator`.
 *
 * The evaluator is resolved lazily on each call via `program.evaluator` so the adapter
 * always talks to the evaluator for the program's current snapshot (the program recreates
 * its evaluator when configuration or imports change).
 */
export function createTypeEvaluator(program: Program, symbolLookup: IAsyncSymbolLookup): IAsyncTypeEvaluator {
    return new SyncToAsyncEvaluatorAdapter(program, symbolLookup);
}

class SyncToAsyncEvaluatorAdapter implements IAsyncTypeEvaluator {
    constructor(private readonly _program: Program, private readonly _symbolLookup: IAsyncSymbolLookup) {}

    runWithCancellationToken<T>(token: CancellationToken, callback: () => T): T;
    runWithCancellationToken<T>(token: CancellationToken, callback: () => Promise<T>): Promise<T>;
    runWithCancellationToken<T>(token: CancellationToken, callback: () => T | Promise<T>): T | Promise<T> {
        return this._eval.runWithCancellationToken(token, callback as () => T);
    }

    getType(node: ExpressionNode): Promise<Type | undefined> {
        return Promise.resolve(this._eval.getType(node));
    }

    getTypeResult(node: ExpressionNode): Promise<TypeResult | undefined> {
        return Promise.resolve(this._eval.getTypeResult(node));
    }

    getTypeOfClass(node: ClassNode): Promise<ClassTypeResult | undefined> {
        return Promise.resolve(this._eval.getTypeOfClass(node));
    }

    getTypeOfFunction(node: FunctionNode): Promise<FunctionTypeResult | undefined> {
        return Promise.resolve(this._eval.getTypeOfFunction(node));
    }

    getExpectedType(node: ExpressionNode): Promise<ExpectedTypeResult | undefined> {
        return Promise.resolve(this._eval.getExpectedType(node));
    }

    getDeclInfoForStringNode(node: StringNode): Promise<SymbolDeclInfo | undefined> {
        return Promise.resolve(this._eval.getDeclInfoForStringNode(node));
    }

    getDeclInfoForNameNode(node: NameNode, skipUnreachableCode?: boolean): Promise<SymbolDeclInfo | undefined> {
        return Promise.resolve(this._eval.getDeclInfoForNameNode(node, skipUnreachableCode));
    }

    getTypeForDeclaration(declaration: Declaration): Promise<DeclaredSymbolTypeInfo> {
        return Promise.resolve(this._eval.getTypeForDeclaration(declaration));
    }

    resolveAliasDeclaration(
        declaration: Declaration,
        resolveLocalNames: boolean,
        options?: ResolveAliasOptions
    ): Promise<Declaration | undefined> {
        return Promise.resolve(this._eval.resolveAliasDeclaration(declaration, resolveLocalNames, options));
    }

    makeTopLevelTypeVarsConcrete(type: Type, makeParamSpecsConcrete?: boolean): Type {
        return this._eval.makeTopLevelTypeVarsConcrete(type, makeParamSpecsConcrete);
    }

    lookUpSymbolRecursive(node: ParseNode, name: string, honorCodeFlow: boolean): Promise<SymbolWithScope | undefined> {
        return Promise.resolve(this._eval.lookUpSymbolRecursive(node, name, honorCodeFlow));
    }

    getEffectiveTypeOfSymbol(symbol: Symbol): Promise<Type> {
        return Promise.resolve(this._eval.getEffectiveTypeOfSymbol(symbol));
    }

    getInferredTypeOfDeclaration(symbol: Symbol, decl: Declaration): Promise<Type | undefined> {
        return Promise.resolve(this._eval.getInferredTypeOfDeclaration(symbol, decl));
    }

    getDeclaredReturnType(node: FunctionNode): Promise<Type | undefined> {
        return Promise.resolve(this._eval.getDeclaredReturnType(node));
    }

    getInferredReturnType(type: FunctionType, callSiteInfo?: CallSiteEvaluationInfo): Promise<Type> {
        return Promise.resolve(this._eval.getInferredReturnType(type, callSiteInfo));
    }

    getBestOverloadForArgs(
        errorNode: ExpressionNode,
        typeResult: TypeResult<OverloadedType>,
        argList: Arg[]
    ): Promise<FunctionType | undefined> {
        return Promise.resolve(this._eval.getBestOverloadForArgs(errorNode, typeResult, argList));
    }

    getBuiltInType(node: ParseNode, name: string): Promise<Type> {
        return Promise.resolve(this._eval.getBuiltInType(node, name));
    }

    warmupPrefetchedTypes(_node: ParseNode): Promise<void> {
        // Pyright's synchronous evaluator initializes prefetched types lazily on first use,
        // so there is nothing to warm up ahead of time.
        return Promise.resolve();
    }

    getTypeOfMember(member: ClassMember): Promise<Type> {
        return Promise.resolve(this._eval.getTypeOfMember(member));
    }

    getTypeOfBoundMember(
        errorNode: ExpressionNode,
        objectType: ClassType,
        memberName: string,
        usage?: EvaluatorUsage,
        flags?: MemberAccessFlags,
        selfType?: ClassType | TypeVarType
    ): Promise<TypeResult | undefined> {
        return Promise.resolve(
            this._eval.getTypeOfBoundMember(
                errorNode,
                objectType,
                memberName,
                usage,
                /* diag */ undefined,
                flags,
                selfType
            )
        );
    }

    getBoundMagicMethod(
        classType: ClassType,
        memberName: string,
        selfType?: ClassType | TypeVarType | undefined,
        errorNode?: ExpressionNode | undefined,
        recursionCount?: number
    ): Promise<FunctionType | OverloadedType | undefined> {
        return Promise.resolve(
            this._eval.getBoundMagicMethod(
                classType,
                memberName,
                selfType,
                errorNode,
                /* diag */ undefined,
                recursionCount
            )
        );
    }

    bindFunctionToClassOrObject(
        baseType: ClassType | undefined,
        memberType: FunctionType | OverloadedType,
        memberClass?: ClassType,
        treatConstructorAsClassMethod?: boolean,
        selfType?: ClassType | TypeVarType,
        recursionCount?: number
    ): Promise<FunctionType | OverloadedType | undefined> {
        return Promise.resolve(
            this._eval.bindFunctionToClassOrObject(
                baseType,
                memberType,
                memberClass,
                treatConstructorAsClassMethod,
                selfType,
                /* diag */ undefined,
                recursionCount
            )
        );
    }

    getCallSignatureInfo(
        node: CallNode,
        activeIndex: number,
        activeOrFake: boolean
    ): Promise<CallSignatureInfo | undefined> {
        return Promise.resolve(this._eval.getCallSignatureInfo(node, activeIndex, activeOrFake));
    }

    getAbstractSymbols(classType: ClassType): Promise<AbstractSymbol[]> {
        return Promise.resolve(this._eval.getAbstractSymbols(classType));
    }

    getBuiltInObject(node: ParseNode, name: string, typeArgs?: Type[]): Promise<Type> {
        return Promise.resolve(this._eval.getBuiltInObject(node, name, typeArgs));
    }

    isExplicitTypeAliasDeclaration(decl: Declaration): Promise<boolean> {
        return Promise.resolve(this._eval.isExplicitTypeAliasDeclaration(decl));
    }

    isFinalVariableDeclaration(decl: Declaration): boolean {
        return this._eval.isFinalVariableDeclaration(decl);
    }

    stripLiteralValue(type: Type): Type {
        return this._eval.stripLiteralValue(type);
    }

    printType(type: Type, options?: PrintTypeOptions): Promise<string> {
        return Promise.resolve(this._eval.printType(type, options));
    }

    printFunctionParts(type: FunctionType, extraFlags?: PrintTypeFlags): Promise<[string[], string]> {
        return Promise.resolve(this._eval.printFunctionParts(type, extraFlags));
    }

    getTypingType(node: ParseNode, symbolName: string): Promise<Type | undefined> {
        return Promise.resolve(this._eval.getTypingType(node, symbolName));
    }

    getSymbolLookup(): IAsyncSymbolLookup {
        return this._symbolLookup;
    }

    private get _eval(): TypeEvaluator {
        const evaluator = this._program.evaluator;
        if (!evaluator) {
            throw new Error('Type evaluator is not available for the current program.');
        }
        return evaluator;
    }
}
