/*
* expressionEvaluator.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Class that evaluates the type of expressions (parse trees)
* within particular contexts and reports type errors.
*/

import * as assert from 'assert';

import { DiagnosticLevel } from '../common/configOptions';
import { DiagnosticAddendum } from '../common/diagnostic';
import { TextRangeDiagnosticSink } from '../common/diagnosticSink';
import { convertOffsetsToRange } from '../common/positionUtils';
import StringMap from '../common/stringMap';
import { TextRange } from '../common/textRange';
import { ArgumentCategory, AssignmentNode, AugmentedAssignmentExpressionNode,
    AwaitExpressionNode, BinaryExpressionNode, CallExpressionNode, ClassNode,
    ConstantNode, DecoratorNode, DictionaryExpandEntryNode, DictionaryKeyEntryNode,
    DictionaryNode, EllipsisNode, ErrorExpressionNode, ExpressionNode,
    IndexExpressionNode, IndexItemsNode, LambdaNode, ListComprehensionForNode,
    ListComprehensionIfNode, ListComprehensionNode, ListNode, MemberAccessExpressionNode,
    NameNode, NumberNode, ParameterCategory, ParseNode, SetNode, SliceExpressionNode,
    StatementListNode, StringListNode, TernaryExpressionNode, TupleExpressionNode,
    TypeAnnotationExpressionNode, UnaryExpressionNode, UnpackExpressionNode,
    YieldExpressionNode, YieldFromExpressionNode } from '../parser/parseNodes';
import { KeywordToken, KeywordType, OperatorType, StringTokenFlags,
    TokenType } from '../parser/tokenizerTypes';
import { ScopeUtils } from '../scopeUtils';
import { AnalyzerFileInfo } from './analyzerFileInfo';
import { AnalyzerNodeInfo } from './analyzerNodeInfo';
import { Declaration, DeclarationCategory } from './declaration';
import { defaultTypeSourceId } from './inferredType';
import { ParseTreeUtils } from './parseTreeUtils';
import { Scope, ScopeType } from './scope';
import { setSymbolPreservingAccess, Symbol } from './symbol';
import { ConditionalTypeConstraintResults, TypeConstraint,
    TypeConstraintBuilder } from './typeConstraint';
import { AnyType, ClassType, ClassTypeFlags, FunctionParameter, FunctionType,
    FunctionTypeFlags, LiteralValue, ModuleType, NeverType, NoneType,
    ObjectType, OverloadedFunctionType, PropertyType, Type, TypeVarMap,
    TypeVarType, UnionType, UnknownType } from './types';
import { ClassMember, ClassMemberLookupFlags, TypeUtils } from './typeUtils';

interface TypeResult {
    type: Type;
    typeList?: TypeResult[];
    node: ExpressionNode;
}

interface FunctionArgument {
    valueExpression?: ExpressionNode;
    argumentCategory: ArgumentCategory;
    name?: NameNode;
    type: Type;
}

interface ClassMemberLookup {
    // Type of value.
    type: Type;

    // True if class member, false otherwise.
    isClassMember: boolean;
}

export enum EvaluatorFlags {
    None = 0,

    // Interpret an ellipsis type annotation to mean "Any".
    ConvertEllipsisToAny = 1,

    // Normally a generic named type is specialized with "Any"
    // types. This flag indicates that specialization shouldn't take
    // place.
    DoNotSpecialize = 2,

    // Allow forward references. Don't report unbound errors.
    AllowForwardReferences = 4
}

interface EvaluatorUsage {
    method: 'get' | 'set' | 'del';
    setType?: Type;
    setErrorNode?: ExpressionNode;
}

export enum MemberAccessFlags {
    None = 0,

    // By default, both class and instance members are considered.
    // Set this flag to skip the instance members.
    SkipInstanceMembers = 1,

    // By default, members of base classes are also searched.
    // Set this flag to consider only the specified class' members.
    SkipBaseClasses = 2,

    // Do not include the "object" base class in the search.
    SkipObjectBaseClass = 4,

    // By default, if the class has a __getattribute__ or __getattr__
    // magic method, it is assumed to have any member.
    SkipGetAttributeCheck = 8,

    // By default, if the class has a __get__ magic method, this is
    // followed to determine the final type. Properties use this
    // technique.
    SkipGetCheck = 16,

    // This set of flags is appropriate for looking up methods.
    SkipForMethodLookup = SkipInstanceMembers | SkipGetAttributeCheck | SkipGetCheck
}

interface ParamAssignmentInfo {
    argsNeeded: number;
    argsReceived: number;
}

export type ReadTypeFromNodeCacheCallback = (node: ExpressionNode) => Type | undefined;
export type WriteTypeToNodeCacheCallback = (node: ExpressionNode, type: Type) => void;
export type SetSymbolAccessedCallback = (symbol: Symbol) => void;

const arithmeticOperatorMap: { [operator: number]: [string, string, boolean] } = {
    [OperatorType.Add]: ['__add__', '__radd__', true],
    [OperatorType.Subtract]: ['__sub__', '__rsub__', true],
    [OperatorType.Multiply]: ['__mul__', '__rmul__', true],
    [OperatorType.FloorDivide]: ['__floordiv__', '__rfloordiv__', true],
    [OperatorType.Divide]: ['__truediv__', '__rtruediv__', true],
    [OperatorType.Mod]: ['__mod__', '__rmod__', true],
    [OperatorType.Power]: ['__pow__', '__rpow__', true],
    [OperatorType.MatrixMultiply]: ['__matmul__', '', false]
};

const bitwiseOperatorMap: { [operator: number]: [string, string] } = {
    [OperatorType.BitwiseAnd]: ['__and__', '__rand__'],
    [OperatorType.BitwiseOr]: ['__or__', '__ror__'],
    [OperatorType.BitwiseXor]: ['__xor__', '__rxor__'],
    [OperatorType.LeftShift]: ['__lshift__', '__rlshift__'],
    [OperatorType.RightShift]: ['__rshift__', '__rrshift__']
};

const comparisonOperatorMap: { [operator: number]: string } = {
    [OperatorType.Equals]: '__eq__',
    [OperatorType.NotEquals]: '__ne__',
    [OperatorType.LessThan]: '__lt__',
    [OperatorType.LessThanOrEqual]: '__le__',
    [OperatorType.GreaterThan]: '__gt__',
    [OperatorType.GreaterThanOrEqual]: '__ge__'
};

const booleanOperatorMap: { [operator: number]: boolean } = {
    [OperatorType.And]: true,
    [OperatorType.Or]: true,
    [OperatorType.Is]: true,
    [OperatorType.IsNot]: true,
    [OperatorType.In]: true,
    [OperatorType.NotIn]: true
};

export class ExpressionEvaluator {
    private _scope: Scope;
    private readonly _fileInfo: AnalyzerFileInfo;
    private _expressionTypeConstraints: TypeConstraint[] = [];
    private _diagnosticSink?: TextRangeDiagnosticSink;
    private _readTypeFromCache?: ReadTypeFromNodeCacheCallback;
    private _writeTypeToCache?: WriteTypeToNodeCacheCallback;
    private _setSymbolAccessed?: SetSymbolAccessedCallback;
    private _isUnboundCheckSuppressed = false;

    constructor(scope: Scope, fileInfo: AnalyzerFileInfo,
            diagnosticSink?: TextRangeDiagnosticSink,
            readTypeCallback?: ReadTypeFromNodeCacheCallback,
            writeTypeCallback?: WriteTypeToNodeCacheCallback,
            setSymbolAccessedCallback?: SetSymbolAccessedCallback) {
        this._scope = scope;
        this._fileInfo = fileInfo;
        this._diagnosticSink = diagnosticSink;
        this._readTypeFromCache = readTypeCallback;
        this._writeTypeToCache = writeTypeCallback;
        this._setSymbolAccessed = setSymbolAccessedCallback;
    }

    getType(node: ExpressionNode, usage: EvaluatorUsage = { method: 'get' }, flags = EvaluatorFlags.None): Type {
        let type = UnknownType.create();

        if (flags & EvaluatorFlags.AllowForwardReferences) {
            this._suppressUnboundChecks(() => {
                type = this._getTypeFromExpression(node, usage, flags).type;
            });
        } else {
            type = this._getTypeFromExpression(node, usage, flags).type;
        }

        return type;
    }

    getTypeFromDecorator(node: DecoratorNode, functionOrClassType: Type): Type {
        const baseTypeResult = this._getTypeFromExpression(
            node.leftExpression, { method: 'get' }, EvaluatorFlags.DoNotSpecialize);

        let decoratorCall = baseTypeResult;

        // If the decorator has arguments, evaluate that call first.
        if (node.arguments) {
            const argList = node.arguments.map(arg => {
                return {
                    valueExpression: arg.valueExpression,
                    argumentCategory: arg.argumentCategory,
                    name: arg.name,
                    type: this.getType(arg.valueExpression)
                };
            });

            // Evaluate the decorator, but don't specialize the
            // return result.
            decoratorCall = this._getTypeFromCallExpressionWithBaseType(
                node.leftExpression, argList, decoratorCall,
                EvaluatorFlags.None, undefined, false);
        }

        const argList = [{
            argumentCategory: ArgumentCategory.Simple,
            type: functionOrClassType
        }];

        return this._getTypeFromCallExpressionWithBaseType(
            node.leftExpression, argList, decoratorCall, EvaluatorFlags.None,
                undefined, false).type;
    }

    // Gets a member type from an object and if it's a function binds
    // it to the object.
    getTypeFromObjectMember(errorNode: ParseNode, objectType: ObjectType, memberName: string,
            usage: EvaluatorUsage, memberAccessFlags = MemberAccessFlags.None): Type | undefined {

        const memberInfo = this._getTypeFromClassMemberName(errorNode,
            objectType.getClassType(), memberName, usage, memberAccessFlags);

        let resultType = memberInfo ? memberInfo.type : undefined;
        if (resultType instanceof FunctionType || resultType instanceof OverloadedFunctionType) {
            if (memberInfo!.isClassMember) {
                resultType = TypeUtils.bindFunctionToClassOrObject(objectType, resultType);
            }
        }

        return resultType;
    }

    // Gets a member type from a class and if it's a function binds
    // it to the object.
    getTypeFromClassMember(errorNode: ParseNode, classType: ClassType, memberName: string,
            usage: EvaluatorUsage, memberAccessFlags = MemberAccessFlags.None): Type | undefined {

        const memberInfo = this._getTypeFromClassMemberName(errorNode,
            classType, memberName, usage, memberAccessFlags | MemberAccessFlags.SkipInstanceMembers);

        let resultType = memberInfo ? memberInfo.type : undefined;
        if (resultType instanceof FunctionType || resultType instanceof OverloadedFunctionType) {
            if (memberInfo!.isClassMember) {
                resultType = TypeUtils.bindFunctionToClassOrObject(classType, resultType);
            }
        }

        return resultType;
    }

    // Applies an "await" operation to the specified type and returns
    // the result. According to PEP 492, await operates on:
    // 1) a generator object
    // 2) an Awaitable (object that provides an __await__ that
    //    returns a generator object)
    // If errorNode is undefined, no errors are reported.
    getTypeFromAwaitable(type: Type, errorNode?: ParseNode): Type {
        return TypeUtils.doForSubtypes(type, subtype => {
            if (subtype.isAny()) {
                return subtype;
            }

            const generatorReturnType = this._getReturnTypeFromGenerator(subtype);
            if (generatorReturnType) {
                return generatorReturnType;
            }

            if (subtype instanceof ObjectType) {
                const awaitReturnType = this._getSpecializedReturnType(
                    subtype, '__await__');
                if (awaitReturnType) {
                    if (awaitReturnType.isAny()) {
                        return awaitReturnType;
                    }

                    if (awaitReturnType instanceof ObjectType) {
                        const iterReturnType = this._getSpecializedReturnType(
                            awaitReturnType, '__iter__');

                        if (iterReturnType) {
                            const generatorReturnType = this._getReturnTypeFromGenerator(
                                awaitReturnType);
                            if (generatorReturnType) {
                                return generatorReturnType;
                            }
                        }
                    }
                }
            }

            if (errorNode) {
                this._addError(`'${ subtype.asString() }' is not awaitable`, errorNode);
            }

            return UnknownType.create();
        });
    }

    // Validates that the type is iterable and returns the iterated type.
    // If errorNode is undefined, no errors are reported.
    getTypeFromIterable(type: Type, isAsync: boolean, errorNode: ParseNode | undefined,
            supportGetItem: boolean): Type {

        const iterMethodName = isAsync ? '__aiter__' : '__iter__';
        const nextMethodName = isAsync ? '__anext__' : '__next__';
        const getItemMethodName = supportGetItem ? '__getitem__' : '';

        if (type instanceof UnionType && type.getTypes().some(t => t instanceof NoneType)) {
            if (errorNode) {
                this._addDiagnostic(
                    this._fileInfo.diagnosticSettings.reportOptionalIterable,
                    `Object of type 'None' cannot be used as iterable value`,
                    errorNode);
            }
            type = TypeUtils.removeNoneFromUnion(type);
        }

        const getIteratorReturnType = (objType: ObjectType, metaclass: ClassType | undefined,
                diag: DiagnosticAddendum): Type | undefined => {

            const iterReturnType = metaclass ?
                this._getSpecializedReturnTypeForMetaclassMethod(metaclass,
                    objType.getClassType(), iterMethodName) :
                this._getSpecializedReturnType(objType, iterMethodName);
            if (!iterReturnType) {
                // There was no __iter__. See if we can fall back to
                // the __getitem__ method instead.
                if (getItemMethodName) {
                    const getItemReturnType = this._getSpecializedReturnType(
                        objType, getItemMethodName);
                    if (getItemReturnType) {
                        return getItemReturnType;
                    }
                }

                diag.addMessage(`'${ iterMethodName }' method not defined`);
            } else {
                if (iterReturnType.isAny()) {
                    return iterReturnType;
                }

                if (iterReturnType instanceof ObjectType) {
                    const nextReturnType = this._getSpecializedReturnType(
                        iterReturnType, nextMethodName);

                    if (!nextReturnType) {
                        diag.addMessage(`'${ nextMethodName }' method not defined on type ` +
                            `'${ iterReturnType.asString() }'`);
                    } else {
                        if (!isAsync) {
                            return nextReturnType;
                        }

                        // If it's an async iteration, there's an implicit
                        // 'await' operator applied.
                        return this.getTypeFromAwaitable(nextReturnType, errorNode);
                    }
                } else {
                    diag.addMessage(`'${ iterMethodName }' method does not return an object`);
                }
            }

            return undefined;
        };

        return TypeUtils.doForSubtypes(type, subtype => {
            if (subtype.isAny()) {
                return subtype;
            }

            const diag = new DiagnosticAddendum();
            if (subtype instanceof ObjectType) {
                const returnType = getIteratorReturnType(subtype, undefined, diag);
                if (returnType) {
                    return returnType;
                }
            } else if (subtype instanceof ClassType) {
                // Handle the case where the class itself is iterable.
                // This is true for classes that derive from Enum, for example.
                const metaclassType = TypeUtils.getMetaclass(subtype);
                if (metaclassType) {
                    if (metaclassType instanceof ClassType) {
                        const returnType = getIteratorReturnType(
                            new ObjectType(subtype), metaclassType, diag);
                        if (returnType) {
                            return returnType;
                        }
                    }
                }
            }

            if (errorNode) {
                this._addError(`'${ subtype.asString() }' is not iterable` + diag.getString(),
                    errorNode);
            }

            return UnknownType.create();
        });
    }

