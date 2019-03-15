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
import { ArgumentCategory, CallExpressionNode, ConstantNode,
    EllipsisNode, ExpressionNode, FunctionNode, IndexExpressionNode, ListNode,
    MemberAccessExpressionNode, NameNode, NumberNode, ParameterCategory,
    StringNode, TupleExpressionNode } from '../parser/parseNodes';
import { KeywordToken, KeywordType, QuoteTypeFlags, TokenType } from '../parser/tokenizerTypes';
import { AnalyzerNodeInfo } from './analyzerNodeInfo';
import { DefaultTypeSourceId } from './inferredType';
import { ParseTreeUtils } from './parseTreeUtils';
import { Scope, ScopeType } from './scope';
import { Symbol } from './symbol';
import { AnyType, ClassType, ClassTypeFlags, FunctionParameter, FunctionType,
    FunctionTypeFlags, ModuleType, NoneType, ObjectType, OverloadedFunctionType,
    PropertyType, TupleType, Type, TypeVarType, UnionType, UnknownType } from './types';
import { TypeUtils } from './typeUtils';

interface TypeResult {
    type: Type;
    typeList?: TypeResult[];
    isClassType?: boolean;
    node: ExpressionNode;
}

export class TypeAnnotation {
    static getType(node: ExpressionNode, currentScope: Scope, diagSink: TextRangeDiagnosticSink,
            classNamesImplyObjects = true, transformBuiltInTypes = true): Type {

        let typeResult = this._getType(node, currentScope, diagSink,
            classNamesImplyObjects, transformBuiltInTypes);

        return typeResult.type;
    }

