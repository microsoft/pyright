import { TypeServerProtocol } from './protocol/typeServerProtocol';
import { CancellationToken } from 'vscode-languageserver-protocol';

import { Declaration as PyrightDeclaration, DeclarationType } from '../analyzer/declaration';
import * as ParseTreeUtils from '../analyzer/parseTreeUtils';
import * as PyrightTypes from '../analyzer/types';
import { specializeTupleClass } from '../analyzer/typeUtils';
import * as PyrightNodes from '../parser/parseNodes';

import { ITypeServerEvaluator } from './typeServerEvaluator';
import { forEach } from './typeEvalUtils';
import { convertLspUriStringToUri } from './serverUtils';
import { IProgram, ISymbolLookup } from './programTypes';

import * as PylanceUtils from './typeUtils';
import { buildTypeFromDisplay } from './typeProvider';
import {
    fromProtocolDecl,
    fromProtocolNode,
    fromProtocolTypeOrUndefined,
    fromProtocolTypes,
    fromProtocolTypesOrUndefined,
    getParseNodeTypesForDecl,
    IPyrightTypeFactory,
    isClass,
    isEnumLiteral,
} from './typeServerConversionTypes';
import * as ProtocolUtils from './typeServerProtocolUtils';

// A factory that creates type shells to break cycles when deserializing types from the type server.
// Only types returned from this factory should be used. and never cloned once returned from here.
export class TypeShellFactory implements IPyrightTypeFactory {
    readonly evaluator: ITypeServerEvaluator;

    constructor(private readonly _cycleMap: Map<number, PyrightTypes.Type>, private readonly _view: IProgram) {
        // Resolve the evaluator once so the hot type-conversion path doesn't
        // allocate a fresh evaluator on every call.
        this.evaluator = _view.createEvaluator();
    }

    get provider(): IProgram {
        return this._view;
    }

    get symbolLookup(): ISymbolLookup {
        return this._view.symbolLookup;
    }

    set(protocolType: TypeServerProtocol.Type, type: PyrightTypes.Type) {
        this._cycleMap.set(protocolType.id, type);
        return type;
    }

    getType(protocolType: TypeServerProtocol.Type): PyrightTypes.Type {
        if (protocolType.kind === TypeServerProtocol.TypeKind.TypeReference) {
            return this.getTypeReference(protocolType.typeReferenceId);
        }

        return fromProtocolType(protocolType, this, this.symbolLookup);
    }

    getTypeReference(typeReferenceId: number): PyrightTypes.Type {
        const type = this._cycleMap.get(typeReferenceId);
        if (type) {
            return type;
        }

        // Return incomplete unknown type as a cycle placeholder.
        return PyrightTypes.UnknownType.create(true);
    }
}

// Apply a primitive literal value from the protocol ClassType to a Pyright class type.
// This is used in fallback paths (e.g., when fromProtocolDecl returns null or getTypeForDeclaration
// throws) where we build a type from the display string but still need to carry over the literal value.
// Also serves as defense-in-depth if a type server includes a `literalValue` field but omits the
// Literal TypeFlag.
function applyPrimitiveLiteralValue(type: PyrightTypes.Type, protocolType: TypeServerProtocol.Type): PyrightTypes.Type {
    if (!PyrightTypes.isClass(type) || !isClass(protocolType)) {
        return type;
    }
    const lv = protocolType.literalValue;
    if (lv === null || lv === undefined || isEnumLiteral(lv)) {
        return type;
    }
    // Only apply if the type doesn't already have a literal value set.
    if (type.priv.literalValue !== undefined) {
        return type;
    }
    return PyrightTypes.ClassType.cloneWithLiteral(type, lv as PyrightTypes.LiteralValue);
}

function applyTypeFlagsOrUndefined(
    type: PyrightTypes.Type | undefined,
    protocolType: TypeServerProtocol.Type,
    factory: TypeShellFactory
) {
    if (!type) {
        return type;
    }

    return applyTypeFlags(type, protocolType, factory);
}