    // Validates fields for compatibility with a dataclass and synthesizes
    // an appropriate __new__ and __init__ methods.
    synthesizeDataClassMethods(node: ClassNode, classType: ClassType,
            skipSynthesizeInit: boolean) {

        assert(classType.isDataClass());

        const newType = new FunctionType(
            FunctionTypeFlags.StaticMethod | FunctionTypeFlags.SynthesizedMethod);
        const initType = new FunctionType(
            FunctionTypeFlags.InstanceMethod | FunctionTypeFlags.SynthesizedMethod);
        let sawDefaultValue = false;

        newType.addParameter({
            category: ParameterCategory.Simple,
            name: 'cls',
            type: classType
        });

        newType.setDeclaredReturnType(new ObjectType(classType));

        initType.addParameter({
            category: ParameterCategory.Simple,
            name: 'self',
            type: new ObjectType(classType)
        });

        node.suite.statements.forEach(statementList => {
            if (statementList instanceof StatementListNode) {
                statementList.statements.forEach(statement => {
                    let variableNameNode: NameNode | undefined;
                    let variableType: Type | undefined;
                    let hasDefaultValue = false;

                    if (statement instanceof AssignmentNode) {
                        if (statement.leftExpression instanceof NameNode) {
                            variableNameNode = statement.leftExpression;
                        } else if (statement.leftExpression instanceof TypeAnnotationExpressionNode &&
                                statement.leftExpression.valueExpression instanceof NameNode) {

                            variableNameNode = statement.leftExpression.valueExpression;
                        }

                        variableType = TypeUtils.stripLiteralValue(
                            this.getType(statement.rightExpression, { method: 'get' }));
                        hasDefaultValue = true;
                    } else if (statement instanceof TypeAnnotationExpressionNode) {
                        if (statement.valueExpression instanceof NameNode) {
                            variableNameNode = statement.valueExpression;
                            variableType = TypeUtils.convertClassToObject(
                                this.getType(statement.typeAnnotation, { method: 'get' },
                                    EvaluatorFlags.ConvertEllipsisToAny));
                        }
                    }

                    if (variableNameNode && variableType) {
                        const variableName = variableNameNode.nameToken.value;

                        // If we've already seen a variable with a default value defined,
                        // all subsequent variables must also have default values.
                        if (!hasDefaultValue && sawDefaultValue) {
                            this._addError(`Data fields without default value cannot appear after ` +
                                `data fields with default values`, variableNameNode);
                        }

                        // Add the new variable to the init function.
                        const paramInfo: FunctionParameter = {
                            category: ParameterCategory.Simple,
                            name: variableName,
                            hasDefault: hasDefaultValue,
                            type: variableType
                        };

                        initType.addParameter(paramInfo);
                        newType.addParameter(paramInfo);

                        if (hasDefaultValue) {
                            sawDefaultValue = true;
                        }
                    }
                });
            }
        });

        if (!skipSynthesizeInit) {
            setSymbolPreservingAccess(classType.getClassFields(),
                '__init__', Symbol.createWithType(initType, defaultTypeSourceId));
            setSymbolPreservingAccess(classType.getClassFields(),
                '__new__', Symbol.createWithType(newType, defaultTypeSourceId));
        }
    }

    getTypingType(symbolName: string): Type | undefined {
        const typingImportPath = this._fileInfo.typingModulePath;
        if (!typingImportPath) {
            return undefined;
        }

        const moduleType = this._fileInfo.importMap[typingImportPath];
        if (!(moduleType instanceof ModuleType)) {
            return undefined;
        }

        const symbol = moduleType.getFields().get(symbolName);
        if (!symbol) {
            return undefined;
        }

        return TypeUtils.getEffectiveTypeOfSymbol(symbol);
    }

    private _getReturnTypeFromGenerator(type: Type): Type | undefined {
        if (type.isAny()) {
            return type;
        }

        if (type instanceof ObjectType) {
            // Is this a Generator? If so, return the third
            // type argument, which is the await response type.
            const classType = type.getClassType();
            if (classType.isBuiltIn() && classType.getClassName() === 'Generator') {
                const typeArgs = classType.getTypeArguments();
                if (typeArgs && typeArgs.length >= 3) {
                    return typeArgs[2];
                }
            }
        }

        return undefined;
    }

    private _getSpecializedReturnType(objType: ObjectType, memberName: string) {
        const classMember = TypeUtils.lookUpObjectMember(objType, memberName,
            ClassMemberLookupFlags.SkipInstanceVariables);
        if (!classMember) {
            return undefined;
        }

        if (classMember.symbolType.isAny()) {
            return classMember.symbolType;
        }

        if (classMember.symbolType instanceof FunctionType) {
            const methodType = TypeUtils.bindFunctionToClassOrObject(objType,
                classMember.symbolType) as FunctionType;
            return methodType.getEffectiveReturnType();
        }

        return undefined;
    }

    // This is similar to _getSpecializedReturnType except that
    // the method lookup occurs on a metaclass rather than
    // the object that derives from it.
    private _getSpecializedReturnTypeForMetaclassMethod(
            metaclass: ClassType, classType: ClassType, memberName: string) {

        const classMember = TypeUtils.lookUpObjectMember(
            new ObjectType(metaclass), memberName,
            ClassMemberLookupFlags.SkipInstanceVariables);
        if (!classMember) {
            return undefined;
        }

        if (classMember.symbolType.isAny()) {
            return classMember.symbolType;
        }

        if (classMember.symbolType instanceof FunctionType) {
            const methodType = TypeUtils.bindFunctionToClassOrObject(
                classType, classMember.symbolType, true) as FunctionType;
            return methodType.getEffectiveReturnType();
        }

        return undefined;
    }

    private _getTypeFromExpression(node: ExpressionNode, usage: EvaluatorUsage = { method: 'get' },
            flags = EvaluatorFlags.None): TypeResult {

        // Is this type already cached?
        if (this._readTypeFromCache) {
            const cachedType = this._readTypeFromCache(node);
            if (cachedType) {
                return { type: cachedType, node };
            }
        }

        let typeResult: TypeResult | undefined;

        if (node instanceof NameNode) {
            typeResult = this._getTypeFromName(node, usage, flags);
        } else if (node instanceof MemberAccessExpressionNode) {
            typeResult = this._getTypeFromMemberAccessExpression(node, usage, flags);
        } else if (node instanceof IndexExpressionNode) {
            typeResult = this._getTypeFromIndexExpression(node, usage);
        } else if (node instanceof CallExpressionNode) {
            this._reportUsageErrorForReadOnly(node, usage);
            typeResult = this._getTypeFromCallExpression(node, flags);
        } else if (node instanceof TupleExpressionNode) {
            typeResult = this._getTypeFromTupleExpression(node, usage);
        } else if (node instanceof ConstantNode) {
            this._reportUsageErrorForReadOnly(node, usage);
            typeResult = this._getTypeFromConstantExpression(node);
        } else if (node instanceof StringListNode) {
            this._reportUsageErrorForReadOnly(node, usage);
            if (node.typeAnnotation && !AnalyzerNodeInfo.getIgnoreTypeAnnotation(node)) {
                let typeResult: TypeResult = { node, type: UnknownType.create() };

                // Temporarily suppress checks for unbound variables, since forward
                // references are allowed within string-based annotations.
                this._suppressUnboundChecks(() => {
                    typeResult = this._getTypeFromExpression(node.typeAnnotation!, usage, flags);
                });

                return typeResult;
            }

            const isBytes = (node.strings[0].token.flags & StringTokenFlags.Bytes) !== 0;
            typeResult = { node, type: this._cloneBuiltinTypeWithLiteral(
                isBytes ? 'bytes' : 'str', node.getValue()) };
        } else if (node instanceof NumberNode) {
            this._reportUsageErrorForReadOnly(node, usage);
            typeResult = { node, type: this._cloneBuiltinTypeWithLiteral(
                node.token.isInteger ? 'int' : 'float', node.token.value) };
        } else if (node instanceof EllipsisNode) {
            this._reportUsageErrorForReadOnly(node, usage);
            if ((flags & EvaluatorFlags.ConvertEllipsisToAny) !== 0) {
                typeResult = { type: AnyType.create(true), node };
            } else {
                const ellipsisType = ScopeUtils.getBuiltInType(this._scope, 'ellipsis') ||
                    AnyType.create();
                typeResult = { type: ellipsisType, node };
            }
        } else if (node instanceof UnaryExpressionNode) {
            this._reportUsageErrorForReadOnly(node, usage);
            typeResult = this._getTypeFromUnaryExpression(node);
        } else if (node instanceof BinaryExpressionNode) {
            this._reportUsageErrorForReadOnly(node, usage);
            typeResult = this._getTypeFromBinaryExpression(node);
        } else if (node instanceof AugmentedAssignmentExpressionNode) {
            this._reportUsageErrorForReadOnly(node, usage);
            typeResult = this._getTypeFromAugmentedExpression(node);
        } else if (node instanceof ListNode) {
            typeResult = this._getTypeFromListExpression(node);
        } else if (node instanceof SliceExpressionNode) {
            this._reportUsageErrorForReadOnly(node, usage);
            typeResult = this._getTypeFromSliceExpression(node);
        } else if (node instanceof AwaitExpressionNode) {
            typeResult = this._getTypeFromExpression(
                node.expression, { method: 'get' }, flags);
            typeResult = {
                type: this.getTypeFromAwaitable(typeResult.type, node.expression),
                node
            };
        } else if (node instanceof TernaryExpressionNode) {
            this._reportUsageErrorForReadOnly(node, usage);
            typeResult = this._getTypeFromTernaryExpression(node, flags);
        } else if (node instanceof ListComprehensionNode) {
            this._reportUsageErrorForReadOnly(node, usage);
            typeResult = this._getTypeFromListComprehensionExpression(node);
        } else if (node instanceof DictionaryNode) {
            this._reportUsageErrorForReadOnly(node, usage);
            typeResult = this._getTypeFromDictionaryExpression(node);
        } else if (node instanceof LambdaNode) {
            this._reportUsageErrorForReadOnly(node, usage);
            typeResult = this._getTypeFromLambdaExpression(node);
        } else if (node instanceof SetNode) {
            this._reportUsageErrorForReadOnly(node, usage);
            typeResult = this._getTypeFromSetExpression(node);
        } else if (node instanceof AssignmentNode) {
            this._reportUsageErrorForReadOnly(node, usage);

            // Don't validate the type match for the assignment here. Simply
            // return the type result of the RHS.
            typeResult = this._getTypeFromExpression(node.rightExpression);
        } else if (node instanceof YieldExpressionNode) {
            this._reportUsageErrorForReadOnly(node, usage);
            typeResult = this._getTypeFromYieldExpression(node);
        } else if (node instanceof YieldFromExpressionNode) {
            this._reportUsageErrorForReadOnly(node, usage);
            typeResult = this._getTypeFromYieldFromExpression(node);
        } else if (node instanceof UnpackExpressionNode) {
            const iterType = this._getTypeFromExpression(node.expression, usage).type;
            const type = this.getTypeFromIterable(iterType, false, node, false);
            typeResult = { type, node };
        } else if (node instanceof TypeAnnotationExpressionNode) {
            typeResult = this._getTypeFromExpression(node.typeAnnotation);
        } else if (node instanceof ErrorExpressionNode) {
            // Evaluate the child expression as best we can so the
            // type information is cached for the completion handler.
            this._silenceDiagnostics(() => {
                if (node.child) {
                    this._getTypeFromExpression(node.child);
                }
            });
            typeResult = { type: UnknownType.create(), node };
        }

        if (typeResult) {
            typeResult.type = this._applyTypeConstraint(node, typeResult.type);
        } else {
            // We shouldn't get here. If we do, report an error.
            this._addError(`Unhandled expression type '${ ParseTreeUtils.printExpression(node) }'`, node);
            typeResult = { type: UnknownType.create(), node };
        }

        if (this._writeTypeToCache) {
            this._writeTypeToCache(node, typeResult.type);
        }

        return typeResult;
    }

    private _suppressUnboundChecks(callback: () => void) {
        const wasSupprsesed = this._isUnboundCheckSuppressed;
        this._isUnboundCheckSuppressed = true;

        callback();

        this._isUnboundCheckSuppressed = wasSupprsesed;
    }

    private _getTypeFromName(node: NameNode, usage: EvaluatorUsage,
            flags: EvaluatorFlags): TypeResult {

        const name = node.nameToken.value;
        let type: Type | undefined;

        // Look for the scope that contains the value definition and
        // see if it has a declared type.
        const symbolWithScope = this._scope.lookUpSymbolRecursive(name);

        if (symbolWithScope) {
            const symbol = symbolWithScope.symbol;
            type = TypeUtils.getEffectiveTypeOfSymbol(symbol);

            // Determine whether the name is unbound or possibly unbound. We
            // can skip this check in type stub files because they are not
            // "executed" and support forward references.
            if (!symbolWithScope.isBeyondExecutionScope &&
                    !this._isUnboundCheckSuppressed &&
                    !this._fileInfo.isStubFile && symbol.isInitiallyUnbound()) {

                // Apply type constraints to see if the unbound type is eliminated.
                const initialType = TypeUtils.getInitialTypeOfSymbol(symbol);
                const constrainedType = this._applyTypeConstraint(node, initialType);
                if (constrainedType.isUnbound()) {
                    this._addError(`'${ name }' is unbound`, node);
                } else if (constrainedType.isPossiblyUnbound()) {
                    this._addError(`'${ name }' is possibly unbound`, node);
                }
            }

            if (usage.method === 'get') {
                if (this._setSymbolAccessed) {
                    this._setSymbolAccessed(symbol);
                }
            }
        } else {
            this._addError(`'${ name }' is not defined`, node);
            type = UnknownType.create();
        }

        // Should we specialize the class?
        if ((flags & EvaluatorFlags.DoNotSpecialize) === 0) {
            if (type instanceof ClassType) {
                if (type.getTypeArguments() === undefined) {
                    type = this._createSpecializeClassType(type, undefined, node);
                }
            } else if (type instanceof ObjectType) {
                // If this is an object that contains a Type[X], transform it
                // into class X.
                const typeType = this._getClassFromPotentialTypeObject(type);
                if (typeType) {
                    type = typeType;
                }
            }
        }

        return { type, node };
    }

    private _getTypeFromMemberAccessExpression(node: MemberAccessExpressionNode,
            usage: EvaluatorUsage, flags: EvaluatorFlags): TypeResult {

        const baseTypeResult = this._getTypeFromExpression(node.leftExpression);
        const memberType = this._getTypeFromMemberAccessExpressionWithBaseType(
            node, baseTypeResult, usage, flags);

        if (this._writeTypeToCache) {
            // Cache the type information in the member name node as well.
            this._writeTypeToCache(node.memberName, memberType.type);
        }

        return memberType;
    }

    private _getTypeFromMemberAccessExpressionWithBaseType(node: MemberAccessExpressionNode,
                baseTypeResult: TypeResult, usage: EvaluatorUsage,
                flags: EvaluatorFlags): TypeResult {

        const baseType = baseTypeResult.type;
        const memberName = node.memberName.nameToken.value;
        const diag = new DiagnosticAddendum();

        let type: Type | undefined;

        if (baseType.isAny()) {
            type = baseType;
        } else if (baseType instanceof ClassType) {
            type = this.getTypeFromClassMember(node.memberName, baseType,
                node.memberName.nameToken.value, usage);

            if (!type) {
                diag.addMessage(`Member '${ memberName }' is unknown`);
            }
        } else if (baseType instanceof ObjectType) {
            const classFromTypeObject = this._getClassFromPotentialTypeObject(baseType);
            if (classFromTypeObject) {
                // Handle the case where the object is a 'Type' object, which
                // represents a class.
                return this._getTypeFromMemberAccessExpressionWithBaseType(node,
                   { type: classFromTypeObject, node: baseTypeResult.node }, usage, flags);
            }

            type = this.getTypeFromObjectMember(node.memberName, baseType,
                node.memberName.nameToken.value, usage, MemberAccessFlags.None);
            if (!type) {
                diag.addMessage(`Member '${ memberName }' is unknown`);
            }
        } else if (baseType instanceof ModuleType) {
            const symbol = baseType.getFields().get(memberName);
            if (symbol) {
                if (usage.method === 'get') {
                    if (this._setSymbolAccessed) {
                        this._setSymbolAccessed(symbol);
                    }
                }
                type = TypeUtils.getEffectiveTypeOfSymbol(symbol);
            } else {
                this._addError(`'${ memberName }' is not a known member of module`, node.memberName);
                type = UnknownType.create();
            }
        } else if (baseType instanceof UnionType) {
            const returnTypes: Type[] = [];
            baseType.getTypes().forEach(typeEntry => {
                if (typeEntry instanceof NoneType) {
                    this._addDiagnostic(
                        this._fileInfo.diagnosticSettings.reportOptionalMemberAccess,
                        `'${ memberName }' is not a known member of 'None'`, node.memberName);
                } else {
                    const typeResult = this._getTypeFromMemberAccessExpressionWithBaseType(node,
                        {
                            type: typeEntry,
                            node
                        },
                        usage,
                        EvaluatorFlags.None);

                    if (typeResult) {
                        returnTypes.push(typeResult.type);
                    }
                }
            });

            if (returnTypes.length > 0) {
                type = TypeUtils.combineTypes(returnTypes);
            }
        } else if (baseType instanceof PropertyType) {
            if (memberName === 'getter' || memberName === 'setter' || memberName === 'deleter') {
                // Synthesize a decorator.
                const decoratorType = new FunctionType(
                    FunctionTypeFlags.InstanceMethod | FunctionTypeFlags.SynthesizedMethod);
                decoratorType.addParameter({
                    category: ParameterCategory.Simple,
                    name: 'fn',
                    type: UnknownType.create()
                });
                decoratorType.setDeclaredReturnType(baseType);
                type = decoratorType;
            } else {
                diag.addMessage(`Unknown property member`);
            }
        } else if (baseType instanceof FunctionType || baseType instanceof OverloadedFunctionType) {
            // If we're assigning a value to the __defaults__ member of a function,
            // note that the default value processing for that function should be disabled.
            if (baseType instanceof FunctionType && memberName === '__defaults__') {
                if (usage.method === 'set') {
                    baseType.setDefaultParameterCheckDisabled();
                }
            }

            // TODO - not yet sure what to do about members of functions,
            // which have associated dictionaries.
            type = UnknownType.create();
        } else {
            diag.addMessage(`Unsupported type '${ baseType.asString() }'`);
        }

        if (!type) {
            let operationName = 'access';
            if (usage.method === 'set') {
                operationName = 'assign';
            } else if (usage.method === 'del') {
                operationName = 'delete';
            }

            this._addError(
                `Cannot ${ operationName } member '${ memberName }' ` +
                `for type '${ baseType.asString() }'` + diag.getString(),
                node.memberName);
            type = UnknownType.create();
        }

        // Should we specialize the class?
        if ((flags & EvaluatorFlags.DoNotSpecialize) === 0) {
            if (type instanceof ClassType) {
                type = this._createSpecializeClassType(type, undefined, node);
            }
        }

        return { type, node };
    }

