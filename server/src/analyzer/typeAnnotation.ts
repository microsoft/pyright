/*
* typeAnnotation.ts
* Copyright (c) Microsoft Corporation. All rights reserved.
* Author: Eric Traut
*
* Class that handles interpretation of type annotations,
* converting the parsed annotation into an internal type
* that can be used for type analysis.
*/

import { TextRangeDiagnosticSink } from '../common/diagnosticSink';
import StringMap from '../common/stringMap';
import { ArgumentCategory, CallExpressionNode, ConstantNode, DictionaryNode,
    EllipsisNode, ExpressionNode, FunctionNode, IndexExpressionNode, ListNode,
    MemberAccessExpressionNode, NameNode, NumberNode, ParameterCategory,
    SetNode, StringNode, TupleExpressionNode } from '../parser/parseNodes';
import { KeywordToken, KeywordType, QuoteTypeFlags, TokenType } from '../parser/tokenizerTypes';
import { AnalyzerNodeInfo } from './analyzerNodeInfo';
import { DefaultTypeSourceId } from './inferredType';
import { ParseTreeUtils } from './parseTreeUtils';
import { Scope, ScopeType } from './scope';
import { Symbol } from './symbol';
import { AnyType, ClassType, ClassTypeFlags, EllipsisType,
    FunctionParameter, FunctionType, FunctionTypeFlags, ModuleType, NoneType, ObjectType,
    OverloadedFunctionType, PropertyType, TupleType, Type, TypeVarType, UnionType, UnknownType } from './types';
import { TypeUtils } from './typeUtils';

export class TypeAnnotation {
    static getTypeFromName(node: NameNode, currentScope: Scope, diagSink: TextRangeDiagnosticSink,
            classNamesImplyObjects = true, transformBuiltInTypes = true): Type | undefined {
        let symbolInScope = currentScope.lookUpSymbolRecursive(node.nameToken.value);
        if (!symbolInScope) {
            return undefined;
        }

        let type = symbolInScope.symbol.currentType;
        if (type instanceof ClassType && type.isBuiltIn() && transformBuiltInTypes) {
            const className = type.getClassName();
            switch (className) {
                case 'Callable': {
                    // A 'Callable' with no parameters is a generic function.
                    type = this.getCallableType(undefined, currentScope, diagSink);
                    break;
                }

                case 'ChainMap':
                case 'DefaultDict':
                case 'Deque':
                case 'Dict':
                case 'FrozenSet':
                case 'List':
                case 'Set':
                case 'Tuple':
                case 'Type': {
                    type = this.getBuiltInType(currentScope, className.toLowerCase());
                    break;
                }

                case 'Union': {
                    diagSink.addErrorWithTextRange(
                        `Expected type parameters after ${ className }`, node);
                    break;
                }

                case 'ClassVar':
                case 'Counter':
                case 'Final':
                case 'Generic':
                case 'Literal':
                case 'Optional': {
                    diagSink.addErrorWithTextRange(
                        `Expected one type parameter after ${ className }`, node);
                    break;
                }
            }
        }

        if (type instanceof ClassType) {
            if (classNamesImplyObjects) {
                type = new ObjectType(type);
            }
        }
        return type;
    }