function applyTypeFlags<T extends PyrightTypes.Type>(
    type: T,
    protocolType: TypeServerProtocol.Type,
    factory: TypeShellFactory
): T {
    let resolvedType = type;

    if (PyrightTypes.isClass(resolvedType) && isClass(protocolType) && protocolType.typeArgs) {
        const tspTypeArgs = protocolType.typeArgs;
        let classType: PyrightTypes.ClassType = resolvedType;

        const resolvedTypeArgs = fromProtocolTypesOrUndefined(tspTypeArgs, factory);

        if (
            tspTypeArgs.length > 0 &&
            (classType.shared.flags & PyrightTypes.ClassTypeFlags.HasCustomClassGetItem) !== 0
        ) {
            classType = PyrightTypes.ClassType.cloneWithNewFlags(
                classType,
                classType.shared.flags & ~PyrightTypes.ClassTypeFlags.HasCustomClassGetItem
            );
        }

        const typeArgs = resolvedTypeArgs ?? tspTypeArgs.map(() => PyrightTypes.UnknownType.create());

        if (
            PyrightTypes.ClassType.isBuiltIn(classType, 'tuple') ||
            tspTypeArgs.some((ta) => (ta.flags & TypeServerProtocol.TypeFlags.Unbound) !== 0) ||
            tspTypeArgs.some((ta) => (ta.flags & TypeServerProtocol.TypeFlags.Optional) !== 0)
        ) {
            const tupleTypeArgs = typeArgs.map((argType) => ({
                type: argType,
                isUnbounded: false,
                isOptional: false,
            }));

            classType = specializeTupleClass(classType, tupleTypeArgs);
        } else {
            classType = PyrightTypes.ClassType.specialize(classType, typeArgs);
        }

        resolvedType = classType as T;
    }

    if (
        resolvedType &&
        PylanceUtils.isTypeFlagSet(resolvedType.flags, PyrightTypes.TypeFlags.Instantiable) &&
        ProtocolUtils.isTypeFlagSet(protocolType.flags, TypeServerProtocol.TypeFlags.Instance)
    ) {
        resolvedType = cloneAsInstance(resolvedType) as T;
    }

    if (resolvedType && ProtocolUtils.isTypeFlagSet(protocolType.flags, TypeServerProtocol.TypeFlags.Literal)) {
        const classType = resolvedType as PyrightTypes.ClassType;
        // Use the actual primitive literal value from the protocol when available,
        // falling back to a placeholder for enum literals or when the value isn't directly usable.
        let literalValue: PyrightTypes.LiteralValue;
        if (
            isClass(protocolType) &&
            protocolType.literalValue !== undefined &&
            !isEnumLiteral(protocolType.literalValue)
        ) {
            literalValue = protocolType.literalValue as PyrightTypes.LiteralValue;
        } else {
            literalValue = new PyrightTypes.SentinelLiteral('placeholder', 'placeholder');
        }
        resolvedType = PyrightTypes.ClassType.cloneWithLiteral(classType, literalValue) as T;
    }

    // No need to clone based on strippedFirstParamType - bindFunctionToClassOrObject handles this
    return resolvedType;
}

function applyTypeArgs(type: TypeServerProtocol.Type, factory: TypeShellFactory) {
    if (!isClass(type)) {
        return;
    }

    fromProtocolTypesOrUndefined(type.typeArgs, factory);
}

function fromProtocolTypeAliasInfo(
    info: TypeServerProtocol.TypeAliasInfo | undefined,
    factory: TypeShellFactory
): void {
    if (!info) {
        return;
    }

    fromProtocolTypesOrUndefined(info.typeParams, factory);
    fromProtocolTypesOrUndefined(info.typeArgs, factory);
}

function fromProtocolLiteralValue(
    value: TypeServerProtocol.LiteralValue | undefined,
    factory: TypeShellFactory,
    symbolLookup: ISymbolLookup
): void {
    if (value === undefined) {
        return;
    }

    if (isEnumLiteral(value)) {
        fromProtocolType(value.itemType, factory, symbolLookup);
    }
}

function fromProtocolSpecializedFunctionTypesOrUndefined(
    specializedTypes: TypeServerProtocol.SpecializedFunctionTypes | undefined,
    factory: TypeShellFactory
): void {
    if (!specializedTypes) {
        return undefined;
    }

    fromProtocolTypes(specializedTypes.parameterTypes, factory);
    fromProtocolTypeOrUndefined(specializedTypes.returnType, factory);

    if (specializedTypes.parameterDefaultTypes) {
        forEach(specializedTypes.parameterDefaultTypes, (t) => {
            fromProtocolTypeOrUndefined(t, factory);
        });
    }
}

// Return the cached `getTypeForDeclaration` result for `decl` if present, or
// evaluate it once and cache it on the snapshot. The cache is bounded by the
// snapshot lifetime and dropped on snapshot increment, so cached entries
// always reflect the current parse tree.
function getOrEvaluateDeclType(
    factory: TypeShellFactory,
    decl: PyrightDeclaration
): { type: PyrightTypes.Type | undefined } {
    const cached = factory.provider.getCachedTypeForDeclaration(decl);
    if (cached) {
        return { type: cached };
    }

    const result = factory.evaluator.getTypeForDeclaration(decl);
    if (result.type) {
        factory.provider.setCachedTypeForDeclaration(decl, result.type);
    }
    return result;
}

