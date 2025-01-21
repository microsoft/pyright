/*
 * decorators.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Provides type evaluation logic that is specific to the application of
 * function or class decorators.
 */

import { appendArray } from '../common/collectionUtils';
import { ArgCategory, CallNode, DecoratorNode, FunctionNode, ParamCategory, ParseNodeType } from '../parser/parseNodes';
import { getDeclaration, getFileInfo } from './analyzerNodeInfo';
import {
    applyDataClassDecorator,
    getDataclassDecoratorBehaviors,
    validateDataClassTransformDecorator,
} from './dataClasses';
import { DeclarationType, FunctionDeclaration } from './declaration';
import { convertDocStringToPlainText } from './docStringConversion';
import {
    clonePropertyWithDeleter,
    clonePropertyWithSetter,
    createProperty,
    validatePropertyMethod,
} from './properties';
import { Arg, EvalFlags, TypeEvaluator } from './typeEvaluatorTypes';
import { isPartlyUnknown, isProperty } from './typeUtils';
import {
    ClassType,
    ClassTypeFlags,
    DataClassBehaviors,
    FunctionParam,
    FunctionType,
    FunctionTypeFlags,
    OverloadedType,
    Type,
    TypeBase,
    UnknownType,
    isClass,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    isOverloaded,
} from './types';

export interface FunctionDecoratorInfo {
    flags: FunctionTypeFlags;
    deprecationMessage: string | undefined;
}

// Scans through the decorators to find a few built-in decorators
// that affect the function flags.
export function getFunctionInfoFromDecorators(
    evaluator: TypeEvaluator,
    node: FunctionNode,
    isInClass: boolean
): FunctionDecoratorInfo {
    const fileInfo = getFileInfo(node);
    let flags = FunctionTypeFlags.None;
    let deprecationMessage: string | undefined;

    if (isInClass) {
        // The "__new__" magic method is not an instance method.
        // It acts as a static method instead.
        if (node.d.name.d.value === '__new__') {
            flags |= FunctionTypeFlags.ConstructorMethod;
        }

        // Several magic methods are treated as class methods implicitly
        // by the runtime. Check for these here.
        const implicitClassMethods = ['__init_subclass__', '__class_getitem__'];
        if (implicitClassMethods.some((name) => node.d.name.d.value === name)) {
            flags |= FunctionTypeFlags.ClassMethod;
        }
    }

    for (const decoratorNode of node.d.decorators) {
        // Some stub files (e.g. builtins.pyi) rely on forward declarations of decorators.
        let evaluatorFlags = fileInfo.isStubFile ? EvalFlags.ForwardRefs : EvalFlags.None;
        if (decoratorNode.d.expr.nodeType !== ParseNodeType.Call) {
            evaluatorFlags |= EvalFlags.CallBaseDefaults;
        }

        const decoratorTypeResult = evaluator.getTypeOfExpression(decoratorNode.d.expr, evaluatorFlags);
        const decoratorType = decoratorTypeResult.type;

        if (isFunction(decoratorType)) {
            if (FunctionType.isBuiltIn(decoratorType, 'abstractmethod')) {
                if (isInClass) {
                    flags |= FunctionTypeFlags.AbstractMethod;
                }
            } else if (FunctionType.isBuiltIn(decoratorType, 'final')) {
                flags |= FunctionTypeFlags.Final;
            } else if (FunctionType.isBuiltIn(decoratorType, 'override')) {
                flags |= FunctionTypeFlags.Overridden;
            } else if (FunctionType.isBuiltIn(decoratorType, 'type_check_only')) {
                flags |= FunctionTypeFlags.TypeCheckOnly;
            } else if (FunctionType.isBuiltIn(decoratorType, 'no_type_check')) {
                flags |= FunctionTypeFlags.NoTypeCheck;
            } else if (FunctionType.isBuiltIn(decoratorType, 'overload')) {
                flags |= FunctionTypeFlags.Overloaded;
            }
        } else if (isClass(decoratorType)) {
            if (TypeBase.isInstantiable(decoratorType)) {
                if (ClassType.isBuiltIn(decoratorType, 'staticmethod')) {
                    if (isInClass) {
                        flags |= FunctionTypeFlags.StaticMethod;
                    }
                } else if (ClassType.isBuiltIn(decoratorType, 'classmethod')) {
                    if (isInClass) {
                        flags |= FunctionTypeFlags.ClassMethod;
                    }
                }
            } else {
                if (ClassType.isBuiltIn(decoratorType, 'deprecated')) {
                    deprecationMessage = decoratorType.priv.deprecatedInstanceMessage;
                }
            }
        }
    }

    return { flags, deprecationMessage };
}