    static getType(node: ExpressionNode, currentScope: Scope, diagSink: TextRangeDiagnosticSink,
            classNamesImplyObjects = true, transformBuiltInTypes = true): Type {
        let type: Type | undefined;

        if (node instanceof NameNode) {
            type = this.getTypeFromName(node, currentScope,
                diagSink, false, transformBuiltInTypes);
        } else if (node instanceof EllipsisNode) {
            type = EllipsisType.create();
        } else if (node instanceof ConstantNode) {
            if (node.token.type === TokenType.Keyword) {
                if (node.token.keywordType === KeywordType.None) {
                    type = NoneType.create();
                } else if (node.token.keywordType === KeywordType.True ||
                        node.token.keywordType === KeywordType.False ||
                        node.token.keywordType === KeywordType.Debug) {
                    type = this.getBuiltInType(currentScope, 'bool');
                }
            }
        } else if (node instanceof MemberAccessExpressionNode) {
            let baseType = TypeAnnotation.getType(node.leftExpression, currentScope,
                diagSink, true, false);
            let memberName = node.memberName.nameToken.value;

            if (baseType.isAny()) {
                type = baseType;
            } else if (baseType instanceof ModuleType) {
                let fieldInfo = baseType.getFields().get(memberName);
                if (fieldInfo) {
                    type = fieldInfo.currentType;
                } else {
                    diagSink.addErrorWithTextRange(
                        `'${ memberName }' is not a known member of module`, node.memberName);
                    type = UnknownType.create();
                }
            } else if (baseType instanceof ClassType) {
                let fieldInfo = TypeUtils.lookUpClassMember(baseType, memberName);
                if (fieldInfo) {
                    type = TypeUtils.getEffectiveTypeOfMember(fieldInfo);
                } else {
                    diagSink.addErrorWithTextRange(
                        `'${ memberName }' is not a known member of '${ baseType.asString() }'`,
                        node.memberName);
                    type = UnknownType.create();
                }
            } else if (baseType instanceof ObjectType) {
                let fieldInfo = TypeUtils.lookUpClassMember(baseType.getClassType(), memberName);
                if (fieldInfo) {
                    type = TypeUtils.getEffectiveTypeOfMember(fieldInfo);
                } else {
                    diagSink.addErrorWithTextRange(
                        `'${ memberName }' is not a known member of '${ baseType.asString() }'`,
                        node.memberName);
                    type = UnknownType.create();
                }
            }
        } else if (node instanceof IndexExpressionNode) {
            let baseType = TypeAnnotation.getType(node.baseExpression, currentScope,
                diagSink, false, false);

            if (baseType.isAny()) {
                type = baseType;
            } else if (baseType instanceof ClassType) {
                if (baseType instanceof ClassType && baseType.isSpecialBuiltIn()) {
                    const className = baseType.getClassName();
                    switch (className) {
                        case 'Callable': {
                            type = this.getCallableType(node.indexExpression, currentScope, diagSink);
                            break;
                        }

                        case 'Optional': {
                            type = this.getOptionalType(node.indexExpression, currentScope, diagSink);
                            break;
                        }

                        case 'Type': {
                            type = this.getTypeType(node.indexExpression, currentScope, diagSink);
                            classNamesImplyObjects = false;
                            break;
                        }

                        case 'ClassVar':
                        case 'Deque':
                        case 'Generic':
                        case 'List':
                        case 'FrozenSet':
                        case 'Set': {
                            type = this.getOneParameterType(className, node.indexExpression,
                                currentScope, diagSink);
                            break;
                        }

                        case 'ChainMap':
                        case 'Dict':
                        case 'DefaultDict': {
                            type = this.getTwoParameterType(className, node.indexExpression,
                                currentScope, diagSink);
                            break;
                        }

                        case 'Protocol':
                        case 'Tuple': {
                            type = this.getArbitraryParameterType(className, node.indexExpression,
                                currentScope, diagSink);
                            break;
                        }

                        case 'Union': {
                            type = this.getUnionType(node.indexExpression, currentScope, diagSink);
                            break;
                        }

                        default: {
                            // TODO - need to handle more
                            type = UnknownType.create();
                            diagSink.addErrorWithTextRange(
                                `'Unsupported type expression: indexed ${ baseType.asString() }`,
                                node.baseExpression);
                            break;
                        }
                    }
                }

                if (!type) {
                    // TODO - need to implement
                    type = UnknownType.create();
                    // diagSink.addErrorWithTextRange(
                    //     `'Unsupported type expression: indexed ${ baseType.asString() }`,
                    //     node.baseExpression);
                }
            } else if (baseType instanceof FunctionType) {
                // TODO - need to implement generic function support
                type = this.getCallableType(undefined, currentScope, diagSink);
            } else {
                diagSink.addErrorWithTextRange(
                    `'Unsupported type expression: indexed other (${ baseType.asString() })`,
                    node.baseExpression);
            }
        } else if (node instanceof TupleExpressionNode) {
            let tupleType = new TupleType(this.getBuiltInType(currentScope, 'tuple') as ClassType);
            node.expressions.forEach(expr => {
                tupleType.addEntryType(TypeAnnotation.getType(expr,
                    currentScope, diagSink, classNamesImplyObjects));
            });
            type = tupleType;
        } else if (node instanceof StringNode) {
            if (node.tokens[0].quoteTypeFlags & QuoteTypeFlags.Byte) {
                type = this.getBuiltInType(currentScope, 'byte');
            } else {
                type = this.getBuiltInType(currentScope, 'str');
            }
        } else if (node instanceof NumberNode) {
            if (node.token.isInteger) {
                type = this.getBuiltInType(currentScope, 'int');
            } else {
                type = this.getBuiltInType(currentScope, 'float');
            }
        } else if (node instanceof CallExpressionNode) {
            let baseType = TypeAnnotation.getType(node.leftExpression, currentScope, diagSink, false);
            if (baseType instanceof ClassType && baseType.isBuiltIn()) {
                const className = baseType.getClassName();

                if (className === 'TypeVar') {
                    type = this.getTypeVarType(node, currentScope, diagSink);
                } else if (className === 'NamedTuple') {
                    type = this.getNamedTupleType(node, true, currentScope, diagSink);
                    classNamesImplyObjects = false;
                } else {
                    type = UnknownType.create();
                    diagSink.addErrorWithTextRange(`'${ className }' is not callable`, node);
                }
            } else if (baseType instanceof FunctionType) {
                // The stdlib collections.pyi stub file defines namedtuple as a function
                // rather than a class, so we need to check for it here.
                if (node.leftExpression instanceof NameNode && node.leftExpression.nameToken.value === 'namedtuple') {
                    type = this.getNamedTupleType(node, false, currentScope, diagSink);
                    classNamesImplyObjects = false;
                } else {
                    type = baseType.getEffectiveReturnType();
                }
            } else if (baseType.isAny()) {
                type = UnknownType.create();
            }

            if (type === undefined) {
                type = baseType;
                diagSink.addErrorWithTextRange(
                    `'Unsupported type expression: call`, node);
            }
        } else if (node instanceof ListNode) {
            // TODO - need to implement
            type = UnknownType.create();
            // diagSink.addErrorWithTextRange(
            //     `'Unsupported type expression: list`, node);
        } else if (node instanceof DictionaryNode) {
            // TODO - need to implement
            type = UnknownType.create();
            diagSink.addErrorWithTextRange(
                `'Unsupported type expression: dictionary`, node);
        } else if (node instanceof SetNode) {
            // TODO - need to implement
            type = UnknownType.create();
            diagSink.addErrorWithTextRange(
                `'Unsupported type expression: set`, node);
        }

        if (type) {
            if (type instanceof ClassType && classNamesImplyObjects) {
                type = new ObjectType(type);
            }
            return type;
        }

        diagSink.addErrorWithTextRange(
            `Unknown type '${ ParseTreeUtils.printExpression(node) }'`, node);
        return UnknownType.create();
    }