// Detect whether a class derives directly from `typing.TypedDict` /
// `typing_extensions.TypedDict` by inspecting its base-argument expressions
// syntactically.
//
// This is needed because in-process pyright, when running inside an
// ExternalProgram (e.g. while pyrefly is the active TSP provider), can fail to
// recognize `class Foo(TypedDict):` as a TypedDict subclass during local
// re-evaluation. The local evaluator returns the class with no
// `TypedDictClass` flag, which silently breaks any feature that gates on
// `ClassType.isTypedDictClass(...)` (most visibly, TypedDict key completions
// like `obj["<here>"]`).
//
// We deliberately use only a syntactic check here. Calling
// `factory.evaluator.getType(arg.d.valueExpr)` to resolve the base would
// re-enter the local type evaluator, which in turn drives the same
// shell-conversion path through `getOrEvaluateDeclType`, causing pathological
// blowup on workspaces with many classes (e.g. pandas stubs).
//
// Limitation: this only catches direct bases textually named `TypedDict` /
// `typing.TypedDict` / `typing_extensions.TypedDict`. Inherited cases like
// `class Bar(Foo):` where `Foo` is itself a TypedDict are not detected here.
// In practice, when the local evaluator successfully resolves `Foo`, its
// TypedDictClass flag is already preserved on `Bar`; the gap we patch is the
// direct-base case the local evaluator misses.
//
// To avoid false positives when a user shadows the name `TypedDict` (e.g.
// `class TypedDict: ...; class Foo(TypedDict): ...`, or
// `from othermod import TypedDict`), we only treat the bare `TypedDict` form
// as a match when the enclosing module imports it from `typing` or
// `typing_extensions`. The dotted forms (`typing.TypedDict` /
// `typing_extensions.TypedDict`) are unambiguous on their own.
function derivesFromTypedDict(classNode: PyrightNodes.ClassNode): boolean {
    let bareImportChecked = false;
    let bareImportIsTypedDict = false;

    for (const arg of classNode.d.arguments) {
        // Skip keyword arguments such as `total=False` or `metaclass=...`.
        if (arg.d.name !== undefined) {
            continue;
        }

        const baseExpr = arg.d.valueExpr;
        if (isDottedTypedDictBaseRef(baseExpr)) {
            return true;
        }

        if (baseExpr.nodeType === PyrightNodes.ParseNodeType.Name && baseExpr.d.value === 'TypedDict') {
            if (!bareImportChecked) {
                bareImportIsTypedDict = isTypedDictImportedFromTyping(classNode);
                bareImportChecked = true;
            }
            if (bareImportIsTypedDict) {
                return true;
            }
        }
    }

    return false;
}

function isDottedTypedDictBaseRef(node: PyrightNodes.ExpressionNode): boolean {
    if (node.nodeType !== PyrightNodes.ParseNodeType.MemberAccess) {
        return false;
    }
    if (node.d.member.d.value !== 'TypedDict') {
        return false;
    }
    const left = node.d.leftExpr;
    if (left.nodeType !== PyrightNodes.ParseNodeType.Name) {
        return false;
    }
    return left.d.value === 'typing' || left.d.value === 'typing_extensions';
}

// Walk the enclosing module's top-level statements and check whether the
// bare name `TypedDict` is bound by `from typing import TypedDict` or
// `from typing_extensions import TypedDict` (without an `as` alias that
// would rename it). Returns false if any top-level definition shadows the
// name, since in that case the syntactic match is unsafe.
function isTypedDictImportedFromTyping(node: PyrightNodes.ParseNode): boolean {
    const moduleNode = ParseTreeUtils.getEnclosingModule(node);
    let importedFromTyping = false;

    for (const statement of moduleNode.d.statements) {
        // Compound statements (class/function) at module scope can shadow the name.
        if (
            (statement.nodeType === PyrightNodes.ParseNodeType.Class ||
                statement.nodeType === PyrightNodes.ParseNodeType.Function) &&
            statement.d.name.d.value === 'TypedDict'
        ) {
            return false;
        }

        if (statement.nodeType !== PyrightNodes.ParseNodeType.StatementList) {
            continue;
        }
        for (const sub of statement.d.statements) {
            if (sub.nodeType === PyrightNodes.ParseNodeType.ImportFrom) {
                const moduleName = sub.d.module.d.nameParts.map((p) => p.d.value).join('.');
                if (moduleName !== 'typing' && moduleName !== 'typing_extensions') {
                    continue;
                }
                for (const importAs of sub.d.imports) {
                    if (importAs.d.name.d.value !== 'TypedDict') {
                        continue;
                    }
                    // `from typing import TypedDict as X` rebinds the name; the bare
                    // local name `TypedDict` no longer refers to typing.TypedDict.
                    if (importAs.d.alias && importAs.d.alias.d.value !== 'TypedDict') {
                        continue;
                    }
                    importedFromTyping = true;
                }
            } else if (
                sub.nodeType === PyrightNodes.ParseNodeType.Assignment ||
                sub.nodeType === PyrightNodes.ParseNodeType.TypeAlias
            ) {
                // Top-level `TypedDict = ...` shadows the imported name.
                const target = sub.nodeType === PyrightNodes.ParseNodeType.Assignment ? sub.d.leftExpr : sub.d.name;
                if (target.nodeType === PyrightNodes.ParseNodeType.Name && target.d.value === 'TypedDict') {
                    return false;
                }
            }
        }
    }

    return importedFromTyping;
}