// Transforms the input function type into an output type based on the
// decorator function described by the decoratorNode.
export function applyFunctionDecorator(
    evaluator: TypeEvaluator,
    inputFunctionType: Type,
    undecoratedType: FunctionType,
    decoratorNode: DecoratorNode,
    functionNode: FunctionNode
): Type {
    const fileInfo = getFileInfo(decoratorNode);

    // Some stub files (e.g. builtins.pyi) rely on forward declarations of decorators.
    let evaluatorFlags = fileInfo.isStubFile ? EvalFlags.ForwardRefs : EvalFlags.None;
    if (decoratorNode.d.expr.nodeType !== ParseNodeType.Call) {
        evaluatorFlags |= EvalFlags.CallBaseDefaults;
    }

    const decoratorTypeResult = evaluator.getTypeOfExpression(decoratorNode.d.expr, evaluatorFlags);
    const decoratorType = decoratorTypeResult.type;

    // Special-case the "overload" because it has no definition. Older versions of typeshed
    // defined "overload" as an object, but newer versions define it as a function.
    if (
        (isInstantiableClass(decoratorType) && ClassType.isSpecialBuiltIn(decoratorType, 'overload')) ||
        (isFunction(decoratorType) && FunctionType.isBuiltIn(decoratorType, 'overload'))
    ) {
        if (isFunction(inputFunctionType)) {
            inputFunctionType.shared.flags |= FunctionTypeFlags.Overloaded;
            undecoratedType.shared.flags |= FunctionTypeFlags.Overloaded;
            return inputFunctionType;
        }
    }

    if (decoratorNode.d.expr.nodeType === ParseNodeType.Call) {
        const decoratorCallType = evaluator.getTypeOfExpression(
            decoratorNode.d.expr.d.leftExpr,
            evaluatorFlags | EvalFlags.CallBaseDefaults
        ).type;

        if (isFunction(decoratorCallType)) {
            if (
                decoratorCallType.shared.name === '__dataclass_transform__' ||
                FunctionType.isBuiltIn(decoratorCallType, 'dataclass_transform')
            ) {
                undecoratedType.shared.decoratorDataClassBehaviors = validateDataClassTransformDecorator(
                    evaluator,
                    decoratorNode.d.expr
                );
                return inputFunctionType;
            }
        }
    }

    // Clear the PartiallyEvaluated flag in the input if it's set so
    // it doesn't propagate to the decorated type.
    const decoratorArg =
        isFunction(inputFunctionType) && FunctionType.isPartiallyEvaluated(inputFunctionType)
            ? FunctionType.cloneWithNewFlags(
                  inputFunctionType,
                  inputFunctionType.shared.flags & ~FunctionTypeFlags.PartiallyEvaluated
              )
            : inputFunctionType;

    let returnType = getTypeOfDecorator(evaluator, decoratorNode, decoratorArg);

    // Check for some built-in decorator types with known semantics.
    if (isFunction(decoratorType)) {
        if (FunctionType.isBuiltIn(decoratorType, 'abstractmethod')) {
            return inputFunctionType;
        }

        if (FunctionType.isBuiltIn(decoratorType, 'type_check_only')) {
            undecoratedType.shared.flags |= FunctionTypeFlags.TypeCheckOnly;
            return inputFunctionType;
        }

        // Handle property setters and deleters.
        if (decoratorNode.d.expr.nodeType === ParseNodeType.MemberAccess) {
            const baseType = evaluator.getTypeOfExpression(
                decoratorNode.d.expr.d.leftExpr,
                evaluatorFlags | EvalFlags.MemberAccessBaseDefaults
            ).type;

            if (isProperty(baseType)) {
                const memberName = decoratorNode.d.expr.d.member.d.value;
                if (memberName === 'setter') {
                    if (isFunction(inputFunctionType)) {
                        validatePropertyMethod(evaluator, inputFunctionType, decoratorNode);
                        return clonePropertyWithSetter(evaluator, baseType, inputFunctionType, functionNode);
                    } else {
                        return inputFunctionType;
                    }
                } else if (memberName === 'deleter') {
                    if (isFunction(inputFunctionType)) {
                        validatePropertyMethod(evaluator, inputFunctionType, decoratorNode);
                        return clonePropertyWithDeleter(evaluator, baseType, inputFunctionType, functionNode);
                    } else {
                        return inputFunctionType;
                    }
                }
            }
        }
    } else if (isInstantiableClass(decoratorType)) {
        if (ClassType.isBuiltIn(decoratorType)) {
            switch (decoratorType.shared.name) {
                case 'classmethod':
                case 'staticmethod': {
                    const requiredFlag =
                        decoratorType.shared.name === 'classmethod'
                            ? FunctionTypeFlags.ClassMethod
                            : FunctionTypeFlags.StaticMethod;

                    // If the function isn't currently a class method or static method
                    // (which can happen if the function was wrapped in a decorator),
                    // add the appropriate flag.
                    if (isFunction(inputFunctionType) && (inputFunctionType.shared.flags & requiredFlag) === 0) {
                        const newFunction = FunctionType.clone(inputFunctionType);
                        newFunction.shared.flags &= ~(
                            FunctionTypeFlags.ConstructorMethod |
                            FunctionTypeFlags.StaticMethod |
                            FunctionTypeFlags.ClassMethod
                        );
                        newFunction.shared.flags |= requiredFlag;
                        return newFunction;
                    }

                    return inputFunctionType;
                }

                case 'decorator': {
                    return inputFunctionType;
                }
            }
        }

        // Handle properties and subclasses of properties specially.
        if (ClassType.isPropertyClass(decoratorType)) {
            if (isFunction(inputFunctionType)) {
                validatePropertyMethod(evaluator, inputFunctionType, decoratorNode);
                return createProperty(evaluator, decoratorNode, decoratorType, inputFunctionType);
            } else if (isClassInstance(inputFunctionType)) {
                const boundMethod = evaluator.getBoundMagicMethod(inputFunctionType, '__call__');

                if (boundMethod && isFunction(boundMethod)) {
                    return createProperty(evaluator, decoratorNode, decoratorType, boundMethod);
                }

                return UnknownType.create();
            }
        }
    }

    if (isFunction(inputFunctionType) && isFunction(returnType)) {
        returnType = FunctionType.clone(returnType);

        // Copy the overload flag from the input function type.
        if (FunctionType.isOverloaded(inputFunctionType)) {
            returnType.shared.flags |= FunctionTypeFlags.Overloaded;
        }

        // Copy the docstrings from the input function type if the
        // decorator didn't have its own docstring.
        if (!returnType.shared.docString) {
            returnType.shared.docString = inputFunctionType.shared.docString;
        }
    }

    return returnType;
}