    // Unpacks the index expression for an Optional type annotation.
    static getOptionalType(indexExpression: ExpressionNode, currentScope: Scope,
            diagSink: TextRangeDiagnosticSink): Type {

        let type = this.getType(indexExpression, currentScope, diagSink);
        return TypeUtils.combineTypes(type, NoneType.create());
    }

    // Unpacks the index expression for a Type type annotation.
    static getTypeType(indexExpression: ExpressionNode, currentScope: Scope,
            diagSink: TextRangeDiagnosticSink): Type {

        let type = this.getType(indexExpression, currentScope, diagSink);
        if (type instanceof ObjectType) {
            return type.getClassType();
        } else if (type instanceof TypeVarType) {
            // TODO - remove once we support type var processing
        } else if (!type.isAny()) {
            diagSink.addErrorWithTextRange('Expected type parameter after Type',
                indexExpression);
        }

        return UnknownType.create();
    }

    // Unpacks the index expression for a Union type annotation.
    static getUnionType(indexExpression: ExpressionNode, currentScope: Scope,
            diagSink: TextRangeDiagnosticSink): UnionType {
        let unionType = new UnionType();

        if (indexExpression instanceof TupleExpressionNode) {
            indexExpression.expressions.forEach(expr => {
                let type = this.getType(expr, currentScope, diagSink);
                if (type instanceof UnionType) {
                    type.getTypes().forEach(t => {
                        unionType.addType(t);
                    });
                } else {
                    unionType.addType(type);
                }
            });
        } else {
            unionType.addType(this.getType(indexExpression, currentScope, diagSink));
        }

        return unionType;
    }