// Compute a Pyright `ParseNode` from a TSP `Node`. Pyrefly sometimes returns
// declarations whose `node` has an empty URI and zero range (e.g. for built-in
// types like `int` whose source it doesn't track). In that case
// `fromProtocolNode` throws; fall back to any available parsed module's tree
// so callers can still use it as an anchor for `buildTypeFromDisplay`.
function getNodeForProtocolDeclSafe(
    protocolNode: TypeServerProtocol.Node,
    factory: TypeShellFactory,
    hints: PyrightNodes.ParseNodeType[]
): PyrightNodes.ParseNode | undefined {
    if (protocolNode?.uri) {
        try {
            return fromProtocolNode<PyrightNodes.ParseNode>(protocolNode, factory.provider, hints);
        } catch {
            // Fall through to fallback below.
        }
    }

    // Find builtins as our default parse tree.
    const builtins = factory.provider.resolveImport(
        factory.provider.rootPath,
        { nameParts: ['builtins'], leadingDots: 0 },
        CancellationToken.None
    );
    if (builtins) {
        const parseResults = factory.provider.getParseResults(builtins);
        if (parseResults) {
            const parseTree = parseResults.parserOutput.parseTree;
            if (parseTree) {
                return parseTree;
            }
        }
    }

    return undefined;
}

// Resolve a TSP `Declaration` to a Pyright `Declaration`, going through the
// snapshot-scoped protocol-decl cache so we don't re-run `lookupSymbol` for
// the same TSP declaration during a single conversion session. Misses fall
// through to `fromProtocolDecl` and the result (if any) is cached.
function getOrFetchProtocolDecl(
    tspDecl: TypeServerProtocol.Declaration,
    factory: TypeShellFactory,
    symbolLookup: ISymbolLookup
): PyrightDeclaration | undefined {
    const cached = factory.provider.getCachedProtocolDecl(tspDecl);
    if (cached) {
        return cached;
    }

    const decl = fromProtocolDecl(tspDecl, factory.provider, symbolLookup);
    if (decl) {
        factory.provider.setCachedProtocolDecl(tspDecl, decl);
    }
    return decl;
}

function hasOverloadDecorator(node: PyrightNodes.FunctionNode): boolean {
    return (
        node.d.decorators?.some((decorator) => {
            const expr = decorator.d.expr;
            if (expr.nodeType === PyrightNodes.ParseNodeType.Name) {
                return expr.d.value === 'overload';
            }
            if (expr.nodeType === PyrightNodes.ParseNodeType.MemberAccess) {
                const left = expr.d.leftExpr;
                return (
                    left.nodeType === PyrightNodes.ParseNodeType.Name &&
                    (left.d.value === 'typing' || left.d.value === 'typing_extensions') &&
                    expr.d.member.d.value === 'overload'
                );
            }
            return false;
        }) ?? false
    );
}

function hasDecorator(node: PyrightNodes.FunctionNode, decoratorName: string): boolean {
    return (
        node.d.decorators?.some((decorator) => {
            const expr = decorator.d.expr;
            if (expr.nodeType === PyrightNodes.ParseNodeType.Name) {
                return expr.d.value === decoratorName;
            }
            if (expr.nodeType === PyrightNodes.ParseNodeType.MemberAccess) {
                return expr.d.member.d.value === decoratorName;
            }
            return false;
        }) ?? false
    );
}

function hasIncompleteClassMro(type: PyrightTypes.Type | undefined): boolean {
    if (!type || !PyrightTypes.isClass(type)) {
        return false;
    }

    return (
        type.shared.mro.some(
            (base) => PyrightTypes.isUnknown(base) || (PyrightTypes.isClass(base) && base.shared.name === 'Unknown')
        ) ||
        type.shared.baseClasses.some(
            (base) => PyrightTypes.isUnknown(base) || (PyrightTypes.isClass(base) && base.shared.name === 'Unknown')
        )
    );
}

// `buildTypeFromDisplay` rebuilds a class purely from its display name, producing a
// synthetic class with a valid MRO but an empty member table. When we use it to repair
// a class whose MRO collapsed during reconstruction (e.g. a TypedDict base that came back
// as Unknown), the original locally re-evaluated class still carries its directly-declared
// member symbols. Carry those over so symbol-table consumers (most visibly TypedDict key
// completions, which read `getSymbolTable(classType)`) don't see an empty class.
function preserveClassMembers(
    original: PyrightTypes.ClassType,
    rebuilt: PyrightTypes.ClassType
): PyrightTypes.ClassType {
    const originalFields = original.shared.fields;
    const originalTypedDictEntries = original.shared.typedDictEntries;
    const hasFields = !!originalFields && originalFields.size > 0;
    if (!hasFields && !originalTypedDictEntries) {
        return rebuilt;
    }

    // Clone the rebuilt class (and its `shared`) so we don't mutate a cached object
    // shared by other holders.
    const newType = PyrightTypes.TypeBase.cloneType(rebuilt);
    newType.shared = { ...newType.shared };
    if (hasFields) {
        newType.shared.fields = originalFields;
    }
    if (originalTypedDictEntries) {
        newType.shared.typedDictEntries = originalTypedDictEntries;
    }
    return newType;
}