    // If the object type is a 'Type' object, converts it to the corresponding
    // class that it represents and returns that class. Otherwise returns undefined.
    private _getClassFromPotentialTypeObject(potentialTypeObject: ObjectType): Type | undefined {
        const objectClass = potentialTypeObject.getClassType();
        if (objectClass.isBuiltIn() && objectClass.getClassName() === 'Type') {
            const typeArgs = objectClass.getTypeArguments();

            if (typeArgs && typeArgs.length > 0) {
                let firstTypeArg = typeArgs[0];

                // If the type arg is a type var itself, specialize it in
                // case it's bound or constrained.
                if (firstTypeArg instanceof TypeVarType) {
                    firstTypeArg = TypeUtils.specializeTypeVarType(firstTypeArg);
                }

                if (firstTypeArg instanceof ObjectType) {
                    return firstTypeArg.getClassType();
                }
            }

            return AnyType.create();
        }

        return undefined;
    }

    private _getTypeFromClassMemberName(errorNode: ParseNode, classType: ClassType, memberName: string,
            usage: EvaluatorUsage, flags: MemberAccessFlags): ClassMemberLookup | undefined {

        // If this is a special type (like "List") that has an alias
        // class (like "list"), switch to the alias, which defines
        // the members.
        const aliasClass = classType.getAliasClass();
        if (aliasClass) {
            classType = aliasClass;
        }

        let classLookupFlags = ClassMemberLookupFlags.Default;
        if (flags & MemberAccessFlags.SkipInstanceMembers) {
            classLookupFlags |= ClassMemberLookupFlags.SkipInstanceVariables;
        }
        if (flags & MemberAccessFlags.SkipBaseClasses) {
            classLookupFlags |= ClassMemberLookupFlags.SkipBaseClasses;
        }
        if (flags & MemberAccessFlags.SkipObjectBaseClass) {
            classLookupFlags |= ClassMemberLookupFlags.SkipObjectBaseClass;
        }
        const memberInfo = TypeUtils.lookUpClassMember(classType, memberName,
            classLookupFlags);

        if (memberInfo) {
            const makeClassMember = (type: Type): ClassMemberLookup => {
                return {
                    type,
                    isClassMember: !memberInfo.isInstanceMember
                };
            };

            let type = memberInfo.symbolType;

            if (usage.method === 'get') {
                // Mark the member accessed if it's not coming from a parent class.
                if (memberInfo.classType === classType && this._setSymbolAccessed) {
                    this._setSymbolAccessed(memberInfo.symbol);
                }
            }

            if (!(flags & MemberAccessFlags.SkipGetCheck)) {
                if (type instanceof PropertyType) {
                    if (usage.method === 'get') {
                        // Use the property's getter function to determine
                        // the return type.
                        const selfArg: FunctionArgument = {
                            argumentCategory: ArgumentCategory.Simple,
                            type: new ObjectType(classType)
                        };
                        let propertyReturnType = this._validateCallArguments(
                            errorNode, [selfArg], type.getGetter(), new TypeVarMap(), true);
                        if (!propertyReturnType) {
                            propertyReturnType = UnknownType.create();
                        }

                        return makeClassMember(propertyReturnType);
                    } else if (usage.method === 'set') {
                        let setterFunctionType = type.getSetter();
                        if (setterFunctionType) {
                            // Strip off the "self" parameter.
                            setterFunctionType = TypeUtils.stripFirstParameter(setterFunctionType);

                            // Validate that we can call the setter with the specified type.
                            assert(usage.setType !== undefined && usage.setErrorNode !== undefined);
                            const argList: FunctionArgument[] = [];
                            argList.push({ argumentCategory: ArgumentCategory.Simple, type: usage.setType! });
                            this._validateFunctionArguments(usage.setErrorNode || errorNode,
                                argList, setterFunctionType, new TypeVarMap());

                            // The return type isn't imporant here.
                            return makeClassMember(NoneType.create());
                        }

                        return undefined;
                    } else {
                        assert(usage.method === 'del');
                        if (type.hasDeleter()) {
                            return makeClassMember(NoneType.create());
                        }

                        return undefined;
                    }
                } else if (type instanceof ObjectType) {
                    // See if there's a magic "__get__", "__set__", or "__delete__"
                    // method on the object.
                    let accessMethodName: string;

                    if (usage.method === 'get') {
                        accessMethodName = '__get__';
                    } else if (usage.method === 'set') {
                        accessMethodName = '__set__';
                    } else {
                        accessMethodName = '__del__';
                    }

                    const memberClassType = type.getClassType();
                    const getMember = TypeUtils.lookUpClassMember(memberClassType, accessMethodName,
                        ClassMemberLookupFlags.SkipInstanceVariables);
                    if (getMember) {
                        if (getMember.symbolType instanceof FunctionType) {
                            if (usage.method === 'get') {
                                type = getMember.symbolType.getEffectiveReturnType();
                            } else {
                                // The type isn't important for set or delete usage.
                                // We just need to return some defined type.
                                type = AnyType.create();
                            }
                        }

                        return makeClassMember(type);
                    }
                }
            }

            if (usage.method === 'set') {
                let effectiveType = type;

                // If the code is patching a method (defined on the class)
                // with an object-level function, strip the "self" parameter
                // off the original type. This is sometimes done for test
                // purposes to override standard behaviors of specific methods.
                if ((flags & MemberAccessFlags.SkipInstanceMembers) === 0) {
                    if (!memberInfo.isInstanceMember && type instanceof FunctionType) {
                        if (type.isClassMethod() || type.isInstanceMethod()) {
                            effectiveType = TypeUtils.stripFirstParameter(type);
                        }
                    }
                }

                // Verify that the assigned type is compatible.
                const diag = new DiagnosticAddendum();
                if (!TypeUtils.canAssignType(effectiveType, usage.setType!, diag.createAddendum())) {
                    this._addError(
                        `Expression of type '${ usage.setType!.asString() }'` +
                            ` cannot be assigned to member '${ memberName }'` +
                            ` of class '${ classType.asString() }'` +
                            diag.getString(),
                        errorNode);
                }
            }

            return makeClassMember(type);
        }

        if (!(flags & MemberAccessFlags.SkipGetAttributeCheck)) {
            if (usage.method === 'get') {
                // See if the class has a "__getattribute__" or "__getattr__" method.
                // If so, arbitrary members are supported.
                const getAttribType = this.getTypeFromClassMember(errorNode, classType,
                    '__getattribute__', { method: 'get' },
                        MemberAccessFlags.SkipForMethodLookup |
                        MemberAccessFlags.SkipObjectBaseClass);

                if (getAttribType && getAttribType instanceof FunctionType) {
                    return {
                        type: getAttribType.getEffectiveReturnType(),
                        isClassMember: false
                    };
                }

                const getAttrType = this.getTypeFromClassMember(errorNode, classType,
                    '__getattr__', { method: 'get' }, MemberAccessFlags.SkipForMethodLookup);
                if (getAttrType && getAttrType instanceof FunctionType) {
                    return {
                        type: getAttrType.getEffectiveReturnType(),
                        isClassMember: false
                    };
                }
            } else if (usage.method === 'set') {
                const setAttrType = this.getTypeFromClassMember(errorNode, classType,
                    '__setattr__', { method: 'get' },
                        MemberAccessFlags.SkipForMethodLookup | MemberAccessFlags.SkipObjectBaseClass);
                if (setAttrType) {
                    // The type doesn't matter for a set usage. We just need
                    // to return a defined type.
                    return {
                        type: AnyType.create(),
                        isClassMember: false
                    };
                }
            } else {
                assert(usage.method === 'del');
                const delAttrType = this.getTypeFromClassMember(errorNode, classType,
                    '__detattr__', { method: 'get' },
                        MemberAccessFlags.SkipForMethodLookup | MemberAccessFlags.SkipObjectBaseClass);
                if (delAttrType) {
                    // The type doesn't matter for a delete usage. We just need
                    // to return a defined type.
                    return {
                        type: AnyType.create(),
                        isClassMember: false
                    };
                }
            }
        }

        return undefined;
    }

    private _getTypeFromIndexExpression(node: IndexExpressionNode, usage: EvaluatorUsage): TypeResult {
        const baseTypeResult = this._getTypeFromExpression(node.baseExpression,
            { method: 'get' }, EvaluatorFlags.DoNotSpecialize);

        const type = TypeUtils.doForSubtypes(baseTypeResult.type, subtype => {
            if (subtype.isAny()) {
                return subtype;
            } else if (subtype instanceof ClassType) {
                if (subtype.isSpecialBuiltIn() && subtype.getClassName() === 'Literal') {
                    // Special-case Literal types.
                    return this._createLiteralType(node);
                } else if (subtype.isBuiltIn() && subtype.getClassName() === 'InitVar') {
                    // Special-case InitVar, used in data classes.
                    const typeArgs = this._getTypeArgs(node.items);
                    if (typeArgs.length === 1) {
                        return typeArgs[0].type;
                    } else {
                        this._addError(
                            `Expected one type argument for 'InitVar' but got ${ typeArgs.length }`,
                            node.baseExpression);
                        return UnknownType.create();
                    }
                } else if (TypeUtils.isEnumClass(subtype)) {
                    // Special-case Enum types.
                    // TODO - validate that there's only one index entry
                    // that is a str type.
                    return Object(subtype);
                } else {
                    const typeArgs = this._getTypeArgs(node.items);
                    return this._createSpecializeClassType(subtype, typeArgs, node.items);
                }
            } else if (subtype instanceof ObjectType) {
                return this._getTypeFromIndexedObject(node, subtype, usage);
            } else if (subtype instanceof NoneType) {
                this._addDiagnostic(
                    this._fileInfo.diagnosticSettings.reportOptionalSubscript,
                    `Optional of type 'None' cannot be subscripted`,
                    node.baseExpression);

                return UnknownType.create();
            } else {
                this._addError(
                    `Object of type '${ subtype.asString() }' cannot be subscripted`,
                    node.baseExpression);

                return UnknownType.create();
            }
        });

        // In case we didn't walk the list items above, do so now.
        // If we have, this information will be cached.
        node.items.items.forEach(item => {
            this._getTypeFromExpression(item);
        });

        return { type, node };
    }

    private _getTypeFromIndexedObject(node: IndexExpressionNode,
            baseType: ObjectType, usage: EvaluatorUsage): Type {

        let magicMethodName: string;
        if (usage.method === 'get') {
            magicMethodName = '__getitem__';
        } else if (usage.method === 'set') {
            magicMethodName = '__setitem__';
        } else {
            assert(usage.method === 'del');
            magicMethodName = '__delitem__';
        }

        const itemMethodType = this.getTypeFromObjectMember(node,
            baseType, magicMethodName, { method: 'get' },
                MemberAccessFlags.SkipForMethodLookup);

        if (!itemMethodType) {
            this._addError(
                `Object of type '${ baseType.asString() }' does not define ` +
                    `'${ magicMethodName }'`,
                node.baseExpression);
            return UnknownType.create();
        }

        const indexTypeList = node.items.items.map(item => this.getType(item));

        let indexType: Type;
        if (indexTypeList.length === 1) {
            indexType = indexTypeList[0];

            // Handle the special case where the object is a Tuple and
            // the index is a constant number. In such case, we can determine
            // the exact type by indexing into the tuple type array.
            const baseTypeClass = baseType.getClassType();

            if (baseTypeClass instanceof ClassType &&
                    baseTypeClass.isBuiltIn() &&
                    baseTypeClass.getClassName() === 'Tuple' &&
                    baseTypeClass.getTypeArguments()) {

                if (node.items.items[0] instanceof NumberNode) {
                    const numberToken = (node.items.items[0] as NumberNode).token;
                    const baseClassTypeArgs = baseTypeClass.getTypeArguments()!;

                    if (numberToken.isInteger && numberToken.value >= 0 &&
                            numberToken.value < baseClassTypeArgs.length) {

                        return baseClassTypeArgs[numberToken.value];
                    }
                }
            }
        } else {
            // Handle the case where the index expression is a tuple. This
            // isn't used in most cases, but it is supported by the language.
            const builtInTupleType = ScopeUtils.getBuiltInType(this._scope, 'Tuple');
            if (builtInTupleType instanceof ClassType) {
                indexType = TypeUtils.convertClassToObject(
                    builtInTupleType.cloneForSpecialization(indexTypeList));
            } else {
                indexType = UnknownType.create();
            }
        }

        const argList: FunctionArgument[] = [{
            argumentCategory: ArgumentCategory.Simple,
            type: indexType
        }];

        if (usage.method === 'set') {
            argList.push({
                argumentCategory: ArgumentCategory.Simple,
                type: AnyType.create()
            });
        }

        const returnType = this._validateCallArguments(node, argList,
            itemMethodType, new TypeVarMap());

        return returnType || UnknownType.create();
    }

    private _getTypeArgs(node: IndexItemsNode): TypeResult[] {
        const typeArgs: TypeResult[] = [];

        node.items.forEach(expr => {
            typeArgs.push(this._getTypeArg(expr));
        });

        return typeArgs;
    }

    private _getTypeArg(node: ExpressionNode): TypeResult {
        let typeResult: TypeResult;

        if (node instanceof ListNode) {
            typeResult = {
                type: UnknownType.create(),
                typeList: node.entries.map(entry => this._getTypeFromExpression(entry)),
                node
            };
        } else {
            typeResult = this._getTypeFromExpression(node, { method: 'get' },
                EvaluatorFlags.ConvertEllipsisToAny);
        }

        return typeResult;
    }

    private _getTypeFromTupleExpression(node: TupleExpressionNode, usage: EvaluatorUsage): TypeResult {
        const entryTypes = node.expressions.map(
            expr => TypeUtils.stripLiteralValue(this.getType(expr, usage))
        );

        let type = UnknownType.create();
        const builtInTupleType = ScopeUtils.getBuiltInType(this._scope, 'Tuple');

        if (builtInTupleType instanceof ClassType) {
            type = TypeUtils.convertClassToObject(
                builtInTupleType.cloneForSpecialization(entryTypes));
        }

        return { type, node };
    }

    private _getTypeFromCallExpression(node: CallExpressionNode, flags: EvaluatorFlags): TypeResult {
        // Evaluate the left-hand side but don't specialize it yet because we
        // may need to specialize based on the arguments.
        const baseTypeResult = this._getTypeFromExpression(node.leftExpression,
            { method: 'get' }, EvaluatorFlags.DoNotSpecialize);

        // Handle the built-in "super" call specially.
        if (node.leftExpression instanceof NameNode && node.leftExpression.nameToken.value === 'super') {
            return {
                type: this._getTypeFromSuperCall(node),
                node
            };
        }

        const argList = node.arguments.map(arg => {
            return {
                valueExpression: arg.valueExpression,
                argumentCategory: arg.argumentCategory,
                name: arg.name,
                type: this.getType(arg.valueExpression)
            };
        });

        return this._getTypeFromCallExpressionWithBaseType(
            node, argList, baseTypeResult, flags, node);
    }