    // Unpacks the index expression for a Callable type annotation. It should
    // have zero to two parameters. The first parameter, if present, should be
    // either an ellipsis or a list of parameter types. The second parameter, if
    // present, should specify the return type.
    static getCallableType(node: ExpressionNode | undefined,
            currentScope: Scope, diagSink: TextRangeDiagnosticSink): FunctionType {
        let functionType = new FunctionType(FunctionTypeFlags.None);
        functionType.setDeclaredReturnType(AnyType.create());
        let paramList: Type[] | undefined;

        if (node) {
            if (node instanceof TupleExpressionNode) {
                if (node.expressions.length === 0) {
                    diagSink.addErrorWithTextRange(
                        `Expected parameter type list or '...'`, node);
                }

                paramList = this._getCallableParameterTypeList(
                    node.expressions[0], currentScope, diagSink);

                if (node.expressions.length > 1) {
                    functionType.setDeclaredReturnType(this.getType(
                        node.expressions[1], currentScope, diagSink));
                }

                if (node.expressions.length > 2) {
                    diagSink.addErrorWithTextRange(
                        `Expected at most two parameters`, node.expressions[2]);
                }
            } else {
                paramList = this._getCallableParameterTypeList(
                    node, currentScope, diagSink);
            }
        }

        if (paramList !== undefined) {
            paramList.forEach((paramType, index) => {
                functionType.addParameter({
                    category: ParameterCategory.Simple,
                    name: `p${ index.toString() }`,
                    type: paramType
                });
            });
        } else {
            TypeUtils.addDefaultFunctionParameters(functionType);
        }

        return functionType;
    }

    private static _getCallableParameterTypeList(node: ExpressionNode, currentScope: Scope,
            diagSink: TextRangeDiagnosticSink): Type[] | undefined {
        let typeList: Type[] = [];

        if (node instanceof EllipsisNode) {
            return undefined;
        } else if (node instanceof ListNode) {
            node.entries.forEach(entry => {
                typeList.push(this.getType(entry, currentScope, diagSink));
            });
        } else {
            diagSink.addErrorWithTextRange(
                `Expected parameter type list or '...'`, node);
        }

        return typeList;
    }

    static getOneParameterType(className: string, indexExpression: ExpressionNode,
            currentScope: Scope, diagSink: TextRangeDiagnosticSink): Type {
        // let typeParam = this.getType(indexExpression, currentScope, diagSink, false);

        return this.getBuiltInType(currentScope, className.toLowerCase());
    }

    static getTwoParameterType(className: string, indexExpression: ExpressionNode,
            currentScope: Scope, diagSink: TextRangeDiagnosticSink): Type {

        if (indexExpression instanceof TupleExpressionNode && indexExpression.expressions.length === 2) {
            // let keyType = this.getType(indexExpression.expressions[0], currentScope, diagSink, false);
            // let valueType = this.getType(indexExpression.expressions[1], currentScope, diagSink, false);
        } else {
            diagSink.addErrorWithTextRange(`Expected two type parameters after ${ className }`,
                indexExpression);
        }

        return this.getBuiltInType(currentScope, className.toLowerCase());
    }