export function applyClassDecorator(
    evaluator: TypeEvaluator,
    inputClassType: Type,
    originalClassType: ClassType,
    decoratorNode: DecoratorNode
): Type {
    const fileInfo = getFileInfo(decoratorNode);
    let flags = fileInfo.isStubFile ? EvalFlags.ForwardRefs : EvalFlags.None;
    if (decoratorNode.d.expr.nodeType !== ParseNodeType.Call) {
        flags |= EvalFlags.CallBaseDefaults;
    }
    const decoratorType = evaluator.getTypeOfExpression(decoratorNode.d.expr, flags).type;

    if (decoratorNode.d.expr.nodeType === ParseNodeType.Call) {
        const decoratorCallType = evaluator.getTypeOfExpression(
            decoratorNode.d.expr.d.leftExpr,
            flags | EvalFlags.CallBaseDefaults
        ).type;

        if (isFunction(decoratorCallType)) {
            if (
                decoratorCallType.shared.name === '__dataclass_transform__' ||
                FunctionType.isBuiltIn(decoratorCallType, 'dataclass_transform')
            ) {
                originalClassType.shared.classDataClassTransform = validateDataClassTransformDecorator(
                    evaluator,
                    decoratorNode.d.expr
                );
            }
        }
    }

    if (isOverloaded(decoratorType)) {
        const dataclassBehaviors = getDataclassDecoratorBehaviors(decoratorType);
        if (dataclassBehaviors) {
            applyDataClassDecorator(
                evaluator,
                decoratorNode,
                originalClassType,
                dataclassBehaviors,
                /* callNode */ undefined
            );
            return inputClassType;
        }
    } else if (isFunction(decoratorType)) {
        if (FunctionType.isBuiltIn(decoratorType, 'final')) {
            originalClassType.shared.flags |= ClassTypeFlags.Final;

            // Don't call getTypeOfDecorator for final. We'll hard-code its
            // behavior because its function definition results in a cyclical
            // dependency between builtins, typing and _typeshed stubs.
            return inputClassType;
        }

        if (FunctionType.isBuiltIn(decoratorType, 'type_check_only')) {
            originalClassType.shared.flags |= ClassTypeFlags.TypeCheckOnly;
            return inputClassType;
        }

        if (FunctionType.isBuiltIn(decoratorType, 'runtime_checkable')) {
            originalClassType.shared.flags |= ClassTypeFlags.RuntimeCheckable;

            // Don't call getTypeOfDecorator for runtime_checkable. It appears
            // frequently in stubs, and it's a waste of time to validate its
            // parameters.
            return inputClassType;
        }

        // Is this a dataclass decorator?
        let dataclassBehaviors: DataClassBehaviors | undefined;
        let callNode: CallNode | undefined;

        if (decoratorNode.d.expr.nodeType === ParseNodeType.Call) {
            callNode = decoratorNode.d.expr;
            const decoratorCallType = evaluator.getTypeOfExpression(
                callNode.d.leftExpr,
                flags | EvalFlags.CallBaseDefaults
            ).type;
            dataclassBehaviors = getDataclassDecoratorBehaviors(decoratorCallType);
        } else {
            const decoratorType = evaluator.getTypeOfExpression(decoratorNode.d.expr, flags).type;
            dataclassBehaviors = getDataclassDecoratorBehaviors(decoratorType);
        }

        if (dataclassBehaviors) {
            applyDataClassDecorator(evaluator, decoratorNode, originalClassType, dataclassBehaviors, callNode);
            return inputClassType;
        }
    } else if (isClassInstance(decoratorType)) {
        if (ClassType.isBuiltIn(decoratorType, 'deprecated')) {
            originalClassType.shared.deprecatedMessage = decoratorType.priv.deprecatedInstanceMessage;
            return inputClassType;
        }
    }

    return getTypeOfDecorator(evaluator, decoratorNode, inputClassType);
}