    private _getTypeFromSuperCall(node: CallExpressionNode): Type {
        if (node.arguments.length > 2) {
            this._addError(
                `Expecting no more than two arguments to super'`,
                node.arguments[2]);
        }

        // Determine which class the "super" call is applied to. If
        // there is no first argument, then the class is implicit.
        let targetClassType: Type;
        if (node.arguments.length > 0) {
            targetClassType = this._getTypeFromExpression(node.arguments[0].valueExpression).type;

            if (!targetClassType.isAny() && !(targetClassType instanceof ClassType)) {
                this._addError(
                    `Expected class type as first argument to super() call but received ` +
                        `'${ targetClassType.asString() }'`,
                    node.arguments[0].valueExpression);
            }
        } else {
            const enclosingClass = ParseTreeUtils.getEnclosingClass(node);
            if (enclosingClass) {
                targetClassType = AnalyzerNodeInfo.getExpressionType(enclosingClass) as ClassType;
            } else {
                this._addError(
                    `Zero-argument form of super call is valid only within a class'`,
                    node.leftExpression);
                targetClassType = UnknownType.create();
            }
        }

        // Determine whether there is a further constraint.
        let constrainedClassType: Type;
        if (node.arguments.length > 1) {
            constrainedClassType = this._getTypeFromExpression(node.arguments[1].valueExpression).type;

            let reportError = false;

            if (constrainedClassType.isAny()) {
                // Ignore unknown or any types.
            } else if (constrainedClassType instanceof ObjectType) {
                const childClassType = constrainedClassType.getClassType();
                if (targetClassType instanceof ClassType) {
                    if (!TypeUtils.derivesFromClassRecursive(childClassType, targetClassType)) {
                        reportError = true;
                    }
                }
            } else if (constrainedClassType instanceof ClassType) {
                if (targetClassType instanceof ClassType) {
                    if (!TypeUtils.derivesFromClassRecursive(constrainedClassType, targetClassType)) {
                        reportError = true;
                    }
                }
            } else {
                reportError = true;
            }

            if (reportError) {
                this._addError(
                    `Second argument to super() call must be object or class that derives from '${ targetClassType.asString() }'`,
                    node.arguments[1].valueExpression);
            }
        }

        // Python docs indicate that super() isn't valid for
        // operations other than member accesses.
        if (node.parent! instanceof MemberAccessExpressionNode) {
            const memberName = node.parent.memberName.nameToken.value;
            const lookupResults = TypeUtils.lookUpClassMember(
                targetClassType, memberName, ClassMemberLookupFlags.SkipOriginalClass);
            if (lookupResults && lookupResults.classType instanceof ClassType) {
                return new ObjectType(lookupResults.classType);
            }

            // If the lookup failed, try to return the first base class. An error
            // will be reported by the member lookup logic at a later time.
            if (targetClassType instanceof ClassType) {
                const baseClasses = targetClassType.getBaseClasses();
                if (baseClasses.length > 0 && !baseClasses[0].isMetaclass) {
                    const baseClassType = baseClasses[0].type;
                    if (baseClassType instanceof ClassType) {
                        return new ObjectType(baseClassType);
                    }
                }
            }
        }

        return UnknownType.create();
    }

    private _getTypeFromCallExpressionWithBaseType(errorNode: ExpressionNode,
            argList: FunctionArgument[], baseTypeResult: TypeResult,
            flags: EvaluatorFlags, cachedExpressionNode?: ExpressionNode,
            specializeReturnType = true): TypeResult {

        let type: Type | undefined;
        const callType = baseTypeResult.type;

        if (callType instanceof ClassType) {
            if (callType.isBuiltIn()) {
                const className = callType.getClassName();

                if (className === 'type') {
                    // Handle the 'type' call specially.
                    if (argList.length >= 1) {
                        const argType = argList[0].type;
                        if (argType instanceof ObjectType) {
                            type = argType.getClassType();
                        }
                    }

                    // If the parameter to type() is not statically known,
                    // fall back to unknown.
                    if (!type) {
                        type = UnknownType.create();
                    }
                } else if (className === 'TypeVar') {
                    type = this._createTypeVarType(errorNode, argList);
                } else if (className === 'NamedTuple') {
                    type = this._createNamedTupleType(errorNode, argList, true,
                        cachedExpressionNode);
                } else if (className === 'Protocol' || className === 'Generic' ||
                        className === 'Callable' || className === 'Type') {
                    this._addError(`'${ className }' cannot be instantiated directly`, errorNode);
                } else if (className === 'Enum' || className === 'IntEnum' ||
                        className === 'Flag' || className === 'IntFlag') {
                    type = this._createEnumType(errorNode, callType, argList,
                        cachedExpressionNode);
                } else if (className === 'auto' && argList.length === 0) {
                    type = ScopeUtils.getBuiltInObject(this._scope, 'int');
                }
            } else if (callType.isAbstractClass()) {
                // If the class is abstract, it can't be instantiated.
                const symbolTable = new StringMap<ClassMember>();
                TypeUtils.getAbstractMethodsRecursive(callType, symbolTable);

                const diagAddendum = new DiagnosticAddendum();
                const symbolTableKeys = symbolTable.getKeys();
                const errorsToDisplay = 2;

                symbolTableKeys.forEach((symbolName, index) => {
                    if (index === errorsToDisplay) {
                        diagAddendum.addMessage(`and ${ symbolTableKeys.length - errorsToDisplay } more...`);
                    } else if (index < errorsToDisplay) {
                        const symbolWithClass = symbolTable.get(symbolName)!;

                        if (symbolWithClass.classType instanceof ClassType) {
                            const className = symbolWithClass.classType.getClassName();
                            diagAddendum.addMessage(`'${ className }.${ symbolName }' is abstract`);
                        }
                    }
                });

                this._addError(
                    `Cannot instantiate abstract class '${ callType.getClassName() }'` +
                        diagAddendum.getString(),
                    errorNode);
            }

            // Assume this is a call to the constructor.
            if (!type) {
                type = this._validateConstructorArguments(errorNode, argList, callType);
            }
        } else if (callType instanceof FunctionType) {
            // The stdlib collections/__init__.pyi stub file defines namedtuple
            // as a function rather than a class, so we need to check for it here.
            if (callType.getBuiltInName() === 'namedtuple') {
                this._addDiagnostic(
                    this._fileInfo.diagnosticSettings.reportUntypedNamedTuple,
                    `'namedtuple' provides no types for tuple entries. Use 'NamedTuple' instead.`,
                    errorNode);
                type = this._createNamedTupleType(errorNode, argList, false,
                    cachedExpressionNode);
            } else if (callType.getBuiltInName() === 'NewType') {
                type = this._validateCallArguments(errorNode, argList, callType,
                    new TypeVarMap(), specializeReturnType);

                // If the call's arguments were validated, replace the
                // type with a new synthesized subclass.
                if (type) {
                    type = this._createNewType(errorNode, argList, cachedExpressionNode);
                }
            } else {
                type = this._validateCallArguments(errorNode, argList, callType,
                    new TypeVarMap(), specializeReturnType);
            }

            if (!type) {
                type = UnknownType.create();
            }
        } else if (callType instanceof OverloadedFunctionType) {
            // Determine which of the overloads (if any) match.
            const functionType = this._findOverloadedFunctionType(errorNode, argList, callType);

            if (functionType) {
                type = this._validateCallArguments(errorNode, argList, callType,
                    new TypeVarMap(), specializeReturnType);
                if (!type) {
                    type = UnknownType.create();
                }
            } else {
                const exprString = ParseTreeUtils.printExpression(errorNode);
                const diagAddendum = new DiagnosticAddendum();
                const argTypes = argList.map(t => t.type.asString());
                diagAddendum.addMessage(`Argument types: (${ argTypes.join(', ') })`);
                this._addError(
                    `No overloads for '${ exprString }' match parameters` + diagAddendum.getString(),
                    errorNode);
                type = UnknownType.create();
            }
        } else if (callType instanceof ObjectType) {
            // Handle the "Type" object specially.
            const classFromTypeObject = this._getClassFromPotentialTypeObject(callType);
            if (classFromTypeObject) {
                if (classFromTypeObject.isAny()) {
                    type = classFromTypeObject;
                } else if (classFromTypeObject instanceof ClassType) {
                    type = this._validateConstructorArguments(errorNode,
                        argList, classFromTypeObject);
                }
            } else {
                const memberType = this.getTypeFromObjectMember(errorNode,
                    callType, '__call__', { method: 'get' }, MemberAccessFlags.SkipForMethodLookup);
                if (memberType) {
                    type = this._validateCallArguments(errorNode, argList, memberType, new TypeVarMap());
                    if (!type) {
                        type = UnknownType.create();
                    }
                }
            }
        } else if (callType instanceof UnionType) {
            const returnTypes: Type[] = [];
            callType.getTypes().forEach(typeEntry => {
                if (typeEntry instanceof NoneType) {
                    this._addDiagnostic(
                        this._fileInfo.diagnosticSettings.reportOptionalCall,
                        `Object of type 'None' cannot be called`,
                        errorNode);
                } else {
                    const typeResult = this._getTypeFromCallExpressionWithBaseType(
                        errorNode,
                        argList,
                        {
                            type: typeEntry,
                            node: baseTypeResult.node
                        },
                        EvaluatorFlags.None, cachedExpressionNode);
                    if (typeResult) {
                        returnTypes.push(typeResult.type);
                    }
                }
            });

            if (returnTypes.length > 0) {
                type = TypeUtils.combineTypes(returnTypes);
            }
        } else if (callType.isAny()) {
            type = callType;
        }

        if (!type) {
            this._addError(
                `'${ ParseTreeUtils.printExpression(errorNode) }' has type ` +
                `'${ callType.asString() }' and is not callable`,
                errorNode);
            type = UnknownType.create();
        }

        // Should we specialize the class?
        if ((flags & EvaluatorFlags.DoNotSpecialize) === 0) {
            if (type instanceof ClassType) {
                type = this._createSpecializeClassType(type, undefined, errorNode);
            }
        }

        return { type, node: baseTypeResult.node };
    }

    private _findOverloadedFunctionType(errorNode: ExpressionNode, argList: FunctionArgument[],
            callType: OverloadedFunctionType): FunctionType | undefined {

        let validOverload: FunctionType | undefined;

        // Temporarily disable diagnostic output.
        this._silenceDiagnostics(() => {
            for (const overload of callType.getOverloads()) {
                if (this._validateCallArguments(errorNode, argList, overload.type, new TypeVarMap())) {
                    validOverload = overload.type;
                    break;
                }
            }
        });

        return validOverload;
    }

    // Tries to match the arguments of a call to the constructor for a class.
    // If successful, it returns the resulting (specialized) object type that
    // is allocated by the constructor. If unsuccessful, it records diagnostic
    // information and returns undefined.
    private _validateConstructorArguments(errorNode: ExpressionNode,
            argList: FunctionArgument[], type: ClassType): Type | undefined {
        let validatedTypes = false;
        let returnType: Type | undefined;
        let reportedErrorsForNewCall = false;

        // Validate __new__
        const constructorMethodInfo = this._getTypeFromClassMemberName(errorNode,
            type, '__new__', { method: 'get' }, MemberAccessFlags.SkipForMethodLookup |
                MemberAccessFlags.SkipObjectBaseClass);
        if (constructorMethodInfo) {
            const constructorMethodType = TypeUtils.bindFunctionToClassOrObject(
                type, constructorMethodInfo.type, true);
            returnType = this._validateCallArguments(errorNode, argList, constructorMethodType,
                new TypeVarMap());
            if (!returnType) {
                reportedErrorsForNewCall = true;
            }
            validatedTypes = true;
        }

        // Validate __init__
        // Don't report errors for __init__ if __new__ already generated errors. They're
        // probably going to be entirely redundant anyway.
        if (!reportedErrorsForNewCall) {
            const initMethodType = this.getTypeFromObjectMember(errorNode,
                new ObjectType(type), '__init__', { method: 'get' },
                MemberAccessFlags.SkipForMethodLookup | MemberAccessFlags.SkipObjectBaseClass);
            if (initMethodType) {
                const typeVarMap = new TypeVarMap();
                if (this._validateCallArguments(errorNode, argList, initMethodType, typeVarMap)) {
                    let specializedClassType = type;
                    if (!typeVarMap.isEmpty()) {
                        specializedClassType = TypeUtils.specializeType(type, typeVarMap) as ClassType;
                        assert(specializedClassType instanceof ClassType);
                    }
                    returnType = new ObjectType(specializedClassType);
                }
                validatedTypes = true;
            }
        }

        if (!validatedTypes && argList.length > 0) {
            this._addError(
                `Expected no arguments to '${ type.getClassName() }' constructor`, errorNode);
        } else if (!returnType) {
            // There was no __new__ or __init__, so fall back on the
            // object.__new__ which takes no parameters.
            returnType = new ObjectType(type);
        }

        // Make the type concrete if it wasn't already specialized.
        if (returnType) {
            returnType = TypeUtils.specializeType(returnType, undefined);
        }

        return returnType;
    }

    // Validates that the arguments can be assigned to the call's parameter
    // list, specializes the call based on arg types, and returns the
    // specialized type of the return value. If it detects an error along
    // the way, it emits a diagnostic and returns undefined.
    private _validateCallArguments(errorNode: ExpressionNode,
            argList: FunctionArgument[], callType: Type, typeVarMap: TypeVarMap,
            specializeReturnType = true): Type | undefined {

        let returnType: Type | undefined;

        if (callType.isAny()) {
            returnType = callType;
        } else if (callType instanceof FunctionType) {
            returnType = this._validateFunctionArguments(errorNode, argList, callType, typeVarMap);
        } else if (callType instanceof OverloadedFunctionType) {
            const overloadedFunctionType = this._findOverloadedFunctionType(
                errorNode, argList, callType);
            if (overloadedFunctionType) {
                returnType = this._validateFunctionArguments(errorNode,
                    argList, overloadedFunctionType, typeVarMap);
            } else {
                const exprString = ParseTreeUtils.printExpression(errorNode);
                const diagAddendum = new DiagnosticAddendum();
                const argTypes = argList.map(t => t.type.asString());
                diagAddendum.addMessage(`Argument types: (${ argTypes.join(', ') })`);
                this._addError(
                    `No overloads for '${ exprString }' match parameters` + diagAddendum.getString(),
                    errorNode);
            }
        } else if (callType instanceof ClassType) {
            if (!callType.isSpecialBuiltIn()) {
                returnType = this._validateConstructorArguments(errorNode, argList, callType);
            } else {
                this._addError(
                    `'${ callType.getClassName() }' cannot be instantiated`,
                    errorNode);
            }
        } else if (callType instanceof ObjectType) {
            const memberType = this.getTypeFromObjectMember(errorNode,
                callType, '__call__', { method: 'get' },
                    MemberAccessFlags.SkipForMethodLookup);

            if (memberType && memberType instanceof FunctionType) {
                const callMethodType = TypeUtils.stripFirstParameter(memberType);
                returnType = this._validateCallArguments(
                    errorNode, argList, callMethodType, typeVarMap);
            }
        } else if (callType instanceof UnionType) {
            const returnTypes: Type[] = [];

            for (const type of callType.getTypes()) {
                if (type instanceof NoneType) {
                    this._addDiagnostic(
                        this._fileInfo.diagnosticSettings.reportOptionalCall,
                        `Object of type 'None' cannot be called`,
                        errorNode);
                } else {
                    const entryReturnType = this._validateCallArguments(
                        errorNode, argList, type, typeVarMap);
                    if (entryReturnType) {
                        returnTypes.push(entryReturnType);
                    }
                }
            }

            if (returnTypes.length > 0) {
                returnType = TypeUtils.combineTypes(returnTypes);
            }
        }

        // Make the type concrete if it wasn't already specialized.
        if (returnType && specializeReturnType) {
            returnType = TypeUtils.specializeType(returnType, undefined);
        }

        return returnType;
    }