    static getArbitraryParameterType(className: string, indexExpression: ExpressionNode,
            currentScope: Scope, diagSink: TextRangeDiagnosticSink): Type {

        if (indexExpression instanceof TupleExpressionNode) {
            indexExpression.expressions.forEach(expr => {
                // let typeParamType = this.getType(expr, currentScope, diagSink, false);
            });
        } else {
            // let typeParamType = this.getType(indexExpression, currentScope, diagSink, false);
        }

        return this.getBuiltInType(currentScope, className.toLowerCase());
    }

    static getTypeVarType(node: CallExpressionNode, currentScope: Scope,
            diagSink: TextRangeDiagnosticSink): TypeVarType | undefined {
        let typeVarName = '';
        if (node.arguments.length === 0) {
            diagSink.addErrorWithTextRange('Expected name of type var', node);
            return undefined;
        }

        let firstArg = node.arguments[0];
        if (firstArg.valueExpression instanceof StringNode) {
            typeVarName = firstArg.valueExpression.getValue();
        } else {
            diagSink.addErrorWithTextRange('Expected name of type var as first parameter',
                firstArg.valueExpression);
        }

        let typeVar = new TypeVarType(typeVarName);

        // Parse the remaining parameters.
        for (let i = 1; i < node.arguments.length; i++) {
            const paramNameNode = node.arguments[i].name;
            const paramName = paramNameNode ? paramNameNode.nameToken.value : undefined;
            let paramNameMap = new StringMap<string>();

            if (paramName) {
                if (paramNameMap.get(paramName)) {
                    diagSink.addErrorWithTextRange(
                        `Duplicate parameter name '${ paramName }' not allowed`,
                        node.arguments[i]);
                }

                if (paramName === 'bound') {
                    typeVar.setBoundType(this.getType(
                        node.arguments[i].valueExpression,
                        currentScope, diagSink));
                } else if (paramName === 'covariant') {
                    if (this.getBooleanValue(node.arguments[i].valueExpression, diagSink)) {
                        if (typeVar.isContravariant()) {
                            diagSink.addErrorWithTextRange(
                                `A TypeVar cannot be both covariant and contravariant`,
                                node.arguments[i]);
                        } else {
                            typeVar.setIsCovariant();
                        }
                    }
                } else if (paramName === 'contravariant') {
                    if (this.getBooleanValue(node.arguments[i].valueExpression, diagSink)) {
                        if (typeVar.isContravariant()) {
                            diagSink.addErrorWithTextRange(
                                `A TypeVar cannot be both covariant and contravariant`,
                                node.arguments[i]);
                        } else {
                            typeVar.setIsContravariant();
                        }
                    }
                } else {
                    diagSink.addErrorWithTextRange(
                        `'${ paramName }' is unknown parameter to TypeVar`,
                        node.arguments[i]);
                }

                paramNameMap.set(paramName, paramName);
            } else {
                typeVar.addConstraint(this.getType(
                    node.arguments[i].valueExpression,
                    currentScope, diagSink));
            }
        }

        return typeVar;
    }