function convertPropertyFunctionType(
    decl: PyrightDeclaration,
    resolvedType: PyrightTypes.Type | undefined,
    factory: TypeShellFactory
): PyrightTypes.Type | undefined {
    if (
        !resolvedType ||
        decl.type !== DeclarationType.Function ||
        decl.node.nodeType !== PyrightNodes.ParseNodeType.Function ||
        !hasDecorator(decl.node, 'property')
    ) {
        return resolvedType;
    }

    if (PyrightTypes.isClass(resolvedType) && PyrightTypes.ClassType.isBuiltIn(resolvedType, 'property')) {
        return resolvedType;
    }

    const propertyType = factory.evaluator.getBuiltInType(decl.node, 'property');
    if (PyrightTypes.isClass(propertyType)) {
        return PyrightTypes.ClassType.cloneAsInstance(propertyType);
    }

    const fallbackPropertyType = buildTypeFromDisplay(decl.node, 'property', factory.evaluator);
    return PyrightTypes.isClass(fallbackPropertyType)
        ? PyrightTypes.ClassType.cloneAsInstance(fallbackPropertyType)
        : resolvedType;
}

function fromProtocolType(
    protocolType: TypeServerProtocol.Type,
    factory: TypeShellFactory,
    symbolLookup: ISymbolLookup
): PyrightTypes.Type {
    switch (protocolType.kind) {
        case TypeServerProtocol.TypeKind.BuiltIn: {
            switch (protocolType.name) {
                case 'unknown': {
                    const possibleType = fromProtocolTypeOrUndefined(protocolType.possibleType, factory);
                    return factory.set(
                        protocolType,
                        possibleType
                            ? PyrightTypes.UnknownType.createPossibleType(possibleType, false)
                            : PyrightTypes.UnknownType.create()
                    );
                }
                case 'any': {
                    return factory.set(protocolType, PyrightTypes.AnyType.create());
                }
                case 'ellipsis': {
                    return factory.set(protocolType, PyrightTypes.AnyType.create(true));
                }
                case 'unbound': {
                    return factory.set(protocolType, PyrightTypes.UnboundType.create());
                }
                case 'never': {
                    return factory.set(protocolType, PyrightTypes.NeverType.createNever());
                }
                case 'noreturn': {
                    return factory.set(protocolType, PyrightTypes.NeverType.createNoReturn());
                }
            }

            return factory.set(protocolType, PyrightTypes.UnknownType.create());
        }
        case TypeServerProtocol.TypeKind.Class: {
            if (!protocolType.declaration) {
                return factory.set(protocolType, PyrightTypes.UnknownType.create());
            }

            const decl = getOrFetchProtocolDecl(protocolType.declaration, factory, symbolLookup);
            if (!decl && protocolType.declaration.kind !== TypeServerProtocol.DeclarationKind.Synthesized) {
                // Compute the node at least.
                const hints = getParseNodeTypesForDecl(protocolType.declaration);
                const node = getNodeForProtocolDeclSafe(protocolType.declaration.node, factory, hints);

                // Declaration not resolvable (e.g., typeshed files not parsed in ExternalProgram,
                // or the external type server sent an empty declaration for a built-in type).
                // Fall back to building a type from the declaration name or inferred class name.
                let className =
                    protocolType.declaration?.kind === TypeServerProtocol.DeclarationKind.Regular
                        ? protocolType.declaration.name
                        : undefined;

                // If no declaration name, try to infer the class name from the literal value type.
                if (!className && protocolType.literalValue !== undefined) {
                    const lv = protocolType.literalValue;
                    if (typeof lv === 'number' || typeof lv === 'bigint') {
                        className = 'int';
                    } else if (typeof lv === 'boolean') {
                        className = 'bool';
                    } else if (typeof lv === 'string') {
                        className = 'str';
                    }
                }

                if (className && node) {
                    const fallbackType = buildTypeFromDisplay(node, className, factory.evaluator);
                    let type =
                        applyTypeFlagsOrUndefined(fallbackType, protocolType, factory) ??
                        PyrightTypes.UnknownType.create();
                    // Apply primitive literal value if present (the Literal flag may not be set
                    // by all external type servers, so also check the literalValue field directly).
                    type = applyPrimitiveLiteralValue(type, protocolType);
                    factory.set(protocolType, type);
                    applyTypeArgs(protocolType, factory);
                    return type;
                }
                return factory.set(protocolType, PyrightTypes.UnknownType.create());
            } else if (!decl) {
                return factory.set(protocolType, PyrightTypes.UnknownType.create());
            }

            let declType: Awaited<ReturnType<typeof factory.evaluator.getTypeForDeclaration>>;
            try {
                declType = getOrEvaluateDeclType(factory, decl);
            } catch (evalErr) {
                // Decorator evaluation (e.g., @dataclass) can crash in the stub context.
                // Fall back to building a simple type from the declaration name.
                const className =
                    protocolType.declaration?.kind !== TypeServerProtocol.DeclarationKind.Synthesized
                        ? protocolType.declaration?.name
                        : undefined;
                if (className) {
                    const fallbackType = buildTypeFromDisplay(decl.node, className, factory.evaluator);
                    if (fallbackType) {
                        let type =
                            applyTypeFlagsOrUndefined(fallbackType, protocolType, factory) ??
                            PyrightTypes.UnknownType.create();
                        type = applyPrimitiveLiteralValue(type, protocolType);
                        factory.set(protocolType, type);
                        applyTypeArgs(protocolType, factory);
                        return type;
                    }
                }
                return factory.set(protocolType, PyrightTypes.UnknownType.create());
            }

            // Verify the returned class name matches what we expect. Decorated classes
            // (e.g., @dataclass) can confuse the ExternalProgram's evaluator into returning
            // the decorator's type instead of the class type. Fall back to buildTypeFromDisplay
            // when the names don't match.
            const expectedName =
                protocolType.declaration?.kind === TypeServerProtocol.DeclarationKind.Regular
                    ? protocolType.declaration.name
                    : undefined;
            if (
                declType.type &&
                PyrightTypes.isClass(declType.type) &&
                expectedName &&
                declType.type.shared.name !== expectedName
            ) {
                const fallbackType = buildTypeFromDisplay(decl.node, expectedName, factory.evaluator);
                if (fallbackType) {
                    const type =
                        applyTypeFlagsOrUndefined(fallbackType, protocolType, factory) ??
                        PyrightTypes.UnknownType.create();
                    factory.set(protocolType, type);
                    applyTypeArgs(protocolType, factory);
                    return type;
                }
            }

            // Only rebuild the class from its display name when its MRO is genuinely
            // incomplete (e.g. a base collapsed to Unknown during reconstruction). Do NOT
            // rebuild merely because the class is generic (protocolType.typeArgs present):
            // buildTypeFromDisplay uses the bare class name and drops typing-alias metadata
            // (List/Dict/Tuple) and TypeVarTuple unpack info, which would turn `List[str]`
            // into `list[str]` and `tuple[*Ts]` into `tuple[Ts]`.
            if (declType.type && PyrightTypes.isClass(declType.type) && hasIncompleteClassMro(declType.type)) {
                const originalClass = declType.type;
                const fallbackName =
                    expectedName ??
                    (decl.node.nodeType === PyrightNodes.ParseNodeType.Class ? decl.node.d.name.d.value : undefined);
                const fallbackType = buildTypeFromDisplay(decl.node, fallbackName ?? 'object', factory.evaluator);
                if (PyrightTypes.isClass(fallbackType)) {
                    declType = { ...declType, type: preserveClassMembers(originalClass, fallbackType) };
                }
            }

            // TypedDictFallback needs special handling to match how createSpecialBuiltInClass
            // handles it in typeEvaluator.ts:
            // 1. Set aliasName to 'TypedDict' so ClassType.isBuiltIn(type, 'TypedDict') returns true
            // 2. Strip SupportsAbstractMethods flag so it doesn't propagate to derived classes
            if (
                declType.type &&
                PyrightTypes.isClass(declType.type) &&
                PyrightTypes.ClassType.isBuiltIn(declType.type, 'TypedDictFallback')
            ) {
                // Clone with alias 'TypedDict' so isBuiltIn checks work correctly
                let fixedType = PyrightTypes.ClassType.cloneForTypingAlias(declType.type, 'TypedDict');

                // Strip SupportsAbstractMethods flag
                if ((fixedType.shared.flags & PyrightTypes.ClassTypeFlags.SupportsAbstractMethods) !== 0) {
                    fixedType = PyrightTypes.ClassType.cloneWithNewFlags(
                        fixedType,
                        fixedType.shared.flags & ~PyrightTypes.ClassTypeFlags.SupportsAbstractMethods
                    );
                }

                declType = { ...declType, type: fixedType };
            }

            // External type servers (e.g., pyrefly) sometimes return a class
            // declaration whose local re-evaluation by the in-process pyright
            // doesn't recognize TypedDict-derived classes. The class comes back
            // as a plain ClassType (flags = 0) instead of having the
            // TypedDictClass flag set. Detect that here by inspecting the
            // class's base-argument expressions and patch the flag so
            // downstream features (e.g., TypedDict key completions) work.
            if (
                declType.type &&
                PyrightTypes.isClass(declType.type) &&
                !PyrightTypes.ClassType.isTypedDictClass(declType.type) &&
                decl.type === DeclarationType.Class &&
                decl.node.nodeType === PyrightNodes.ParseNodeType.Class
            ) {
                if (derivesFromTypedDict(decl.node)) {
                    // Avoid mutating the cached `shared` object in place; clone the
                    // class with the new flags so the TypedDictClass bit doesn't
                    // leak to other holders of the same `shared` reference.
                    const fixedType = PyrightTypes.ClassType.cloneWithNewFlags(
                        declType.type,
                        declType.type.shared.flags | PyrightTypes.ClassTypeFlags.TypedDictClass
                    );
                    declType = { ...declType, type: fixedType };
                }
            }

            let type =
                applyTypeFlagsOrUndefined(declType.type, protocolType, factory) ?? PyrightTypes.UnknownType.create();
            // Apply primitive literal value if present (the Literal flag may not be set
            // by all external type servers, so also check the literalValue field directly).
            type = applyPrimitiveLiteralValue(type, protocolType);
            factory.set(protocolType, type);

            applyTypeArgs(protocolType, factory);
            fromProtocolTypeAliasInfo(protocolType.typeAliasInfo, factory);
            fromProtocolLiteralValue(protocolType.literalValue, factory, symbolLookup);

            return type;
        }
        case TypeServerProtocol.TypeKind.Function: {
            if (!protocolType.declaration) {
                return factory.set(protocolType, PyrightTypes.UnknownType.create());
            }

            const decl = getOrFetchProtocolDecl(protocolType.declaration, factory, symbolLookup);
            if (!decl && protocolType.declaration.kind !== TypeServerProtocol.DeclarationKind.Synthesized) {
                // Compute the node at least.
                const hints = getParseNodeTypesForDecl(protocolType.declaration);
                const node = getNodeForProtocolDeclSafe(protocolType.declaration.node, factory, hints);
                // Declaration not resolvable (e.g., typeshed files not parsed in ExternalProgram).
                // Fall back to building a type from the declaration name.
                const funcName =
                    protocolType.declaration?.kind === TypeServerProtocol.DeclarationKind.Regular
                        ? protocolType.declaration.name
                        : undefined;
                if (funcName && node) {
                    const fallbackType = buildTypeFromDisplay(node, funcName, factory.evaluator);
                    const type =
                        applyTypeFlagsOrUndefined(fallbackType, protocolType, factory) ??
                        PyrightTypes.UnknownType.create();
                    factory.set(protocolType, type);
                    return type;
                }
                return factory.set(protocolType, PyrightTypes.UnknownType.create());
            } else if (!decl) {
                return factory.set(protocolType, PyrightTypes.UnknownType.create());
            }

            const declType = getOrEvaluateDeclType(factory, decl);
            let resolvedType = declType.type;
            resolvedType = convertPropertyFunctionType(decl, resolvedType, factory) ?? resolvedType;

            // For @overload-decorated functions, getTypeForDeclaration returns the
            // post-decoration type. Decorator evaluation of `typing.overload` in
            // ExternalProgram context can fail (typeshed not parsed locally),
            // producing a ClassType instead of a FunctionType. In that case, fall
            // back to the pre-decorated FunctionType via getTypeOfFunction.
            if (
                resolvedType &&
                !PyrightTypes.isFunction(resolvedType) &&
                decl.type === DeclarationType.Function &&
                decl.node.nodeType === PyrightNodes.ParseNodeType.Function &&
                hasOverloadDecorator(decl.node)
            ) {
                const funcResult = factory.evaluator.getTypeOfFunction(decl.node as PyrightNodes.FunctionNode);
                if (funcResult?.functionType) {
                    resolvedType = funcResult.functionType;
                }
            }

            const type =
                applyTypeFlagsOrUndefined(resolvedType, protocolType, factory) ?? PyrightTypes.UnknownType.create();
            factory.set(protocolType, type);

            fromProtocolTypeAliasInfo(protocolType.typeAliasInfo, factory);
            fromProtocolSpecializedFunctionTypesOrUndefined(protocolType.specializedTypes, factory);
            fromProtocolTypeOrUndefined(protocolType.boundToType, factory);
            fromProtocolTypeOrUndefined(protocolType.returnType, factory);

            return type;
        }
        case TypeServerProtocol.TypeKind.Declared: {
            // Fallback for other declared types (rare)
            const decl = getOrFetchProtocolDecl(protocolType.declaration, factory, symbolLookup);
            if (!decl) {
                return factory.set(protocolType, PyrightTypes.UnknownType.create());
            }

            const declType = getOrEvaluateDeclType(factory, decl);
            const type =
                applyTypeFlagsOrUndefined(declType.type, protocolType, factory) ?? PyrightTypes.UnknownType.create();
            factory.set(protocolType, type);
            return type;
        }
        case TypeServerProtocol.TypeKind.Union: {
            const types = fromProtocolTypes(protocolType.subTypes, factory);
            const union = PyrightTypes.combineTypes(types);

            const type = applyTypeFlags(union, protocolType, factory);
            factory.set(protocolType, type);

            fromProtocolTypeAliasInfo(protocolType.typeAliasInfo, factory);
            return type;
        }
        case TypeServerProtocol.TypeKind.Module: {
            const type = PyrightTypes.ModuleType.create(
                protocolType.moduleName,
                convertLspUriStringToUri(protocolType.uri, factory.provider, factory.provider.uriMapper)
            );

            const moduleType = applyTypeFlags(type, protocolType, factory);
            factory.set(protocolType, moduleType);
            return moduleType;
        }
        case TypeServerProtocol.TypeKind.Overloaded: {
            const type = PyrightTypes.OverloadedType.create([]);
            const overloadedType = applyTypeFlags(type, protocolType, factory);
            factory.set(protocolType, overloadedType);

            fromProtocolTypes(protocolType.overloads, factory);
            fromProtocolTypeOrUndefined(protocolType.implementation, factory);

            return overloadedType;
        }
        case TypeServerProtocol.TypeKind.Synthesized: {
            // GeneratedSource types are handled in TypeProvider after binding.
            // Create a UNIQUE placeholder for each Synthesized type. Do NOT use
            // UnknownType.create(true) here — it returns a singleton, and storing the
            // same object at multiple cycleMap keys causes all entries to alias. When
            // the type provider mutates one placeholder in-place, all aliased entries
            // change, producing incorrect results for overloaded functions.
            const placeholderType = {
                category: PyrightTypes.TypeCategory.Unknown,
                flags: PyrightTypes.TypeFlags.Instantiable | PyrightTypes.TypeFlags.Instance,
                props: undefined,
                cached: undefined,
                shared: undefined,
                priv: {
                    isIncomplete: true,
                    possibleType: undefined,
                },
            } as unknown as PyrightTypes.UnknownType;
            const result = factory.set(protocolType, placeholderType);

            // We also need to set any types for the metadata in the synthesized type
            if (protocolType.metadata.module) {
                fromProtocolType(protocolType.metadata.module, factory, symbolLookup);
            }

            return result;
        }
        case TypeServerProtocol.TypeKind.TypeVar: {
            // Resolve the TypeVar's declared type when we can. Two things can
            // prevent that:
            //  1. The declaration isn't resolvable in this context (e.g. the
            //     external type server pointed at a file we can't load).
            //  2. The declaration resolves, but our in-process evaluator can't
            //     evaluate it — this is the common case for TypeVars defined in
            //     the external server's bundled typeshed (e.g. `typing.overload`'s
            //     `_F = TypeVar("_F")`), where evaluation yields Unbound/Unknown.
            // In both cases we synthesize a TypeVar from the protocol-provided
            // name below so the rendered signature shows the TypeVar instead of
            // `Unknown`.
            let resolvedType: PyrightTypes.Type | undefined;
            const declName =
                protocolType.declaration && 'name' in protocolType.declaration
                    ? protocolType.declaration.name
                    : undefined;

            if (protocolType.declaration) {
                const decl = getOrFetchProtocolDecl(protocolType.declaration, factory, symbolLookup);
                if (decl) {
                    const declType = getOrEvaluateDeclType(factory, decl);
                    resolvedType = declType.type;

                    if (
                        (!resolvedType || PyrightTypes.isUnknown(resolvedType)) &&
                        decl.type === DeclarationType.Variable
                    ) {
                        const nameNode = decl.node;
                        if (nameNode.nodeType === PyrightNodes.ParseNodeType.Name) {
                            const symbol = symbolLookup.lookupSymbol(nameNode, nameNode.d.value);
                            if (symbol) {
                                const effectiveType = factory.evaluator.getEffectiveTypeOfSymbol(symbol);
                                if (PyrightTypes.isTypeVar(effectiveType)) {
                                    resolvedType = effectiveType;
                                }
                            }
                        }
                    }
                }
            }

            // Fall back to a synthesized TypeVar from the protocol name when the
            // declaration couldn't be resolved or evaluated to a TypeVar.
            if ((!resolvedType || !PyrightTypes.isTypeVar(resolvedType)) && declName) {
                resolvedType = PyrightTypes.TypeVarType.createInstance(declName);
            }

            const typeVar =
                applyTypeFlagsOrUndefined(resolvedType, protocolType, factory) ?? PyrightTypes.UnknownType.create();

            const finalType: PyrightTypes.Type = typeVar;

            if (PyrightTypes.isTypeVar(finalType) && isInstanceHandle(protocolType)) {
                finalType.flags =
                    (finalType.flags | PyrightTypes.TypeFlags.Instance) & ~PyrightTypes.TypeFlags.Instantiable;
            }

            factory.set(protocolType, finalType);

            return finalType;
        }
        case TypeServerProtocol.TypeKind.TypeReference: {
            // Return if we have cycle for the given type reference id.
            return factory.getTypeReference(protocolType.typeReferenceId);
        }
    }

    return PyrightTypes.UnknownType.create();
}

function cloneAsInstance(type: PyrightTypes.Type): PyrightTypes.Type {
    switch (type.category) {
        case PyrightTypes.TypeCategory.Class:
            return PyrightTypes.ClassType.cloneAsInstance(type);
        case PyrightTypes.TypeCategory.Function:
            return PyrightTypes.FunctionType.cloneAsInstance(type);
        case PyrightTypes.TypeCategory.TypeVar:
            return PyrightTypes.TypeVarType.cloneAsInstance(type);
        case PyrightTypes.TypeCategory.Overloaded:
        case PyrightTypes.TypeCategory.Module:
        case PyrightTypes.TypeCategory.Never:
        case PyrightTypes.TypeCategory.Union:
        case PyrightTypes.TypeCategory.Any:
        case PyrightTypes.TypeCategory.Unknown:
        case PyrightTypes.TypeCategory.Unbound:
            return type;
    }

    return type;
}

function isInstanceHandle(handle: TypeServerProtocol.Type): boolean {
    return (handle.flags & TypeServerProtocol.TypeFlags.Instance) !== 0;
}