    // Tries to assign the call arguments to the function parameter
    // list and reports any mismatches in types or counts. Returns the
    // specialized return type of the call.
    // This logic is based on PEP 3102: https://www.python.org/dev/peps/pep-3102/
    private _validateFunctionArguments(errorNode: ExpressionNode,
            argList: FunctionArgument[], type: FunctionType, typeVarMap: TypeVarMap): Type | undefined {

        let argIndex = 0;
        const typeParams = type.getParameters();

        // The last parameter might be a var arg dictionary. If so, strip it off.
        const varArgDictParam = typeParams.find(
                param => param.category === ParameterCategory.VarArgDictionary);
        let reportedArgError = false;

        // Build a map of parameters by name.
        const paramMap = new StringMap<ParamAssignmentInfo>();
        typeParams.forEach(param => {
            if (param.name) {
                paramMap.set(param.name, {
                    argsNeeded: param.category === ParameterCategory.Simple && !param.hasDefault ? 1 : 0,
                    argsReceived: 0
                });
            }
        });

        // Is there a bare (nameless) "*" parameter? If so, it signifies the end
        // of the positional parameter list.
        let positionalParamCount = typeParams.findIndex(
            param => param.category === ParameterCategory.VarArgList && !param.name);

        // Is there a var-arg (named "*") parameter? If so, it is the last of
        // the positional parameters.
        if (positionalParamCount < 0) {
            positionalParamCount = typeParams.findIndex(
                param => param.category === ParameterCategory.VarArgList);
            if (positionalParamCount >= 0) {
                positionalParamCount++;
            }
        }

        // Is there a keyword var-arg ("**") parameter? If so, it's not included
        // in the list of positional parameters.
        if (positionalParamCount < 0) {
            positionalParamCount = typeParams.findIndex(
                param => param.category === ParameterCategory.VarArgDictionary);
        }

        // If we didn't see any special cases, then all parameters are positional.
        if (positionalParamCount < 0) {
            positionalParamCount = typeParams.length;
        }

        // Determine how many positional args are being passed before
        // we see a named arg.
        let positionalArgCount = argList.findIndex(
            arg => arg.argumentCategory === ArgumentCategory.UnpackedDictionary ||
                arg.name !== undefined);
        if (positionalArgCount < 0) {
            positionalArgCount = argList.length;
        }

        // Map the positional args to parameters.
        let paramIndex = 0;
        while (argIndex < positionalArgCount) {
            if (paramIndex >= positionalParamCount) {
                if (argList[argIndex].argumentCategory !== ArgumentCategory.UnpackedList) {
                    const adjustedCount = positionalParamCount;
                    this._addError(
                        `Expected ${ adjustedCount } positional ` +
                        `${ adjustedCount === 1 ? 'argument' : 'arguments' }`,
                        argList[argIndex].valueExpression || errorNode);
                    reportedArgError = true;
                }
                break;
            }

            const paramType = type.getEffectiveParameterType(paramIndex);
            if (argList[argIndex].argumentCategory === ArgumentCategory.UnpackedList) {
                // Assume the unpacked list fills the remaining positional args.
                if (argList[argIndex].valueExpression) {
                    const listElementType = this.getTypeFromIterable(argList[argIndex].type, false,
                        argList[argIndex].valueExpression!, false);

                    if (!this._validateArgType(paramType, listElementType,
                            argList[argIndex].valueExpression || errorNode, typeVarMap,
                            typeParams[paramIndex].name)) {
                        reportedArgError = true;
                    }
                }
                break;
            } else if (typeParams[paramIndex].category === ParameterCategory.VarArgList) {
                if (!this._validateArgType(paramType, argList[argIndex].type,
                        argList[argIndex].valueExpression || errorNode, typeVarMap,
                        typeParams[paramIndex].name)) {
                    reportedArgError = true;
                }
                argIndex++;
            } else {
                if (!this._validateArgType(paramType, argList[argIndex].type,
                        argList[argIndex].valueExpression || errorNode, typeVarMap,
                        typeParams[paramIndex].name)) {
                    reportedArgError = true;
                }

                // Note that the parameter has received an argument.
                const paramName = typeParams[paramIndex].name;
                if (paramName) {
                    paramMap.get(paramName)!.argsReceived++;
                }

                argIndex++;
                paramIndex++;
            }
        }

        if (!reportedArgError) {
            let foundUnpackedDictionaryArg = false;
            const foundUnpackedListArg = argList.find(
                arg => arg.argumentCategory === ArgumentCategory.UnpackedList) !== undefined;

            // Now consume any named parameters.
            while (argIndex < argList.length) {
                if (argList[argIndex].argumentCategory === ArgumentCategory.UnpackedDictionary) {
                    foundUnpackedDictionaryArg = true;
                } else {
                    // Protect against the case where a non-named argument appears after
                    // a named argument. This will have already been reported as a parse
                    // error, but we need to protect against it here.
                    const paramName = argList[argIndex].name;
                    if (paramName) {
                        const paramNameValue = paramName.nameToken.value;
                        const paramEntry = paramMap.get(paramNameValue);
                        if (paramEntry) {
                            if (paramEntry.argsReceived > 0) {
                                this._addError(
                                    `Parameter '${ paramNameValue }' is already assigned`, paramName);
                                reportedArgError = true;
                            } else {
                                paramMap.get(paramName.nameToken.value)!.argsReceived++;

                                const paramInfoIndex = typeParams.findIndex(
                                    param => param.name === paramNameValue);
                                assert(paramInfoIndex >= 0);
                                const paramType = type.getEffectiveParameterType(paramInfoIndex);
                                if (!this._validateArgType(paramType, argList[argIndex].type,
                                        argList[argIndex].valueExpression || errorNode, typeVarMap,
                                        paramNameValue)) {
                                    reportedArgError = true;
                                }
                            }
                        } else if (varArgDictParam) {
                            if (!this._validateArgType(varArgDictParam.type, argList[argIndex].type,
                                    argList[argIndex].valueExpression || errorNode, typeVarMap,
                                    paramNameValue)) {
                                reportedArgError = true;
                            }
                        } else {
                            this._addError(
                                `No parameter named '${ paramName.nameToken.value }'`, paramName);
                            reportedArgError = true;
                        }
                    }
                }

                argIndex++;
            }

            // Determine whether there are any parameters that require arguments
            // but have not yet received them. If we received a dictionary argument
            // (i.e. an arg starting with a "**") or a list argument (i.e. an arg
            // starting with a "*"), we will assume that all parameters are matched.
            if (!foundUnpackedDictionaryArg && !foundUnpackedListArg && !type.isDefaultParameterCheckDisabled()) {
                const unassignedParams = paramMap.getKeys().filter(name => {
                    const entry = paramMap.get(name)!;
                    return entry.argsReceived < entry.argsNeeded;
                });

                if (unassignedParams.length > 0) {
                    this._addError(
                        `Argument missing for parameter${ unassignedParams.length === 1 ? '' : 's' } ` +
                        unassignedParams.map(p => `'${ p }'`).join(', '), errorNode);
                    reportedArgError = true;
                }
            }
        }

        if (reportedArgError) {
            return undefined;
        }

        return TypeUtils.specializeType(type.getEffectiveReturnType(), typeVarMap);
    }

    private _validateArgType(paramType: Type, argType: Type, errorNode: ExpressionNode,
            typeVarMap: TypeVarMap, paramName?: string): boolean {

        const diag = new DiagnosticAddendum();
        if (!TypeUtils.canAssignType(paramType, argType, diag.createAddendum(), typeVarMap)) {
            const optionalParamName = paramName ? `'${ paramName }' ` : '';
            this._addError(
                `Argument of type '${ argType.asString() }'` +
                    ` cannot be assigned to parameter ${ optionalParamName }` +
                    `of type '${ paramType.asString() }'` +
                    diag.getString(),
                errorNode);
            return false;
        }

        return true;
    }

    private _createTypeVarType(errorNode: ExpressionNode, argList: FunctionArgument[]): Type | undefined {
        let typeVarName = '';
        if (argList.length === 0) {
            this._addError('Expected name of type var', errorNode);
            return undefined;
        }

        const firstArg = argList[0];
        if (firstArg.valueExpression instanceof StringListNode) {
            typeVarName = firstArg.valueExpression.getValue();
        } else {
            this._addError('Expected name of type var as first parameter',
                firstArg.valueExpression || errorNode);
        }

        const typeVar = new TypeVarType(typeVarName);

        // Parse the remaining parameters.
        for (let i = 1; i < argList.length; i++) {
            const paramNameNode = argList[i].name;
            const paramName = paramNameNode ? paramNameNode.nameToken.value : undefined;
            const paramNameMap = new StringMap<string>();

            if (paramName) {
                if (paramNameMap.get(paramName)) {
                    this._addError(
                        `Duplicate parameter name '${ paramName }' not allowed`,
                        argList[i].valueExpression || errorNode);
                }

                if (paramName === 'bound') {
                    if (typeVar.getConstraints().length > 0) {
                        this._addError(
                            `A TypeVar cannot be both bound and constrained`,
                            argList[i].valueExpression || errorNode);
                    } else {
                        if (argList[i].type.requiresSpecialization()) {
                            this._addError(
                                `A TypeVar bound type cannot be generic`,
                                argList[i].valueExpression || errorNode);
                        }
                        typeVar.setBoundType(TypeUtils.convertClassToObject(argList[i].type));
                    }
                } else if (paramName === 'covariant') {
                    if (argList[i].valueExpression && this._getBooleanValue(argList[i].valueExpression!)) {
                        if (typeVar.isContravariant()) {
                            this._addError(
                                `A TypeVar cannot be both covariant and contravariant`,
                                argList[i].valueExpression!);
                        } else {
                            typeVar.setIsCovariant();
                        }
                    }
                } else if (paramName === 'contravariant') {
                    if (argList[i].valueExpression && this._getBooleanValue(argList[i].valueExpression!)) {
                        if (typeVar.isContravariant()) {
                            this._addError(
                                `A TypeVar cannot be both covariant and contravariant`,
                                argList[i].valueExpression!);
                        } else {
                            typeVar.setIsContravariant();
                        }
                    }
                } else {
                    this._addError(
                        `'${ paramName }' is unknown parameter to TypeVar`,
                        argList[i].valueExpression || errorNode);
                }

                paramNameMap.set(paramName, paramName);
            } else {
                if (typeVar.getBoundType()) {
                    this._addError(
                        `A TypeVar cannot be both bound and constrained`,
                        argList[i].valueExpression || errorNode);
                } else {
                    if (argList[i].type.requiresSpecialization()) {
                        this._addError(
                            `A TypeVar constraint type cannot be generic`,
                            argList[i].valueExpression || errorNode);
                    }
                    typeVar.addConstraint(TypeUtils.convertClassToObject(argList[i].type));
                }
            }
        }

        return typeVar;
    }

    private _getBooleanValue(node: ExpressionNode): boolean {
        if (node instanceof ConstantNode) {
            if (node.token instanceof KeywordToken) {
                if (node.token.keywordType === KeywordType.False) {
                    return false;
                } else if (node.token.keywordType === KeywordType.True) {
                    return true;
                }
            }
        }

        this._addError('Expected True or False', node);
        return false;
    }

    // Creates a new custom enum class with named values.
    private _createEnumType(errorNode: ExpressionNode, enumClass: ClassType,
            argList: FunctionArgument[], cachedExpressionNode?: ExpressionNode): ClassType {

        let className = 'enum';
        if (argList.length === 0) {
            this._addError('Expected enum class name as first parameter', errorNode);
        } else {
            const nameArg = argList[0];
            if (nameArg.argumentCategory !== ArgumentCategory.Simple) {
                this._addError('Expected enum class name as first parameter',
                    argList[0].valueExpression || errorNode);
            } else if (nameArg.valueExpression instanceof StringListNode) {
                className = nameArg.valueExpression.getValue();
            }
        }

        // This is a hack to make enum classes work correctly. We don't want
        // to create a new ClassType for every analysis pass. Instead, we'll
        // use the cached version and update it after the first pass.
        const cachedCallType = cachedExpressionNode ?
            AnalyzerNodeInfo.getExpressionType(cachedExpressionNode) :
            undefined;

        // Use the cached class type and update it if this isn't the first
        // analysis path. If this is the first pass, allocate a new ClassType.
        let classType = cachedCallType as ClassType;
        if (!(classType instanceof ClassType)) {
            classType = new ClassType(className, ClassTypeFlags.None,
                AnalyzerNodeInfo.getTypeSourceId(errorNode, this._fileInfo.filePathHash));

            AnalyzerNodeInfo.setExpressionType(errorNode, classType);
            classType.addBaseClass(enumClass, false);
        }

        const classFields = classType.getClassFields();
        setSymbolPreservingAccess(classFields, '__class__',
            Symbol.createWithType(classType, defaultTypeSourceId));

        if (argList.length < 2) {
            this._addError('Expected enum item string as second parameter', errorNode);
        } else {
            const entriesArg = argList[1];
            if (entriesArg.argumentCategory !== ArgumentCategory.Simple ||
                    !(entriesArg.valueExpression instanceof StringListNode)) {

                this._addError('Expected enum item string as second parameter', errorNode);
            } else {
                const entries = entriesArg.valueExpression.getValue().split(' ');
                entries.forEach(entryName => {
                    entryName = entryName.trim();
                    if (entryName) {
                        const entryType = UnknownType.create();

                        const newSymbol = Symbol.createWithType(entryType, defaultTypeSourceId);

                        // We need to associate the declaration with a parse node.
                        // In this case it's just part of a string literal value.
                        // The definition provider won't necessarily take the
                        // user to the exact spot in the string, but it's close enough.
                        const stringNode = entriesArg.valueExpression!;
                        const declaration: Declaration = {
                            category: DeclarationCategory.Variable,
                            node: stringNode,
                            path: this._fileInfo.filePath,
                            declaredType: entryType,
                            range: convertOffsetsToRange(
                                stringNode.start, stringNode.end, this._fileInfo.lines)
                        };
                        newSymbol.addDeclaration(declaration);
                        setSymbolPreservingAccess(classFields, entryName, newSymbol);
                    }
                });
            }
        }

        return classType;
    }

    // Implemented the semantics of the NewType call as documented
    // in the Python specification: The static type checker will treat
    // the new type as if it were a subclass of the original type.
    private _createNewType(errorNode: ExpressionNode, argList: FunctionArgument[],
            cachedExpressionNode?: ExpressionNode): ClassType | undefined {

        let className = '_';
        if (argList.length >= 1) {
            const nameArg = argList[0];
            if (nameArg.argumentCategory === ArgumentCategory.Simple) {
                if (nameArg.valueExpression instanceof StringListNode) {
                    className = nameArg.valueExpression.getValue();
                }
            }
        }

        if (argList.length >= 2 && argList[1].type instanceof ClassType) {
            const baseClass = argList[1].type;

            // This is a hack to make named tuples work correctly. We don't want
            // to create a new ClassType for every analysis pass. Instead, we'll
            // use the cached version and update it after the first pass.
            const cachedCallType = cachedExpressionNode ?
                AnalyzerNodeInfo.getExpressionType(cachedExpressionNode) :
                undefined;

            // Use the cached class type and update it if this isn't the first
            // analysis path. If this is the first pass, allocate a new ClassType.
            let classType = cachedCallType as ClassType;
            if (!(classType instanceof ClassType)) {
                classType = new ClassType(className, ClassTypeFlags.None,
                    AnalyzerNodeInfo.getTypeSourceId(errorNode, this._fileInfo.filePathHash));

                AnalyzerNodeInfo.setExpressionType(errorNode, classType);
                classType.addBaseClass(baseClass, false);
            } else {
                classType.updateBaseClassType(0, baseClass);
            }

            return classType;
        }

        return undefined;
    }