    static getTypeVarType(node: CallExpressionNode, currentScope: Scope,
            diagSink: TextRangeDiagnosticSink): Type | undefined {

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
                    if (this._getBooleanValue(node.arguments[i].valueExpression, diagSink)) {
                        if (typeVar.isContravariant()) {
                            diagSink.addErrorWithTextRange(
                                `A TypeVar cannot be both covariant and contravariant`,
                                node.arguments[i]);
                        } else {
                            typeVar.setIsCovariant();
                        }
                    }
                } else if (paramName === 'contravariant') {
                    if (this._getBooleanValue(node.arguments[i].valueExpression, diagSink)) {
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

        let classType = new ClassType(className, ClassTypeFlags.None,
            AnalyzerNodeInfo.getTypeSourceId(node));
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

        let addGenericGetAttribute = false;

        if (node.arguments.length < 2) {
            diagSink.addErrorWithTextRange('Expected named tuple entry list as second parameter',
                node.leftExpression);
            addGenericGetAttribute = true;
        } else {
            const entriesArg = node.arguments[1];
            if (entriesArg.argumentCategory !== ArgumentCategory.Simple ||
                    !(entriesArg.valueExpression instanceof ListNode)) {
                // A dynamic expression was used, so we can't evaluate
                // the named tuple statically.
                addGenericGetAttribute = true;
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
        keysItemType.setDeclaredReturnType(this.getBuiltInObject(currentScope, 'list',
            [this.getBuiltInObject(currentScope, 'str')]));
        classFields.set('keys', new Symbol(keysItemType, DefaultTypeSourceId));
        classFields.set('items', new Symbol(keysItemType, DefaultTypeSourceId));

        let lenType = new FunctionType(FunctionTypeFlags.InstanceMethod);
        lenType.setDeclaredReturnType(this.getBuiltInObject(currentScope, 'int'));
        lenType.addParameter(selfParameter);
        classFields.set('__len__', new Symbol(lenType, DefaultTypeSourceId));

        if (addGenericGetAttribute) {
            let getAttribType = new FunctionType(FunctionTypeFlags.InstanceMethod);
            getAttribType.setDeclaredReturnType(AnyType.create());
            getAttribType.addParameter(selfParameter);
            getAttribType.addParameter({
                category: ParameterCategory.Simple,
                name: 'name',
                type: this.getBuiltInObject(currentScope, 'str')
            });
            classFields.set('__getattribute__', new Symbol(getAttribType, DefaultTypeSourceId));
        }

        return classType;
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

    static getBuiltInObject(currentScope: Scope, className: string,
            typeArguments?: Type[]): Type {

        let nameType = this.getBuiltInType(currentScope, className);
        if (nameType instanceof ClassType) {
            let classType = nameType;
            if (typeArguments) {
                classType = classType.cloneForSpecialization();
                classType.setTypeArguments(typeArguments);
            }
            return new ObjectType(classType);
        }

        return nameType;
    }

    // Determines if the function node is a property accessor (getter, setter, deleter).
    static getPropertyType(node: FunctionNode, type: FunctionType,
            currentScope: Scope): PropertyType | undefined {
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

    // Similar to the public getType method except that it returns a full
    // TypeResult object with additional information.
    private static _getType(node: ExpressionNode, currentScope: Scope, diagSink: TextRangeDiagnosticSink,
            classNamesImplyObjects = true, transformBuiltInTypes = true): TypeResult {
        let typeResult: TypeResult | undefined;

        if (node instanceof NameNode) {
            typeResult = this._getTypeFromName(node, currentScope, diagSink,
                transformBuiltInTypes);
        } else if (node instanceof EllipsisNode) {
            typeResult = {
                type: AnyType.create(),
                node
            };
        } else if (node instanceof MemberAccessExpressionNode) {
            typeResult = this._getTypeFromMemberAccessExpression(node, currentScope, diagSink);
        } else if (node instanceof IndexExpressionNode) {
            typeResult = this._getTypeFromIndexExpression(node, currentScope, diagSink);
            if (typeResult.isClassType) {
                classNamesImplyObjects = false;
            }
        } else if (node instanceof TupleExpressionNode) {
            let tupleType = new TupleType(this.getBuiltInType(currentScope, 'tuple') as ClassType);
            node.expressions.forEach(expr => {
                let entryTypeResult = this._getType(expr,
                    currentScope, diagSink, classNamesImplyObjects);
                tupleType.addEntryType(entryTypeResult.type || UnknownType.create());
            });
            typeResult = {
                type: tupleType,
                node
            };
        } else if (node instanceof ConstantNode) {
            if (node.token.type === TokenType.Keyword) {
                if (node.token.keywordType === KeywordType.None) {
                    typeResult = { type: NoneType.create(), node };
                } else if (node.token.keywordType === KeywordType.True ||
                        node.token.keywordType === KeywordType.False ||
                        node.token.keywordType === KeywordType.Debug) {
                    typeResult = { type: this.getBuiltInType(currentScope, 'bool'), node };
                }
            }
        } else if (node instanceof StringNode) {
            if (node.tokens[0].quoteTypeFlags & QuoteTypeFlags.Byte) {
                typeResult = { type: this.getBuiltInType(currentScope, 'byte'), node };
            } else {
                typeResult = { type: this.getBuiltInType(currentScope, 'str'), node };
            }
        } else if (node instanceof NumberNode) {
            if (node.token.isInteger) {
                typeResult = { type: this.getBuiltInType(currentScope, 'int'), node };
            } else {
                typeResult = { type: this.getBuiltInType(currentScope, 'float'), node };
            }
        } else if (node instanceof CallExpressionNode) {
            typeResult = this._getCallExpression(node, currentScope, diagSink);
            if (typeResult.isClassType) {
                classNamesImplyObjects = false;
            }
        }

        if (typeResult && classNamesImplyObjects) {
            typeResult.type = this._convertClassToObject(typeResult.type);
        }

        if (typeResult) {
            return typeResult;
        }

        diagSink.addErrorWithTextRange(
            `Unknown type expression '${ ParseTreeUtils.printExpression(node) }'`, node);
        return { type: UnknownType.create(), node };
    }

    private static _getTypeFromName(node: NameNode, currentScope: Scope,
            diagSink: TextRangeDiagnosticSink, transformBuiltInTypes = true):
            TypeResult | undefined {

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
                    type = this._createCallableType(type, [], diagSink);
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
                    type = this._createSpecialType(type, [], diagSink);
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

        if (type) {
            return { type, node };
        }

        return undefined;
    }

    private static _getTypeFromMemberAccessExpression(node: MemberAccessExpressionNode,
            currentScope: Scope, diagSink: TextRangeDiagnosticSink): TypeResult | undefined {

        let baseTypeResult = this._getType(node.leftExpression, currentScope,
            diagSink, true, false);
        let memberName = node.memberName.nameToken.value;
        let type: Type | undefined;

        if (baseTypeResult.type.isAny()) {
            type = baseTypeResult.type;
        } else if (baseTypeResult.type instanceof ModuleType) {
            let fieldInfo = baseTypeResult.type.getFields().get(memberName);
            if (fieldInfo) {
                type = fieldInfo.currentType;
            } else {
                diagSink.addErrorWithTextRange(
                    `'${ memberName }' is not a known member of module`, node.memberName);
                type = UnknownType.create();
            }
        } else if (baseTypeResult.type instanceof ClassType) {
            let fieldInfo = TypeUtils.lookUpClassMember(baseTypeResult.type, memberName);
            if (fieldInfo) {
                type = TypeUtils.getEffectiveTypeOfMember(fieldInfo);
            } else {
                diagSink.addErrorWithTextRange(
                    `'${ memberName }' is not a known member of '${ baseTypeResult.type.asString() }'`,
                    node.memberName);
                type = UnknownType.create();
            }
        } else if (baseTypeResult.type instanceof ObjectType) {
            let fieldInfo = TypeUtils.lookUpClassMember(baseTypeResult.type.getClassType(), memberName);
            if (fieldInfo) {
                type = TypeUtils.getEffectiveTypeOfMember(fieldInfo);
            } else {
                diagSink.addErrorWithTextRange(
                    `'${ memberName }' is not a known member of '${ baseTypeResult.type.asString() }'`,
                    node.memberName);
                type = UnknownType.create();
            }
        }

        if (type) {
            return { type, node };
        }

        return undefined;
    }

    private static _getTypeFromIndexExpression(node: IndexExpressionNode,
            currentScope: Scope, diagSink: TextRangeDiagnosticSink): TypeResult {

        let isClassType = false;
        let type: Type | undefined;
        let baseTypeResult = this._getType(node.baseExpression, currentScope,
            diagSink, false, false);

        let typeArgs = this._getTypeArgs(node.indexExpression, currentScope, diagSink);

        this._validateTypeArgs(typeArgs, diagSink);

        if (baseTypeResult.type instanceof ClassType) {
            // Handle the special-case classes that are not defined
            // in the type stubs.
            if (baseTypeResult.type.isSpecialBuiltIn()) {
                const className = baseTypeResult.type.getClassName();

                switch (className) {
                    case 'Callable': {
                        type = this._createCallableType(baseTypeResult.type,
                            typeArgs, diagSink);
                        break;
                    }

                    case 'Optional': {
                        type = this._createOptional(node.baseExpression,
                            typeArgs, diagSink);
                        break;
                    }

                    case 'Type': {
                        type = this._createTypeType(node, typeArgs, diagSink);
                        isClassType = true;
                        break;
                    }

                    case 'ClassVar':
                    case 'Deque':
                    case 'List':
                    case 'FrozenSet':
                    case 'Set': {
                        type = this._createSpecialType(baseTypeResult.type, typeArgs,
                            diagSink, 1);
                        break;
                    }

                    case 'ChainMap':
                    case 'Dict':
                    case 'DefaultDict': {
                        type = this._createSpecialType(baseTypeResult.type, typeArgs,
                            diagSink, 2);
                        break;
                    }

                    case 'Protocol':
                    case 'Tuple': {
                        type = this._createSpecialType(baseTypeResult.type, typeArgs,
                            diagSink);
                        break;
                    }

                    case 'Union': {
                        type = this._createUnionType(typeArgs);
                        break;
                    }

                    case 'Generic':
                        type = this._createGenericType(node.baseExpression,
                            baseTypeResult.type, typeArgs, diagSink);
                        break;
                }
            }

            if (!type) {
                if (baseTypeResult.type === this.getBuiltInType(currentScope, 'type')) {
                    // The built-in 'type' class isn't defined as a generic class. It needs
                    // to be special-cased here.
                    type = this._createTypeType(node, typeArgs, diagSink);
                    isClassType = true;
                } else {
                    type = this._createSpecializedClassType(baseTypeResult.type,
                        typeArgs, diagSink);
                }
            }
        } else if (!baseTypeResult.type.isAny()) {
            diagSink.addErrorWithTextRange(
                `'Unsupported type expression: indexed other (${ baseTypeResult.type.asString() })`,
                node.baseExpression);
        }

        if (!type) {
            type = UnknownType.create();
        }

        return { type, isClassType, node };
    }

    private static _validateTypeArgs(typeArgs: TypeResult[], diagSink: TextRangeDiagnosticSink) {
        // Make sure type args are reachable according to scoping rules.
        // TODO - need to implement
    }

    private static _getTypeArgs(node: ExpressionNode, currentScope: Scope,
            diagSink: TextRangeDiagnosticSink): TypeResult[] {

        let typeArgs: TypeResult[] = [];

        if (node instanceof TupleExpressionNode) {
            node.expressions.forEach(expr => {
                typeArgs.push(this._getTypeArg(expr, currentScope, diagSink));
            });
        } else {
            typeArgs.push(this._getTypeArg(node, currentScope, diagSink));
        }

        return typeArgs;
    }

    private static _getTypeArg(node: ExpressionNode, currentScope: Scope,
            diagSink: TextRangeDiagnosticSink): TypeResult {

        let typeResult: TypeResult;

        if (node instanceof ListNode) {
            typeResult = {
                type: UnknownType.create(),
                typeList: node.entries.map(entry => {
                    return this._getType(entry, currentScope, diagSink);
                }),
                node
            };
        } else {
            typeResult = this._getType(node, currentScope, diagSink);
        }

        return typeResult;
    }

    private static _getCallExpression(node: CallExpressionNode,
            currentScope: Scope, diagSink: TextRangeDiagnosticSink): TypeResult {

        let isClassType = false;
        let type: Type | undefined;
        let baseTypeResult = this._getType(node.leftExpression, currentScope, diagSink, false);
        if (baseTypeResult.type instanceof ClassType && baseTypeResult.type.isBuiltIn()) {
            const className = baseTypeResult.type.getClassName();

            if (className === 'TypeVar') {
                type = this.getTypeVarType(node, currentScope, diagSink);
            } else if (className === 'NamedTuple') {
                type = this.getNamedTupleType(node, true, currentScope, diagSink);
                isClassType = true;
            } else {
                type = UnknownType.create();
                diagSink.addErrorWithTextRange(`'${ className }' is not callable`, node);
            }
        } else if (baseTypeResult.type instanceof FunctionType) {
            // The stdlib collections.pyi stub file defines namedtuple as a function
            // rather than a class, so we need to check for it here.
            if (node.leftExpression instanceof NameNode &&
                    node.leftExpression.nameToken.value === 'namedtuple') {
                type = this.getNamedTupleType(node, false, currentScope, diagSink);
                isClassType = true;
            } else {
                type = baseTypeResult.type.getEffectiveReturnType();
            }
        } else if (baseTypeResult.type.isAny()) {
            type = UnknownType.create();
        }

        if (type === undefined) {
            type = baseTypeResult.type;
            diagSink.addErrorWithTextRange(
                `'Unsupported type expression: call`, node);
        }

        return { type, isClassType, node };
    }

    // Creates an Optional type annotation.
    private static _createOptional(errorNode: ExpressionNode, typeArgs: TypeResult[],
            diagSink: TextRangeDiagnosticSink): Type {

        if (typeArgs.length !== 1) {
            diagSink.addErrorWithTextRange(`Expected one type parameter after Optional`, errorNode);
            return UnknownType.create();
        }

        return TypeUtils.combineTypes(typeArgs[0].type, NoneType.create());
    }

    // Creates a Type type annotation.
    private static _createTypeType(errorNode: ExpressionNode, typeArgs: TypeResult[],
            diagSink: TextRangeDiagnosticSink): Type {

        if (typeArgs.length !== 1) {
            diagSink.addErrorWithTextRange(
                `Expected one type parameter after Type`, errorNode);
            return UnknownType.create();
        }

        let type = typeArgs[0].type;
        if (type instanceof ObjectType) {
            return type.getClassType();
        } else if (type instanceof TypeVarType) {
            // TODO - need to find a way to encode "type of" typeVar
            return type;
        } else if (!type.isAny()) {
            diagSink.addErrorWithTextRange(
                'Expected type parameter after Type', errorNode);
        }

        return UnknownType.create();
    }

    // Unpacks the index expression for a Union type annotation.
    private static _createUnionType(typeArgs: TypeResult[]): Type {
        let types: Type[] = [];

        for (let typeArg of typeArgs) {
            if (typeArg.type) {
                types.push(typeArg.type);
            }
        }

        return TypeUtils.combineTypesArray(types);
    }

    private static _createGenericType(errorNode: ExpressionNode, classType: ClassType,
            typeArgs: TypeResult[], diagSink: TextRangeDiagnosticSink): Type {

        // Make sure there's at least one type arg.
        if (typeArgs.length === 0) {
            diagSink.addErrorWithTextRange(
                `'Generic' requires at least one type argument`, errorNode);
        }

        // Make sure that all of the type args are typeVars and are unique.
        let uniqueTypeVars: TypeVarType[] = [];
        typeArgs.forEach(typeArg => {
            if (!(typeArg.type instanceof TypeVarType)) {
                diagSink.addErrorWithTextRange(
                    `Type argument for 'Generic' must be a type variable`, typeArg.node);
            } else {
                for (let typeVar of uniqueTypeVars) {
                    if (typeVar === typeArg.type) {
                        diagSink.addErrorWithTextRange(
                            `Type argument for 'Generic' must be unique`, typeArg.node);
                        break;
                    }
                }

                uniqueTypeVars.push(typeArg.type);
            }
        });

        return this._createSpecialType(classType, typeArgs, diagSink);
    }

    // Converts the type parameters for a Callable type. It should
    // have zero to two parameters. The first parameter, if present, should be
    // either an ellipsis or a list of parameter types. The second parameter, if
    // present, should specify the return type.
    private static _createCallableType(classType: Type,
            typeArgs: TypeResult[], diagSink: TextRangeDiagnosticSink): FunctionType {

        let functionType = new FunctionType(FunctionTypeFlags.None);
        functionType.setDeclaredReturnType(AnyType.create());

        if (typeArgs.length > 0) {
            if (typeArgs[0].typeList) {
                typeArgs[0].typeList.forEach((entry, index) => {
                    functionType.addParameter({
                        category: ParameterCategory.Simple,
                        name: `p${ index.toString() }`,
                        type: entry.type
                    });
                });
            } else if (typeArgs[0].type instanceof AnyType) {
                TypeUtils.addDefaultFunctionParameters(functionType);
            } else {
                diagSink.addErrorWithTextRange(
                    `Expected parameter type list or '...'`, typeArgs[0].node);
            }
        }

        if (typeArgs.length > 1) {
            functionType.setDeclaredReturnType(typeArgs[1].type);
        }

        if (typeArgs.length > 2) {
            diagSink.addErrorWithTextRange(
                `Expected only two type arguments to 'Callable'`, typeArgs[2].node);
        }

        return functionType;
    }

    private static _createSpecializedClassType(classType: ClassType,
            typeArgs: TypeResult[], diagSink: TextRangeDiagnosticSink): Type {

        let typeArgCount = typeArgs.length;

        // Make sure the argument list count is correct.
        let typeParameters = classType.getTypeParameters();
        if (typeArgCount > typeParameters.length) {
            if (typeParameters.length === 0) {
                diagSink.addErrorWithTextRange(`Expected no type arguments`,
                    typeArgs[typeParameters.length].node);
            } else {
                diagSink.addErrorWithTextRange(
                    `Expected at most ${ typeParameters.length } type arguments`,
                    typeArgs[typeParameters.length].node);
            }
            typeArgCount = typeParameters.length;
        }

        let specializedClass = classType.cloneForSpecialization();

        // TODO - need to verify constraints of arguments
        specializedClass.setTypeArguments(typeArgs.map(t => t.type));

        return specializedClass;
    }

    private static _createSpecialType(classType: ClassType, typeArgs: TypeResult[],
            diagSink: TextRangeDiagnosticSink, paramLimit?: number): Type {

        let typeArgCount = typeArgs.length;

        // Make sure the argument list count is correct.
        if (paramLimit !== undefined && typeArgCount > paramLimit) {
            diagSink.addErrorWithTextRange(
                `Expected at most ${ paramLimit } type arguments`, typeArgs[paramLimit].node);
            typeArgCount = paramLimit;
        }

        let specializedType = classType.cloneForSpecialization();
        specializedType.setTypeArguments(typeArgs.map(t => t.type));

        return specializedType;
    }

    private static _getBooleanValue(node: ExpressionNode, diagSink: TextRangeDiagnosticSink): boolean {
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

    private static _convertClassToObject(type: Type): Type {
        if (type instanceof ClassType) {
            type = new ObjectType(type);
        }

        return type;
    }
}