    // Creates a new custom tuple factory class with named values.
    // Supports both typed and untyped variants.
    static getNamedTupleType(node: CallExpressionNode, includesTypes: boolean,
            currentScope: Scope, diagSink: TextRangeDiagnosticSink): ClassType {
        let className = 'namedtuple';
        if (node.arguments.length === 0) {
            diagSink.addErrorWithTextRange('Expected named tuple class name as firat parameter',
                node.leftExpression);
        } else {
            const nameArg = node.arguments[0];
            if (nameArg.argumentCategory !== ArgumentCategory.Simple) {
                diagSink.addErrorWithTextRange('Expected named tuple class name as firat parameter',
                    node.arguments[0].valueExpression);
            } else if (nameArg.valueExpression instanceof StringNode) {
                className = nameArg.valueExpression.getValue();
            }
        }

        let classType = new ClassType(className, ClassTypeFlags.None);
        const classFields = classType.getClassFields();
        classFields.set('__class__', new Symbol(classType, DefaultTypeSourceId));
        const instanceFields = classType.getInstanceFields();

        let tupleType = new TupleType(this.getBuiltInType(currentScope, 'tuple') as ClassType);
        let constructorType = new FunctionType(FunctionTypeFlags.ClassMethod);
        constructorType.setDeclaredReturnType(tupleType);
        constructorType.addParameter({
            category: ParameterCategory.Simple,
            name: 'cls',
            type: classType
        });

        let initType = new FunctionType(FunctionTypeFlags.InstanceMethod);
        const selfParameter: FunctionParameter = {
            category: ParameterCategory.Simple,
            name: 'self',
            type: new ObjectType(classType)
        };
        initType.setDeclaredReturnType(NoneType.create());
        initType.addParameter(selfParameter);

        if (node.arguments.length < 2) {
            diagSink.addErrorWithTextRange('Expected named tuple entry list as second parameter',
                node.leftExpression);
        } else {
            const entriesArg = node.arguments[1];
            if (entriesArg.argumentCategory !== ArgumentCategory.Simple ||
                    !(entriesArg.valueExpression instanceof ListNode)) {
                diagSink.addErrorWithTextRange('Expected named tuple entry list as second parameter',
                    entriesArg.valueExpression);
            } else {
                const entryList = entriesArg.valueExpression;
                let entryMap: { [name: string]: string } = {};

                entryList.entries.forEach((entry, index) => {
                    let entryType: Type | undefined;
                    let entryNameNode: ExpressionNode | undefined;
                    let entryName = '';

                    if (includesTypes) {
                        // Handle the variant that includes name/type tuples.
                        if (entry instanceof TupleExpressionNode && entry.expressions.length === 2) {
                            entryNameNode = entry.expressions[0];
                            entryType = this.getType(entry.expressions[1], currentScope,
                                diagSink);
                        } else {
                            diagSink.addErrorWithTextRange(
                                'Expected two-entry tuple specifying entry name and type', entry);
                        }
                    } else {
                        entryNameNode = entry;
                        entryType = UnknownType.create();
                    }

                    if (entryNameNode instanceof StringNode) {
                        entryName = entryNameNode.getValue();
                        if (!entryName) {
                            diagSink.addErrorWithTextRange(
                                'Names within a named tuple cannot be empty', entryNameNode);
                        }
                    } else {
                        diagSink.addErrorWithTextRange(
                            'Expected string literal for entry name', entryNameNode || entry);
                    }

                    if (!entryName) {
                        entryName = `_${ index.toString() }`;
                    }

                    if (entryMap[entryName]) {
                        diagSink.addErrorWithTextRange(
                            'Names within a named tuple must be unique', entryNameNode || entry);
                    }

                    // Record names in a map to detect duplicates.
                    entryMap[entryName] = entryName;

                    if (!entryType) {
                        entryType = UnknownType.create();
                    }

                    tupleType.addEntryType(entryType);
                    const paramInfo: FunctionParameter = {
                        category: ParameterCategory.Simple,
                        name: entryName,
                        type: entryType
                    };

                    constructorType.addParameter(paramInfo);
                    initType.addParameter(paramInfo);

                    instanceFields.set(entryName, new Symbol(entryType, DefaultTypeSourceId));
                });
            }
        }

        classFields.set('__new__', new Symbol(constructorType, DefaultTypeSourceId));
        classFields.set('__init__', new Symbol(initType, DefaultTypeSourceId));

        let keysItemType = new FunctionType(FunctionTypeFlags.None);
        keysItemType.setDeclaredReturnType(this.getBuiltInObject(currentScope, 'list'));
        classFields.set('keys', new Symbol(keysItemType, DefaultTypeSourceId));
        classFields.set('items', new Symbol(keysItemType, DefaultTypeSourceId));

        let lenType = new FunctionType(FunctionTypeFlags.InstanceMethod);
        lenType.setDeclaredReturnType(this.getBuiltInObject(currentScope, 'int'));
        lenType.addParameter(selfParameter);
        classFields.set('__len__', new Symbol(lenType, DefaultTypeSourceId));

        return classType;
    }