    // Creates a new custom tuple factory class with named values.
    // Supports both typed and untyped variants.
    private _createNamedTupleType(errorNode: ExpressionNode, argList: FunctionArgument[],
            includesTypes: boolean, cachedExpressionNode?: ExpressionNode): ClassType {

        let className = 'namedtuple';
        if (argList.length === 0) {
            this._addError('Expected named tuple class name as first parameter',
                errorNode);
        } else {
            const nameArg = argList[0];
            if (nameArg.argumentCategory !== ArgumentCategory.Simple) {
                this._addError('Expected named tuple class name as first parameter',
                    argList[0].valueExpression || errorNode);
            } else if (nameArg.valueExpression instanceof StringListNode) {
                className = nameArg.valueExpression.getValue();
            }
        }

        // This is a hack to make named tuples work correctly. We don't want
        // to create a new ClassType for every analysis pass. Instead, we'll
        // use the cached version and update it after the first pass.
        const cachedCallType = cachedExpressionNode ?
            AnalyzerNodeInfo.getExpressionType(cachedExpressionNode) :
            undefined;

        // Use the cached class type and update it if this isn't the first
        // analysis path. If this is the first pass, allocate a new ClassType.
        let classType = cachedCallType as ClassType;
        if (!(classType instanceof ClassType)) {
            classType = new ClassType(className, ClassTypeFlags.None,
                AnalyzerNodeInfo.getTypeSourceId(errorNode, this._fileInfo.filePathHash));

            AnalyzerNodeInfo.setExpressionType(errorNode, classType);
            const builtInNamedTuple = this.getTypingType('NamedTuple') || UnknownType.create();
            classType.addBaseClass(builtInNamedTuple, false);
        }

        const classFields = classType.getClassFields();
        setSymbolPreservingAccess(classFields, '__class__',
            Symbol.createWithType(classType, defaultTypeSourceId));
        const instanceFields = classType.getInstanceFields();

        const builtInTupleType = ScopeUtils.getBuiltInType(this._scope, 'Tuple');
        if (builtInTupleType instanceof ClassType) {
            const constructorType = new FunctionType(
                FunctionTypeFlags.StaticMethod | FunctionTypeFlags.SynthesizedMethod);
            constructorType.setDeclaredReturnType(new ObjectType(classType));
            constructorType.addParameter({
                category: ParameterCategory.Simple,
                name: 'cls',
                type: classType
            });

            const selfParameter: FunctionParameter = {
                category: ParameterCategory.Simple,
                name: 'self',
                type: new ObjectType(classType)
            };

            let addGenericGetAttribute = false;

            if (argList.length < 2) {
                this._addError('Expected named tuple entry list as second parameter', errorNode);
                addGenericGetAttribute = true;
            } else {
                const entriesArg = argList[1];
                if (entriesArg.argumentCategory !== ArgumentCategory.Simple) {
                    addGenericGetAttribute = true;
                } else {
                    if (!includesTypes && entriesArg.valueExpression instanceof StringListNode) {
                        const entries = entriesArg.valueExpression.getValue().split(' ');
                        entries.forEach(entryName => {
                            entryName = entryName.trim();
                            if (entryName) {
                                const entryType = UnknownType.create();
                                const paramInfo: FunctionParameter = {
                                    category: ParameterCategory.Simple,
                                    name: entryName,
                                    type: entryType
                                };

                                constructorType.addParameter(paramInfo);
                                const newSymbol = Symbol.createWithType(entryType, defaultTypeSourceId);

                                // We need to associate the declaration with a parse node.
                                // In this case it's just part of a string literal value.
                                // The definition provider won't necessarily take the
                                // user to the exact spot in the string, but it's close enough.
                                const stringNode = entriesArg.valueExpression!;
                                const declaration: Declaration = {
                                    category: DeclarationCategory.Variable,
                                    node: stringNode,
                                    path: this._fileInfo.filePath,
                                    declaredType: entryType,
                                    range: convertOffsetsToRange(
                                        stringNode.start, stringNode.end, this._fileInfo.lines)
                                };
                                newSymbol.addDeclaration(declaration);
                                setSymbolPreservingAccess(instanceFields, entryName, newSymbol);
                            }
                        });
                    } else if (entriesArg.valueExpression instanceof ListNode) {
                        const entryList = entriesArg.valueExpression;
                        const entryMap: { [name: string]: string } = {};

                        entryList.entries.forEach((entry, index) => {
                            let entryType: Type | undefined;
                            let entryNameNode: ExpressionNode | undefined;
                            let entryName = '';

                            if (includesTypes) {
                                // Handle the variant that includes name/type tuples.
                                if (entry instanceof TupleExpressionNode && entry.expressions.length === 2) {
                                    entryNameNode = entry.expressions[0];
                                    const entryTypeInfo = this._getTypeFromExpression(entry.expressions[1]);
                                    if (entryTypeInfo) {
                                        entryType = TypeUtils.convertClassToObject(entryTypeInfo.type);
                                    }
                                } else {
                                    this._addError(
                                        'Expected two-entry tuple specifying entry name and type', entry);
                                }
                            } else {
                                entryNameNode = entry;
                                entryType = UnknownType.create();
                            }

                            if (entryNameNode instanceof StringListNode) {
                                entryName = entryNameNode.getValue();
                                if (!entryName) {
                                    this._addError(
                                        'Names within a named tuple cannot be empty', entryNameNode);
                                }
                            } else {
                                this._addError(
                                    'Expected string literal for entry name', entryNameNode || entry);
                            }

                            if (!entryName) {
                                entryName = `_${ index.toString() }`;
                            }

                            if (entryMap[entryName]) {
                                this._addError(
                                    'Names within a named tuple must be unique', entryNameNode || entry);
                            }

                            // Record names in a map to detect duplicates.
                            entryMap[entryName] = entryName;

                            if (!entryType) {
                                entryType = UnknownType.create();
                            }

                            const paramInfo: FunctionParameter = {
                                category: ParameterCategory.Simple,
                                name: entryName,
                                type: entryType
                            };

                            constructorType.addParameter(paramInfo);

                            const newSymbol = Symbol.createWithType(entryType, defaultTypeSourceId);
                            if (entryNameNode) {
                                const declaration: Declaration = {
                                    category: DeclarationCategory.Variable,
                                    node: entryNameNode,
                                    path: this._fileInfo.filePath,
                                    declaredType: entryType,
                                    range: convertOffsetsToRange(
                                        entryNameNode.start, entryNameNode.end, this._fileInfo.lines)
                                };
                                newSymbol.addDeclaration(declaration);
                            }
                            setSymbolPreservingAccess(instanceFields, entryName, newSymbol);
                        });
                    } else {
                        // A dynamic expression was used, so we can't evaluate
                        // the named tuple statically.
                        addGenericGetAttribute = true;
                    }
                }
            }

            if (addGenericGetAttribute) {
                TypeUtils.addDefaultFunctionParameters(constructorType);
            }

            // Always use generic parameters for __init__. The __new__ method
            // will handle propery type checking. We may need to disable default
            // parameter processing for __new__ (see setDefaultParameterCheckDisabled),
            // and we don't want to do it for __init__ as well.
            const initType = new FunctionType(
                FunctionTypeFlags.InstanceMethod | FunctionTypeFlags.SynthesizedMethod);
            initType.addParameter(selfParameter);
            TypeUtils.addDefaultFunctionParameters(initType);

            setSymbolPreservingAccess(classFields, '__new__',
                Symbol.createWithType(constructorType, defaultTypeSourceId));
            setSymbolPreservingAccess(classFields, '__init__',
                Symbol.createWithType(initType, defaultTypeSourceId));

            const keysItemType = new FunctionType(FunctionTypeFlags.SynthesizedMethod);
            keysItemType.setDeclaredReturnType(ScopeUtils.getBuiltInObject(this._scope, 'list',
                [ScopeUtils.getBuiltInObject(this._scope, 'str')]));
            setSymbolPreservingAccess(classFields, 'keys',
                Symbol.createWithType(keysItemType, defaultTypeSourceId));
            setSymbolPreservingAccess(classFields, 'items',
                Symbol.createWithType(keysItemType, defaultTypeSourceId));

            const lenType = new FunctionType(
                FunctionTypeFlags.InstanceMethod | FunctionTypeFlags.SynthesizedMethod);
            lenType.setDeclaredReturnType(ScopeUtils.getBuiltInObject(this._scope, 'int'));
            lenType.addParameter(selfParameter);
            setSymbolPreservingAccess(classFields, '__len__',
                Symbol.createWithType(lenType, defaultTypeSourceId));

            if (addGenericGetAttribute) {
                const getAttribType = new FunctionType(
                    FunctionTypeFlags.InstanceMethod | FunctionTypeFlags.SynthesizedMethod);
                getAttribType.setDeclaredReturnType(AnyType.create());
                getAttribType.addParameter(selfParameter);
                getAttribType.addParameter({
                    category: ParameterCategory.Simple,
                    name: 'name',
                    type: ScopeUtils.getBuiltInObject(this._scope, 'str')
                });
                setSymbolPreservingAccess(classFields, '__getattribute__',
                    Symbol.createWithType(getAttribType, defaultTypeSourceId));
            }
        }

        return classType;
    }

    private _reportUsageErrorForReadOnly(node: ParseNode, usage: EvaluatorUsage) {
        if (usage.method === 'set') {
            this._addError(`Constant value cannot be assigned`, node);
        } else if (usage.method === 'del') {
            this._addError(`Constant value cannot be deleted`, node);
        }
    }

    private _getTypeFromConstantExpression(node: ConstantNode): TypeResult | undefined {
        let type: Type | undefined;

        if (node.token.type === TokenType.Keyword) {
            if (node.token.keywordType === KeywordType.None) {
                type = NoneType.create();
            } else if (node.token.keywordType === KeywordType.True ||
                    node.token.keywordType === KeywordType.False ||
                    node.token.keywordType === KeywordType.Debug) {
                type = ScopeUtils.getBuiltInObject(this._scope, 'bool');

                // For True and False, we can create truthy and falsy
                // versions of 'bool'.
                if (type instanceof ObjectType) {
                    if (node.token.keywordType === KeywordType.True) {
                        type = type.cloneWithLiteral(true);
                    } else if (node.token.keywordType === KeywordType.False) {
                        type = type.cloneWithLiteral(false);
                    }
                }
            }
        }

        if (!type) {
            return undefined;
        }

        return { type, node };
    }

    private _getTypeFromUnaryExpression(node: UnaryExpressionNode): TypeResult {
        let exprType = this.getType(node.expression);

        // Map unary operators to magic functions. Note that the bitwise
        // invert has two magic functions that are aliases of each other.
        const unaryOperatorMap: { [operator: number]: string } = {
            [OperatorType.Add]: '__pos__',
            [OperatorType.Subtract]: '__neg__',
            [OperatorType.BitwiseInvert]: '__invert__'
        };

        let type: Type | undefined;

        if (node.operator !== OperatorType.Not) {
            if (TypeUtils.isOptionalType(exprType)) {
                this._addDiagnostic(
                    this._fileInfo.diagnosticSettings.reportOptionalOperand,
                    `Operator '${ ParseTreeUtils.printOperator(node.operator) }' not ` +
                    `supported for 'None' type`,
                    node.expression);
                exprType = TypeUtils.removeNoneFromUnion(exprType);
            }
        }

        // __not__ always returns a boolean.
        if (node.operator === OperatorType.Not) {
            type = ScopeUtils.getBuiltInObject(this._scope, 'bool');
        } else {
            if (exprType.isAny()) {
                type = exprType;
            } else {
                const magicMethodName = unaryOperatorMap[node.operator];
                type = this._getTypeFromMagicMethodReturn(exprType, [],
                    magicMethodName, node);
            }

            if (!type) {
                this._addError(`Operator '${ ParseTreeUtils.printOperator(node.operator) }'` +
                    ` not supported for type '${ exprType.asString() }'`,
                    node);
                type = UnknownType.create();
            }
        }

        return { type, node };
    }

    private _getTypeFromBinaryExpression(node: BinaryExpressionNode): TypeResult {
        let leftType = this.getType(node.leftExpression);

        // Is this an AND operator? If so, we can assume that the
        // rightExpression won't be evaluated at runtime unless the
        // leftExpression evaluates to true.
        let typeConstraints: ConditionalTypeConstraintResults | undefined;
        let useIfConstraint = true;
        if (node.operator === OperatorType.And || node.operator === OperatorType.Or) {
            typeConstraints = this._buildTypeConstraints(node.leftExpression);
            useIfConstraint = node.operator === OperatorType.And;
        }

        let rightType: Type = UnknownType.create();
        this._useExpressionTypeConstraint(typeConstraints, useIfConstraint, () => {
            rightType = this.getType(node.rightExpression);
        });

        // Optional checks apply to all operations except for boolean operations.
        if (booleanOperatorMap[node.operator] === undefined) {
            if (TypeUtils.isOptionalType(leftType)) {
                // Skip the optional error reporting for == and !=, since
                // None is a valid operand for these operators.
                if (node.operator !== OperatorType.Equals && node.operator !== OperatorType.NotEquals) {
                    this._addDiagnostic(
                        this._fileInfo.diagnosticSettings.reportOptionalOperand,
                        `Operator '${ ParseTreeUtils.printOperator(node.operator) }' not ` +
                        `supported for 'None' type`,
                        node.leftExpression);
                }
                leftType = TypeUtils.removeNoneFromUnion(leftType);
            }

            // None is a valid operand for == and != even if the type stub says otherwise.
            if (node.operator === OperatorType.Equals || node.operator === OperatorType.NotEquals) {
                rightType = TypeUtils.removeNoneFromUnion(rightType);
            }
        }

        return {
            type: this._validateBinaryExpression(node.operator, leftType, rightType, node),
            node
        };
    }

    private _getTypeFromAugmentedExpression(node: AugmentedAssignmentExpressionNode): TypeResult {
        const operatorMap: { [operator: number]: [string, OperatorType] } = {
            [OperatorType.AddEqual]: ['__iadd__', OperatorType.Add],
            [OperatorType.SubtractEqual]: ['__isub__', OperatorType.Subtract],
            [OperatorType.MultiplyEqual]: ['__imul__', OperatorType.Multiply],
            [OperatorType.FloorDivideEqual]: ['__ifloordiv__', OperatorType.FloorDivide],
            [OperatorType.DivideEqual]: ['__itruediv__', OperatorType.Divide],
            [OperatorType.ModEqual]: ['__imod__', OperatorType.Mod],
            [OperatorType.PowerEqual]: ['__ipow__', OperatorType.Power],
            [OperatorType.MatrixMultiplyEqual]: ['__imatmul__', OperatorType.MatrixMultiply],
            [OperatorType.BitwiseAndEqual]: ['__iand__', OperatorType.BitwiseAnd],
            [OperatorType.BitwiseOrEqual]: ['__ior__', OperatorType.BitwiseOr],
            [OperatorType.BitwiseXorEqual]: ['__ixor__', OperatorType.BitwiseXor],
            [OperatorType.LeftShiftEqual]: ['__ilshift__', OperatorType.LeftShift],
            [OperatorType.RightShiftEqual]: ['__irshift__', OperatorType.RightShift]
        };

        let type: Type | undefined;

        const leftType = this.getType(node.leftExpression);
        const rightType = this.getType(node.rightExpression);

        if (!leftType.isAny() && !rightType.isAny()) {
            const magicMethodName = operatorMap[node.operator][0];
            type = this._getTypeFromMagicMethodReturn(rightType, [leftType],
                magicMethodName, node);
        }

        // If the LHS class didn't support the magic method for augmented
        // assignment, fall back on the normal binary expression evaluator.
        if (!type) {
            const binaryOperator = operatorMap[node.operator][1];
            type = this._validateBinaryExpression(binaryOperator, leftType, rightType, node);
        }

        return { type, node };
    }

    private _validateBinaryExpression(operator: OperatorType, leftType: Type, rightType: Type,
            errorNode: ExpressionNode): Type {

        let type: Type | undefined;

        if (arithmeticOperatorMap[operator]) {
            if (leftType.isAny() || rightType.isAny()) {
                // If either type is "Unknown" (versus Any), propagate the Unknown.
                if (leftType instanceof UnknownType || rightType instanceof UnknownType) {
                    type = UnknownType.create();
                } else {
                    type = AnyType.create();
                }
            } else {
                const supportsBuiltInTypes = arithmeticOperatorMap[operator][2];

                if (supportsBuiltInTypes) {
                    const simplifiedLeftType = TypeUtils.removeAnyFromUnion(leftType);
                    const simplifiedRightType = TypeUtils.removeAnyFromUnion(rightType);
                    if (simplifiedLeftType instanceof ObjectType && simplifiedRightType instanceof ObjectType) {
                        const builtInClassTypes = this._getBuiltInClassTypes(['int', 'float', 'complex']);
                        const getTypeMatch = (classType: ClassType): boolean[] => {
                            let foundMatch = false;
                            return builtInClassTypes.map(builtInType => {
                                if (builtInType && builtInType.isSameGenericClass(classType)) {
                                    foundMatch = true;
                                }
                                return foundMatch;
                            });
                        };

                        const leftClassMatches = getTypeMatch(simplifiedLeftType.getClassType());
                        const rightClassMatches = getTypeMatch(simplifiedRightType.getClassType());

                        if (leftClassMatches[0] && rightClassMatches[0]) {
                            // If they're both int types, the result is an int.
                            type = new ObjectType(builtInClassTypes[0]!);
                        } else if (leftClassMatches[1] && rightClassMatches[1]) {
                            // If they're both floats or one is a float and one is an int,
                            // the result is a float.
                            type = new ObjectType(builtInClassTypes[1]!);
                        } else if (leftClassMatches[2] && rightClassMatches[2]) {
                            // If one is complex and the other is complex, float or int,
                            // the result is complex.
                            type = new ObjectType(builtInClassTypes[2]!);
                        }
                    }
                }
            }

            // Handle the general case.
            if (!type) {
                const magicMethodName = arithmeticOperatorMap[operator][0];
                type = this._getTypeFromMagicMethodReturn(leftType, [rightType],
                    magicMethodName, errorNode);

                if (!type) {
                    const altMagicMethodName = arithmeticOperatorMap[operator][1];
                    type = this._getTypeFromMagicMethodReturn(rightType, [leftType],
                        altMagicMethodName, errorNode);
                }
            }
        } else if (bitwiseOperatorMap[operator]) {
            if (leftType.isAny() || rightType.isAny()) {
                // If either type is "Unknown" (versus Any), propagate the Unknown.
                if (leftType instanceof UnknownType || rightType instanceof UnknownType) {
                    type = UnknownType.create();
                } else {
                    type = AnyType.create();
                }
            } else if (leftType instanceof ObjectType && rightType instanceof ObjectType) {
                const intType = ScopeUtils.getBuiltInType(this._scope, 'int');
                const leftIsInt = intType instanceof ClassType &&
                    leftType.getClassType().isSameGenericClass(intType);
                const rightIsInt = intType instanceof ClassType &&
                    rightType.getClassType().isSameGenericClass(intType);

                if (leftIsInt && rightIsInt) {
                    type = new ObjectType(intType as ClassType);
                }
            }

            // Handle the general case.
            if (!type) {
                const magicMethodName = bitwiseOperatorMap[operator][0];
                type = this._getTypeFromMagicMethodReturn(leftType, [rightType],
                    magicMethodName, errorNode);
            }
        } else if (comparisonOperatorMap[operator]) {
            if (leftType.isAny() || rightType.isAny()) {
                // If either type is "Unknown" (versus Any), propagate the Unknown.
                if (leftType instanceof UnknownType || rightType instanceof UnknownType) {
                    type = UnknownType.create();
                } else {
                    type = AnyType.create();
                }
            } else {
                const magicMethodName = comparisonOperatorMap[operator];

                type = this._getTypeFromMagicMethodReturn(leftType, [rightType],
                    magicMethodName, errorNode);
            }
        } else if (booleanOperatorMap[operator]) {
            if (operator === OperatorType.And) {
                // If the operator is an AND or OR, we need to combine the two types.
                type = TypeUtils.combineTypes([
                    TypeUtils.removeTruthinessFromType(leftType), rightType]);
            } else if (operator === OperatorType.Or) {
                type = TypeUtils.combineTypes([
                    TypeUtils.removeFalsinessFromType(leftType), rightType]);
            } else {
                // The other boolean operators always return a bool value.
                type = ScopeUtils.getBuiltInObject(this._scope, 'bool');
            }
        }

        if (!type) {
            this._addError(`Operator '${ ParseTreeUtils.printOperator(operator) }' not ` +
                `supported for types '${ leftType.asString() }' and '${ rightType.asString() }'`,
                errorNode);
            type = UnknownType.create();
        }

        return type;
    }