function getTypeOfDecorator(evaluator: TypeEvaluator, node: DecoratorNode, functionOrClassType: Type): Type {
    // Evaluate the type of the decorator expression.
    let flags = getFileInfo(node).isStubFile ? EvalFlags.ForwardRefs : EvalFlags.None;
    if (node.d.expr.nodeType !== ParseNodeType.Call) {
        flags |= EvalFlags.CallBaseDefaults;
    }

    const decoratorTypeResult = evaluator.getTypeOfExpression(node.d.expr, flags);

    // Special-case the combination of a classmethod decorator applied
    // to a property. This is allowed in Python 3.9, but it's not reflected
    // in the builtins.pyi stub for classmethod.
    if (
        isInstantiableClass(decoratorTypeResult.type) &&
        ClassType.isBuiltIn(decoratorTypeResult.type, 'classmethod') &&
        isProperty(functionOrClassType)
    ) {
        return functionOrClassType;
    }

    const argList: Arg[] = [
        {
            argCategory: ArgCategory.Simple,
            typeResult: { type: functionOrClassType },
        },
    ];

    const callTypeResult = evaluator.validateCallArgs(
        node.d.expr,
        argList,
        decoratorTypeResult,
        /* constraints */ undefined,
        /* skipUnknownArgCheck */ true,
        /* inferenceContext */ undefined
    );

    evaluator.setTypeResultForNode(node, {
        type: callTypeResult.returnType ?? UnknownType.create(),
        overloadsUsedForCall: callTypeResult.overloadsUsedForCall,
        isIncomplete: callTypeResult.isTypeIncomplete,
    });

    const returnType = callTypeResult.returnType ?? UnknownType.create();

    // If the return type is a function that has no annotations
    // and just *args and **kwargs parameters, assume that it
    // preserves the type of the input function.
    if (isFunction(returnType) && !returnType.shared.declaredReturnType) {
        if (
            !returnType.shared.parameters.some((param, index) => {
                // Don't allow * or / separators or params with declared types.
                if (!param.name || FunctionParam.isTypeDeclared(param)) {
                    return true;
                }

                // Allow *args or **kwargs parameters.
                if (param.category !== ParamCategory.Simple) {
                    return false;
                }

                // Allow inferred "self" or "cls" parameters.
                return index !== 0 || !FunctionParam.isTypeInferred(param);
            })
        ) {
            return functionOrClassType;
        }
    }

    // If the decorator is completely unannotated and the return type
    // includes unknowns, assume that it preserves the type of the input
    // function.
    if (isPartlyUnknown(returnType)) {
        if (isFunction(decoratorTypeResult.type)) {
            if (
                !decoratorTypeResult.type.shared.parameters.find((param) => FunctionParam.isTypeDeclared(param)) &&
                decoratorTypeResult.type.shared.declaredReturnType === undefined
            ) {
                return functionOrClassType;
            }
        }
    }

    return returnType;
}