    static getBooleanValue(node: ExpressionNode, diagSink: TextRangeDiagnosticSink): boolean {
        if (node instanceof ConstantNode) {
            if (node.token instanceof KeywordToken) {
                if (node.token.keywordType === KeywordType.False) {
                    return false;
                } else if (node.token.keywordType === KeywordType.True) {
                    return true;
                }
            }
        }

        diagSink.addErrorWithTextRange('Expected True or False', node);
        return false;
    }

    static getBuiltInType(currentScope: Scope, name: string): Type {
        // Starting at the current scope, find the built-in scope, which should
        // be the top-most parent.
        let builtInScope = currentScope;
        while (builtInScope.getType() !== ScopeType.BuiltIn) {
            builtInScope = builtInScope.getParent()!;
        }

        let nameType = builtInScope.lookUpSymbol(name);
        if (nameType) {
            return nameType.currentType;
        }

        return UnknownType.create();
    }

    static getBuiltInObject(currentScope: Scope, className: string): Type {
        let nameType = this.getBuiltInType(currentScope, className);
        if (nameType instanceof ClassType) {
            return new ObjectType(nameType);
        }

        return nameType;
    }

    // Determines if the function node is a property accessor (getter, setter, deleter).
    static getPropertyType(node: FunctionNode, type: FunctionType, currentScope: Scope): PropertyType | undefined {
        if (ParseTreeUtils.functionHasDecorator(node, 'property')) {
            return new PropertyType(type);
        }

        const setterOrDeleterDecorator = node.decorators.find(decorator => {
            return decorator.callName instanceof MemberAccessExpressionNode &&
                decorator.callName.leftExpression instanceof NameNode &&
                (decorator.callName.memberName.nameToken.value === 'setter' ||
                    decorator.callName.memberName.nameToken.value === 'deleter') &&
                decorator.arguments.length === 0;
        });

        if (setterOrDeleterDecorator) {
            let memberAccessNode = setterOrDeleterDecorator.callName as MemberAccessExpressionNode;
            const propertyName = (memberAccessNode.leftExpression as NameNode).nameToken.value;
            const isSetter = memberAccessNode.memberName.nameToken.value === 'setter';

            let curValue = currentScope.lookUpSymbol(propertyName);

            if (curValue && curValue.currentType instanceof PropertyType) {
                // TODO - check for duplicates.
                // TODO - check for type consistency.
                if (isSetter) {
                    curValue.currentType.setSetter(type);
                } else {
                    curValue.currentType.setDeleter(type);
                }
                return curValue.currentType;
            }
        }

        return undefined;
    }

    static getOverloadedFunctionType(node: FunctionNode, type: FunctionType,
            currentScope: Scope): [OverloadedFunctionType | undefined, boolean] {

        let warnIfDuplicate = true;
        let decoratedType: OverloadedFunctionType | undefined;
        let typeSourceId = AnalyzerNodeInfo.getTypeSourceId(node);

        // TODO - make sure this overload decorator is the built-in one.
        if (ParseTreeUtils.functionHasDecorator(node, 'overload')) {
            let existingSymbol = currentScope.lookUpSymbol(node.name.nameToken.value);
            if (existingSymbol && existingSymbol.currentType instanceof OverloadedFunctionType) {
                existingSymbol.currentType.addOverload(typeSourceId, type);
                decoratedType = existingSymbol.currentType;
                warnIfDuplicate = false;
            } else {
                let newOverloadType = new OverloadedFunctionType();
                newOverloadType.addOverload(typeSourceId, type);
                decoratedType = newOverloadType;
            }
        }

        return [decoratedType, warnIfDuplicate];
    }
}