    private _getTypeFromMagicMethodReturn(objType: Type, args: Type[],
            magicMethodName: string, errorNode: ExpressionNode): Type | undefined {

        let magicMethodSupported = true;

        // Create a helper lambda for object subtypes.
        const handleObjectSubtype = (subtype: ObjectType) => {
            const magicMethodType = this.getTypeFromObjectMember(errorNode,
                subtype, magicMethodName,
                { method: 'get' }, MemberAccessFlags.SkipForMethodLookup);

            if (magicMethodType) {
                const functionArgs = args.map(arg => {
                    return {
                        argumentCategory: ArgumentCategory.Simple,
                        type: arg
                    };
                });

                let returnType: Type | undefined;

                this._silenceDiagnostics(() => {
                    returnType = this._validateCallArguments(errorNode,
                            functionArgs, magicMethodType, new TypeVarMap());
                });

                if (!returnType) {
                    magicMethodSupported = false;
                }

                return returnType;
            }

            magicMethodSupported = false;
            return undefined;
        };

        const returnType = TypeUtils.doForSubtypes(objType, subtype => {
            if (subtype.isAny()) {
                return subtype;
            }

            if (subtype instanceof ObjectType) {
                return handleObjectSubtype(subtype);
            } else if (subtype instanceof NoneType) {
                // NoneType derives from 'object', so do the lookup on 'object'
                // in this case.
                const obj = ScopeUtils.getBuiltInObject(this._scope, 'object');
                if (obj instanceof ObjectType) {
                    return handleObjectSubtype(obj);
                }
            }

            magicMethodSupported = false;
            return undefined;
        });

        if (!magicMethodSupported) {
            return undefined;
        }

        return returnType;
    }

    private _getBuiltInClassTypes(names: string[]): (ClassType | undefined)[] {
        return names.map(name => {
            const classType = ScopeUtils.getBuiltInType(this._scope, name);
            return classType instanceof ClassType ? classType : undefined;
        });
    }

    private _getTypeFromSetExpression(node: SetNode): TypeResult {
        const entryTypes: Type[] = [];

        // Infer the set type based on the entries.
        node.entries.forEach(entryNode => {
            if (entryNode instanceof ListComprehensionNode) {
                const setEntryType = this._getElementTypeFromListComprehensionExpression(entryNode);
                entryTypes.push(setEntryType);
            } else {
                entryTypes.push(this._getTypeFromExpression(entryNode).type);
            }
        });

        const inferredEntryType = entryTypes.length > 0 ?
            TypeUtils.combineTypes(entryTypes) :
            UnknownType.create();

        const type = ScopeUtils.getBuiltInObject(this._scope, 'set', [inferredEntryType]);

        return { type, node };
    }

    private _getTypeFromDictionaryExpression(node: DictionaryNode): TypeResult {
        let valueType: Type = AnyType.create();
        let keyType: Type = AnyType.create();

        const keyTypes: Type[] = [];
        const valueTypes: Type[] = [];

        // Infer the key and value types if possible.
        node.entries.forEach(entryNode => {
            let addUnknown = true;

            if (entryNode instanceof DictionaryKeyEntryNode) {

                keyTypes.push(TypeUtils.stripLiteralValue(
                    this.getType(entryNode.keyExpression)));
                valueTypes.push(TypeUtils.stripLiteralValue(
                    this.getType(entryNode.valueExpression)));
                addUnknown = false;

            } else if (entryNode instanceof DictionaryExpandEntryNode) {
                const unexpandedType = this.getType(entryNode.expandExpression);
                if (unexpandedType.isAny()) {
                    addUnknown = false;
                } else {
                    if (unexpandedType instanceof ObjectType) {
                        let classType = unexpandedType.getClassType();
                        const aliasClass = classType.getAliasClass();
                        if (aliasClass) {
                            classType = aliasClass;
                        }

                        if (classType.isBuiltIn() && classType.getClassName() === 'dict') {
                            const typeArgs = classType.getTypeArguments();
                            if (typeArgs && typeArgs.length >= 2) {
                                keyTypes.push(typeArgs[0]);
                                valueTypes.push(typeArgs[1]);
                                addUnknown = false;
                            }
                        }
                    }
                }
            } else if (entryNode instanceof ListComprehensionNode) {
                const dictEntryType = this._getElementTypeFromListComprehensionExpression(
                    node.entries[0] as ListComprehensionNode<DictionaryKeyEntryNode>);

                // The result should be a Tuple
                if (dictEntryType instanceof ObjectType) {
                    const classType = dictEntryType.getClassType();
                    if (classType.isBuiltIn() && classType.getClassName() === 'Tuple') {
                        const typeArgs = classType.getTypeArguments();
                        if (typeArgs && typeArgs.length === 2) {
                            keyTypes.push(typeArgs[0]);
                            valueTypes.push(typeArgs[1]);
                            addUnknown = false;
                        }
                    }
                }
            }

            if (addUnknown) {
                keyTypes.push(UnknownType.create());
                valueTypes.push(UnknownType.create());
            }
        });

        keyType = keyTypes.length > 0 ? TypeUtils.combineTypes(keyTypes) : AnyType.create();

        // If the value type differs and we're not using "strict inference mode",
        // we need to back off because we can't properly represent the mappings
        // between different keys and associated value types. If all the values
        // are the same type, we'll assume that all values in this dictionary should
        // be the same.
        if (valueTypes.length > 0) {
            if (this._fileInfo.diagnosticSettings.strictDictionaryInference) {
                valueType = TypeUtils.combineTypes(valueTypes);
            } else {
                valueType = TypeUtils.areTypesSame(valueTypes) ? valueTypes[0] : UnknownType.create();
            }
        } else {
            valueType = AnyType.create();
        }

        const type = ScopeUtils.getBuiltInObject(this._scope, 'dict', [keyType, valueType]);

        return { type, node };
    }

    private _getTypeFromListExpression(node: ListNode): TypeResult {
        let listEntryType: Type = AnyType.create();

        if (node.entries.length === 1 && node.entries[0] instanceof ListComprehensionNode) {
            listEntryType = this._getElementTypeFromListComprehensionExpression(
                node.entries[0] as ListComprehensionNode<ExpressionNode>);
        } else {
            const entryTypes = node.entries.map(
                entry => TypeUtils.stripLiteralValue(this.getType(entry)));

            if (entryTypes.length > 0) {
                if (this._fileInfo.diagnosticSettings.strictListInference) {
                    listEntryType = TypeUtils.combineTypes(entryTypes);
                } else {
                    // Is the list homogeneous? If so, use stricter rules. Otherwise relax the rules.
                    listEntryType = TypeUtils.areTypesSame(entryTypes) ? entryTypes[0] : UnknownType.create();
                }
            }
        }

        const type = ScopeUtils.getBuiltInObject(this._scope, 'list', [listEntryType]);

        return { type, node };
    }

    private _getTypeFromTernaryExpression(node: TernaryExpressionNode, flags: EvaluatorFlags): TypeResult {
        this._getTypeFromExpression(node.testExpression);

        // Apply the type constraint when evaluating the if and else clauses.
        const typeConstraints = this._buildTypeConstraints(node.testExpression);

        let ifType: TypeResult | undefined;
        this._useExpressionTypeConstraint(typeConstraints, true, () => {
            ifType = this._getTypeFromExpression(node.ifExpression,
                { method: 'get' }, flags);
        });

        let elseType: TypeResult | undefined;
        this._useExpressionTypeConstraint(typeConstraints, false, () => {
            elseType = this._getTypeFromExpression(node.elseExpression,
                { method: 'get' }, flags);
        });

        const type = TypeUtils.combineTypes([ifType!.type, elseType!.type]);
        return { type, node };
    }

    private _getTypeFromYieldExpression(node: YieldExpressionNode): TypeResult {
        let sentType: Type | undefined;

        const enclosingFunction = ParseTreeUtils.getEnclosingFunction(node);
        if (enclosingFunction) {
            const functionType = AnalyzerNodeInfo.getExpressionType(enclosingFunction)! as FunctionType;
            assert(functionType instanceof FunctionType);
            sentType = TypeUtils.getDeclaredGeneratorSendType(functionType);
        }

        if (!sentType) {
            sentType = UnknownType.create();
        }

        return { type: sentType, node };
    }

    private _getTypeFromYieldFromExpression(node: YieldFromExpressionNode): TypeResult {
        let sentType: Type | undefined;

        const enclosingFunction = ParseTreeUtils.getEnclosingFunction(node);
        if (enclosingFunction) {
            const functionType = AnalyzerNodeInfo.getExpressionType(enclosingFunction)! as FunctionType;
            assert(functionType instanceof FunctionType);
            sentType = TypeUtils.getDeclaredGeneratorSendType(functionType);
        }

        if (!sentType) {
            sentType = UnknownType.create();
        }

        return { type: sentType, node };
    }

    private _getTypeFromLambdaExpression(node: LambdaNode): TypeResult {
        // The lambda node is updated by typeAnalyzer. If the type wasn't
        // already cached, we'll return an unknown type.
        let type = AnalyzerNodeInfo.getExpressionType(node);
        if (!type) {
            type = UnknownType.create();
        }

        return { type, node };
    }

    private _getTypeFromListComprehensionExpression(node: ListComprehensionNode): TypeResult {
        const elementType = this._getElementTypeFromListComprehensionExpression(node);

        let type = UnknownType.create();
        const builtInIteratorType = this.getTypingType('Generator');

        if (builtInIteratorType instanceof ClassType) {
            type = new ObjectType(builtInIteratorType.cloneForSpecialization(
                [elementType]));
        }

        return { type, node };
    }

    private _assignTypeToNameNode(targetExpr: NameNode, type: Type) {
        const symbol = this._scope.addSymbol(targetExpr.nameToken.value, false);
        symbol.setInferredTypeForSource(type, AnalyzerNodeInfo.getTypeSourceId(
            targetExpr, this._fileInfo.filePathHash));

        // Mark the symbol as accessed. These symbols are not persisted
        // between analysis passes, so we never have an opportunity to
        // mark them as accessed.
        symbol.setIsAcccessed();

        const typeConstraint = TypeConstraintBuilder.buildTypeConstraintForAssignment(targetExpr, type);
        if (typeConstraint) {
            this._scope.addTypeConstraint(typeConstraint);
        }
    }

    private _assignTypeToExpression(targetExpr: ExpressionNode, type: Type, srcExpr: ExpressionNode): boolean {
        let understoodType = true;

        if (targetExpr instanceof NameNode) {
            this._assignTypeToNameNode(targetExpr, type);
        } else if (targetExpr instanceof TupleExpressionNode) {
            // Initialize the array of target types, one for each target.
            const targetTypes: Type[][] = new Array(targetExpr.expressions.length);
            for (let i = 0; i < targetExpr.expressions.length; i++) {
                targetTypes[i] = [];
            }

            TypeUtils.doForSubtypes(type, subtype => {
                // Is this subtype a tuple?
                const tupleType = TypeUtils.getSpecializedTupleType(subtype);
                if (tupleType && tupleType.getTypeArguments()) {
                    const entryTypes = tupleType.getTypeArguments()!;
                    let entryCount = entryTypes.length;
                    const allowsMoreEntries = entryCount > 0 &&
                        TypeUtils.isEllipsisType(entryTypes[entryCount - 1]);
                    if (allowsMoreEntries) {
                        entryCount--;
                    }

                    if (targetExpr.expressions.length === entryCount ||
                            (allowsMoreEntries && targetExpr.expressions.length >= entryCount)) {
                        for (let index = 0; index < targetExpr.expressions.length; index++) {
                            const entryType = index < entryCount ? entryTypes[index] : UnknownType.create();
                            targetTypes[index].push(entryType);
                        }
                    }
                } else {
                    // The assigned expression isn't a tuple, so it had better
                    // be some iterable type.
                    const iterableType = this.getTypeFromIterable(subtype, false, srcExpr, false);
                    for (let index = 0; index < targetExpr.expressions.length; index++) {
                        targetTypes[index].push(iterableType);
                    }
                }

                // We need to return something to satisfy doForSubtypes.
                return undefined;
            });

            // Assign the resulting types to the individual names in the tuple target expression.
            targetExpr.expressions.forEach((expr, index) => {
                const typeList = targetTypes[index];
                const targetType = typeList.length === 0 ? UnknownType.create() : TypeUtils.combineTypes(typeList);
                if (!this._assignTypeToExpression(expr, targetType, srcExpr)) {
                    understoodType = false;
                }
            });
        } else {
            // We should theoretically never get here.
            understoodType = false;
        }

        // Cache the type so we don't evaluate it again.
        if (this._writeTypeToCache) {
            this._writeTypeToCache(targetExpr, type);
        }

        return understoodType;
    }

    // Returns the type of one entry returned by the list comprehension,
    // as opposed to the entire list.
    private _getElementTypeFromListComprehensionExpression(node: ListComprehensionNode): Type {
        // Create a temporary scope since list comprehension target
        // variables are private to the list comprehension expression.
        const prevScope = this._scope;
        this._scope = new Scope(ScopeType.Temporary, this._scope);

        // There are some variants that we may not understand. If so,
        // we will set this flag and fall back on Unkown.
        let understoodType = true;

        let typeConstraints: ConditionalTypeConstraintResults | undefined;

        // "Execute" the list comprehensions from start to finish.
        for (let i = 0; i < node.comprehensions.length; i++) {
            const comprehension = node.comprehensions[i];

            if (comprehension instanceof ListComprehensionForNode) {
                const iterableType = TypeUtils.stripLiteralValue(
                    this.getType(comprehension.iterableExpression));
                const itemType = this.getTypeFromIterable(iterableType, !!comprehension.isAsync,
                    comprehension.iterableExpression, false);

                const targetExpr = comprehension.targetExpression;
                if (!this._assignTypeToExpression(targetExpr, itemType, comprehension.iterableExpression)) {
                    understoodType = false;
                    break;
                }
            } else if (comprehension instanceof ListComprehensionIfNode) {
                // Use the if node (if present) to create a type constraint.
                typeConstraints = TypeConstraintBuilder.buildTypeConstraintsForConditional(
                    comprehension.testExpression, expr => TypeUtils.stripLiteralValue(
                        this.getType(expr)));
            }
        }

        let type = UnknownType.create();
        this._useExpressionTypeConstraint(typeConstraints, true, () => {
            if (understoodType) {
                if (node.expression instanceof DictionaryKeyEntryNode) {
                    // Create a tuple with the key/value types.
                    const keyType = TypeUtils.stripLiteralValue(
                        this.getType(node.expression.keyExpression));
                    const valueType = TypeUtils.stripLiteralValue(
                        this.getType(node.expression.valueExpression));

                    type = ScopeUtils.getBuiltInObject(
                        this._scope, 'Tuple', [keyType, valueType]);
                } else if (node.expression instanceof DictionaryExpandEntryNode) {
                    const unexpandedType = this.getType(node.expression.expandExpression);

                    // TODO - need to implement
                } else if (node.expression instanceof ExpressionNode) {
                    type = TypeUtils.stripLiteralValue(this.getType(node.expression));
                }
            }
        });

        this._scope = prevScope;

        return type;
    }