// Given a function node and the function type associated with it, this
// method searches for prior function nodes that are marked as @overload
// and creates an OverloadedType that includes this function and
// all previous ones.
export function addOverloadsToFunctionType(evaluator: TypeEvaluator, node: FunctionNode, type: Type): Type {
    let functionDecl: FunctionDeclaration | undefined;
    let implementation: Type | undefined;

    const decl = getDeclaration(node);
    if (decl) {
        functionDecl = decl as FunctionDeclaration;
    }
    const symbolWithScope = evaluator.lookUpSymbolRecursive(node, node.d.name.d.value, /* honorCodeFlow */ false);
    if (symbolWithScope) {
        const decls = symbolWithScope.symbol.getDeclarations();

        // Find this function's declaration.
        const declIndex = decls.findIndex((decl) => decl === functionDecl);
        if (declIndex > 0) {
            // Evaluate all of the previous function declarations. They will
            // be cached. We do it in this order to avoid a stack overflow due
            // to recursion if there is a large number (1000's) of overloads.
            for (let i = 0; i < declIndex; i++) {
                const decl = decls[i];
                if (decl.type === DeclarationType.Function) {
                    evaluator.getTypeOfFunction(decl.node);
                }
            }

            let overloadedTypes: FunctionType[] = [];

            // Look at the previous declaration's type.
            const prevDecl = decls[declIndex - 1];
            if (prevDecl.type === DeclarationType.Function) {
                const prevDeclDeclTypeInfo = evaluator.getTypeOfFunction(prevDecl.node);
                if (prevDeclDeclTypeInfo) {
                    if (isFunction(prevDeclDeclTypeInfo.decoratedType)) {
                        if (FunctionType.isOverloaded(prevDeclDeclTypeInfo.decoratedType)) {
                            overloadedTypes.push(prevDeclDeclTypeInfo.decoratedType);
                        }
                    } else if (isOverloaded(prevDeclDeclTypeInfo.decoratedType)) {
                        implementation = OverloadedType.getImplementation(prevDeclDeclTypeInfo.decoratedType);
                        // If the previous overloaded function already had an implementation,
                        // this new function completely replaces the previous one.
                        if (implementation) {
                            return type;
                        }

                        // If the previous declaration was itself an overloaded function,
                        // copy the entries from it.
                        appendArray(overloadedTypes, OverloadedType.getOverloads(prevDeclDeclTypeInfo.decoratedType));
                    }
                }
            }

            if (isFunction(type) && FunctionType.isOverloaded(type)) {
                overloadedTypes.push(type);
            } else {
                implementation = type;
            }

            if (overloadedTypes.length === 1 && !implementation) {
                return overloadedTypes[0];
            }

            if (overloadedTypes.length === 0 && implementation) {
                return implementation;
            }

            // Apply the implementation's docstring to any overloads that don't
            // have their own docstrings.
            if (implementation && isFunction(implementation) && implementation.shared.docString) {
                const docString = implementation.shared.docString;
                overloadedTypes = overloadedTypes.map((overload) => {
                    if (FunctionType.isOverloaded(overload) && !overload.shared.docString) {
                        return FunctionType.cloneWithDocString(overload, docString);
                    }
                    return overload;
                });
            }

            // PEP 702 indicates that if the implementation of an overloaded
            // function is marked deprecated, all of the overloads should be
            // treated as deprecated as well.
            if (implementation && isFunction(implementation) && implementation.shared.deprecatedMessage !== undefined) {
                const deprecationMessage = implementation.shared.deprecatedMessage;
                overloadedTypes = overloadedTypes.map((overload) => {
                    if (FunctionType.isOverloaded(overload) && overload.shared.deprecatedMessage === undefined) {
                        return FunctionType.cloneWithDeprecatedMessage(overload, deprecationMessage);
                    }
                    return overload;
                });
            }

            return OverloadedType.create(overloadedTypes, implementation);
        }
    }

    return type;
}

// Given a @typing.deprecated call node, returns either '' or a custom
// deprecation message if one is provided.
export function getDeprecatedMessageFromCall(node: CallNode): string {
    if (
        node.d.args.length > 0 &&
        node.d.args[0].d.argCategory === ArgCategory.Simple &&
        node.d.args[0].d.valueExpr.nodeType === ParseNodeType.StringList
    ) {
        const stringListNode = node.d.args[0].d.valueExpr;
        const message = stringListNode.d.strings.map((s) => s.d.value).join('');
        return convertDocStringToPlainText(message);
    }

    return '';
}