    private _getTypeFromSliceExpression(node: SliceExpressionNode): TypeResult {
        const intObject = ScopeUtils.getBuiltInObject(this._scope, 'int');
        const optionalIntObject = TypeUtils.combineTypes([intObject, NoneType.create()]);

        const validateIndexType = (indexExpr: ExpressionNode) => {
            const exprType = TypeUtils.stripLiteralValue(this.getType(indexExpr));

            const diag = new DiagnosticAddendum();
            if (!TypeUtils.canAssignType(optionalIntObject, exprType, diag)) {
                this._addError(
                    `Index for slice operation must be an int value or None` + diag.getString(),
                    indexExpr);
            }
        };

        // Validate the index values.
        if (node.startValue) {
            validateIndexType(node.startValue);
        }

        if (node.endValue) {
            validateIndexType(node.endValue);
        }

        if (node.stepValue) {
            validateIndexType(node.stepValue);
        }

        const sliceObject = ScopeUtils.getBuiltInObject(this._scope, 'slice');
        return { type: sliceObject, node };
    }

    // Converts the type parameters for a Callable type. It should
    // have zero to two parameters. The first parameter, if present, should be
    // either an ellipsis or a list of parameter types. The second parameter, if
    // present, should specify the return type.
    private _createCallableType(typeArgs?: TypeResult[]): FunctionType {
        const functionType = new FunctionType(FunctionTypeFlags.None);
        functionType.setDeclaredReturnType(AnyType.create());

        if (typeArgs && typeArgs.length > 0) {
            if (typeArgs[0].typeList) {
                typeArgs[0].typeList.forEach((entry, index) => {
                    if (TypeUtils.isEllipsisType(entry.type)) {
                        this._addError(`'...' not allowed in this context`, entry.node);
                    } else if (entry.type instanceof ModuleType) {
                        this._addError(`Module not allowed in this context`, entry.node);
                    }

                    functionType.addParameter({
                        category: ParameterCategory.Simple,
                        name: `p${ index.toString() }`,
                        type: TypeUtils.convertClassToObject(entry.type)
                    });
                });
            } else if (TypeUtils.isEllipsisType(typeArgs[0].type)) {
                TypeUtils.addDefaultFunctionParameters(functionType);
            } else {
                this._addError(`Expected parameter type list or '...'`, typeArgs[0].node);
            }
        } else {
            TypeUtils.addDefaultFunctionParameters(functionType);
        }

        if (typeArgs && typeArgs.length > 1) {
            if (TypeUtils.isEllipsisType(typeArgs[1].type)) {
                this._addError(`'...' not allowed in this context`, typeArgs[1].node);
            } else if (typeArgs[1].type instanceof ModuleType) {
                this._addError(`Module not allowed in this context`, typeArgs[1].node);
            }
            functionType.setDeclaredReturnType(TypeUtils.convertClassToObject(typeArgs[1].type));
        } else {
            functionType.setDeclaredReturnType(AnyType.create());
        }

        if (typeArgs && typeArgs.length > 2) {
            this._addError(`Expected only two type arguments to 'Callable'`, typeArgs[2].node);
        }

        return functionType;
    }

    // Creates an Optional[X, Y, Z] type.
    private _createOptionalType(errorNode: ExpressionNode, typeArgs?: TypeResult[]): Type {
        if (!typeArgs || typeArgs.length !== 1) {
            this._addError(`Expected one type parameter after Optional`, errorNode);
            return UnknownType.create();
        }

        if (TypeUtils.isEllipsisType(typeArgs[0].type)) {
            this._addError(`'...' not allowed in this context`, typeArgs[0].node);
        } else if (typeArgs[0].type instanceof ModuleType) {
            this._addError(`Module not allowed in this context`, typeArgs[0].node);
        }

        return TypeUtils.combineTypes([
            TypeUtils.convertClassToObject(typeArgs[0].type),
            NoneType.create()]);
    }

    private _cloneBuiltinTypeWithLiteral(builtInName: string, value: LiteralValue): Type {
        let type = ScopeUtils.getBuiltInObject(this._scope, builtInName);
        if (type instanceof ObjectType) {
            type = type.cloneWithLiteral(value);
        }

        return type;
    }

    // Creates a type that represents a Literal. This is not an officially-supported
    // feature of Python but is instead a mypy extension described here:
    // https://mypy.readthedocs.io/en/latest/literal_types.html
    private _createLiteralType(node: IndexExpressionNode): Type {
        if (node.items.items.length === 0) {
            this._addError(`Expected a type parameter after Literal`, node.baseExpression);
            return UnknownType.create();
        }

        // As per the specification, we support int, bool, str, and bytes literals.
        const literalTypes: Type[] = [];

        for (const item of node.items.items) {
            let type: Type | undefined;

            if (item instanceof StringListNode) {
                // Note that the contents of the string should not be treated
                // as a type annotation, as they normally are for quoted type
                // arguments.
                AnalyzerNodeInfo.setIgnoreTypeAnnotation(item);

                const isBytes = (item.strings[0].token.flags & StringTokenFlags.Bytes) !== 0;
                if (isBytes) {
                    type = this._cloneBuiltinTypeWithLiteral('bytes', item.getValue());
                } else {
                    type = this._cloneBuiltinTypeWithLiteral('str', item.getValue());
                }
            } else if (item instanceof NumberNode) {
                if (item.token.isInteger) {
                    type = this._cloneBuiltinTypeWithLiteral('int', item.token.value);
                }
            } else if (item instanceof ConstantNode) {
                if (item.token.keywordType === KeywordType.True) {
                    type = this._cloneBuiltinTypeWithLiteral('bool', true);
                } else if (item.token.keywordType === KeywordType.False) {
                    type = this._cloneBuiltinTypeWithLiteral('bool', false);
                }
            }

            if (!type) {
                this._addError(`Type arguments for Literal must be an int, bool, str, or bytes value`,
                    item);
                type = UnknownType.create();
            }

            literalTypes.push(type);
        }

        return TypeUtils.convertClassToObject(TypeUtils.combineTypes(literalTypes));
    }

    // Creates a ClassVar type.
    private _createClassVarType(errorNode: ExpressionNode, typeArgs: TypeResult[] | undefined): Type {
        if (!typeArgs || typeArgs.length === 0) {
            this._addError(`Expected a type parameter after ClassVar`, errorNode);
            return UnknownType.create();
        } else if (typeArgs.length > 1) {
            this._addError(`Expected only one type parameter after ClassVar`, typeArgs[1].node);
            return UnknownType.create();
        }

        const type = typeArgs[0].type;

        if (type.requiresSpecialization()) {
            this._addError(`ClassVar cannot contain generic type variables`,
                typeArgs.length > 0 ? typeArgs[0].node : errorNode);
            return UnknownType.create();
        }

        return TypeUtils.convertClassToObject(type);
    }

    // Creates one of several "special" types that are defined in typing.pyi
    // but not declared in their entirety. This includes the likes of "Tuple",
    // "Dict", etc.
    private _createSpecialType(classType: ClassType, typeArgs: TypeResult[] | undefined,
            paramLimit?: number, allowEllipsis = false): Type {

        if (typeArgs) {
            // Verify that we didn't receive any inappropriate ellipses or modules.
            typeArgs.forEach((typeArg, index) => {
                if (TypeUtils.isEllipsisType(typeArg.type)) {
                    if (!allowEllipsis || index !== typeArgs.length - 1) {
                        this._addError(`'...' not allowed in this context`, typeArgs[index].node);
                    }
                    if (typeArg.type instanceof ModuleType) {
                        this._addError(`Module not allowed in this context`, typeArg.node);
                    }
                }
            });
        }

        let typeArgTypes = typeArgs ? typeArgs.map(
            t => TypeUtils.convertClassToObject(t.type)) : [];

        // Make sure the argument list count is correct.
        if (paramLimit !== undefined) {
            if (typeArgs && typeArgTypes.length > paramLimit) {
                this._addError(
                    `Expected at most ${ paramLimit } type arguments`, typeArgs[paramLimit].node);
                typeArgTypes = typeArgTypes.slice(0, paramLimit);
            } else if (typeArgTypes.length < paramLimit) {
                // Fill up the remainder of the slots with unknown types.
                while (typeArgTypes.length < paramLimit) {
                    typeArgTypes.push(UnknownType.create());
                }
            }
        }

        const specializedType = classType.cloneForSpecialization(typeArgTypes);

        return specializedType;
    }

    // Unpacks the index expression for a "Union[X, Y, Z]" type annotation.
    private _createUnionType(typeArgs?: TypeResult[]): Type {
        const types: Type[] = [];

        if (typeArgs) {
            for (const typeArg of typeArgs) {
                types.push(typeArg.type);

                // Verify that we didn't receive any inappropriate ellipses.
                if (TypeUtils.isEllipsisType(typeArg.type)) {
                    this._addError(`'...' not allowed in this context`, typeArg.node);
                } else if (typeArg.type instanceof ModuleType) {
                    this._addError(`Module not allowed in this context`, typeArg.node);
                }
            }
        }

        if (types.length > 0) {
            return TypeUtils.combineTypes(types);
        }

        return NeverType.create();
    }

    // Creates a type that represents "Generic[T1, T2, ...]", used in the
    // definition of a generic class.
    private _createGenericType(errorNode: ExpressionNode, classType: ClassType,
            typeArgs?: TypeResult[]): Type {

        // Make sure there's at least one type arg.
        if (!typeArgs || typeArgs.length === 0) {
            this._addError(
                `'Generic' requires at least one type argument`, errorNode);
        }

        // Make sure that all of the type args are typeVars and are unique.
        const uniqueTypeVars: TypeVarType[] = [];
        if (typeArgs) {
            typeArgs.forEach(typeArg => {
                if (!(typeArg.type instanceof TypeVarType)) {
                    this._addError(
                        `Type argument for 'Generic' must be a type variable`, typeArg.node);
                } else {
                    for (const typeVar of uniqueTypeVars) {
                        if (typeVar === typeArg.type) {
                            this._addError(
                                `Type argument for 'Generic' must be unique`, typeArg.node);
                            break;
                        }
                    }

                    uniqueTypeVars.push(typeArg.type);
                }
            });
        }

        return this._createSpecialType(classType, typeArgs);
    }

    private _createSpecializedClassType(classType: ClassType, typeArgs?: TypeResult[]): Type {
        let typeArgCount = typeArgs ? typeArgs.length : 0;

        // Make sure the argument list count is correct.
        const typeParameters = classType.getTypeParameters();

        // If there are no type parameters or args, the class is already specialized.
        // No need to do any more work.
        if (typeParameters.length === 0 && typeArgCount === 0) {
            return classType;
        }

        if (typeArgs && typeArgCount > typeParameters.length) {
            if (typeParameters.length === 0) {
                this._addError(`Expected no type arguments`,
                    typeArgs[typeParameters.length].node);
            } else {
                this._addError(
                    `Expected at most ${ typeParameters.length } type arguments`,
                    typeArgs[typeParameters.length].node);
            }
            typeArgCount = typeParameters.length;
        }

        if (typeArgs) {
            typeArgs.forEach(typeArg => {
                // Verify that we didn't receive any inappropriate ellipses or modules.
                if (TypeUtils.isEllipsisType(typeArg.type)) {
                    this._addError(`'...' not allowed in this context`, typeArg.node);
                } else if (typeArg.type instanceof ModuleType) {
                    this._addError(`Module not allowed in this context`, typeArg.node);
                }
            });
        }

        // Fill in any missing type arguments with Any.
        const typeArgTypes = typeArgs ? typeArgs.map(
            t => TypeUtils.convertClassToObject(t.type)) : [];
        const typeParams = classType.getTypeParameters();
        for (let i = typeArgTypes.length; i < typeParams.length; i++) {
            typeArgTypes.push(TypeUtils.specializeTypeVarType(typeParams[i]));
        }

        typeArgTypes.forEach((typeArgType, index) => {
            if (index < typeArgCount) {
                const diag = new DiagnosticAddendum();
                if (!TypeUtils.canAssignToTypeVar(typeParameters[index], typeArgType, diag)) {
                    this._addError(`Type '${ typeArgType.asString() }' ` +
                            `cannot be assigned to type variable '${ typeParameters[index].getName() }'` +
                            diag.getString(),
                        typeArgs![index].node);
                }
            }
        });

        const specializedClass = classType.cloneForSpecialization(typeArgTypes);

        return specializedClass;
    }

    private _applyTypeConstraint(node: ExpressionNode, unconstrainedType: Type): Type {
        // Shortcut the process if the type is unknown.
        if (unconstrainedType.isAny()) {
            return unconstrainedType;
        }

        // Apply constraints from the current scope and its outer scopes.
        let constrainedType = this._applyScopeTypeConstraintRecursive(
            node, unconstrainedType);

        // Apply constraints associated with the expression we're
        // currently walking.
        this._expressionTypeConstraints.forEach(constraint => {
            constrainedType = constraint.applyToType(node, constrainedType);
        });

        return constrainedType;
    }

    private _applyScopeTypeConstraintRecursive(node: ExpressionNode, type: Type,
            scope = this._scope): Type {

        // If we've hit a scope that is independently executable, don't recurse any further.
        if (!scope.isIndependentlyExecutable()) {
            // Recursively allow the parent scopes to apply their type constraints.
            const parentScope = scope.getParent();
            if (parentScope) {
                type = this._applyScopeTypeConstraintRecursive(node, type, parentScope);
            }
        }

        // Apply the constraints within the current scope. Stop if one of
        // them indicates that further constraints shouldn't be applied.
        for (const constraint of scope.getTypeConstraints()) {
            type = constraint.applyToType(node, type);
        }

        return type;
    }

    // Specializes the specified (potentially generic) class type using
    // the specified type arguments, reporting errors as appropriate.
    // Returns the specialized type and a boolean indicating whether
    // the type indicates a class type (true) or an object type (false).
    private _createSpecializeClassType(classType: ClassType, typeArgs: TypeResult[] | undefined,
            errorNode: ExpressionNode): Type {

        // Handle the special-case classes that are not defined
        // in the type stubs.
        if (classType.isSpecialBuiltIn()) {
            const className = classType.getClassName();

            switch (className) {
                case 'Callable': {
                    return this._createCallableType(typeArgs);
                }

                case 'Optional': {
                    return this._createOptionalType(errorNode, typeArgs);
                }

                case 'Type': {
                    return this._createSpecialType(classType, typeArgs, 1);
                }

                case 'ClassVar': {
                    return this._createClassVarType(errorNode, typeArgs);
                }

                case 'Deque':
                case 'List':
                case 'FrozenSet':
                case 'Set': {
                    return this._createSpecialType(classType, typeArgs, 1);
                }

                case 'ChainMap':
                case 'Dict':
                case 'DefaultDict': {
                    return this._createSpecialType(classType, typeArgs, 2);
                }

                case 'Protocol': {
                    return this._createSpecialType(classType, typeArgs, undefined);
                }

                case 'Tuple': {
                    return this._createSpecialType(classType, typeArgs, undefined, true);
                }

                case 'Union': {
                    return this._createUnionType(typeArgs);
                }

                case 'Generic':
                    return this._createGenericType(errorNode, classType, typeArgs);
            }
        }

        const specializedType = this._createSpecializedClassType(classType, typeArgs);
        return specializedType;
    }

    private _useExpressionTypeConstraint(typeConstraints:
            ConditionalTypeConstraintResults | undefined,
            useIfClause: boolean, callback: () => void) {

        // Push the specified constraints onto the list.
        let itemsToPop = 0;
        if (typeConstraints) {
            const constraintsToUse = useIfClause ?
                typeConstraints.ifConstraints : typeConstraints.elseConstraints;
            constraintsToUse.forEach(tc => {
                this._expressionTypeConstraints.push(tc);
                itemsToPop++;
            });
        }

        callback();

        // Clean up after ourself.
        for (let i = 0; i < itemsToPop; i++) {
            this._expressionTypeConstraints.pop();
        }
    }

    private _buildTypeConstraints(node: ExpressionNode) {
        return TypeConstraintBuilder.buildTypeConstraintsForConditional(node,
            (node: ExpressionNode) => this.getType(node));
    }

    private _silenceDiagnostics(callback: () => void) {
        const oldDiagSink = this._diagnosticSink;
        this._diagnosticSink = undefined;

        callback();

        this._diagnosticSink = oldDiagSink;
    }

    private _addWarning(message: string, range: TextRange) {
        if (this._diagnosticSink) {
            this._diagnosticSink.addWarningWithTextRange(message, range);
        }
    }

    private _addError(message: string, range: TextRange) {
        if (this._diagnosticSink) {
            this._diagnosticSink.addErrorWithTextRange(message, range);
        }
    }

    private _addDiagnostic(diagLevel: DiagnosticLevel, message: string, textRange: TextRange) {
        if (diagLevel === 'error') {
            this._addError(message, textRange);
        } else if (diagLevel === 'warning') {
            this._addWarning(message, textRange);
        }
    }
}
