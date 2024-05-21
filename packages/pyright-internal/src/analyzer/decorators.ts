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
import { DiagnosticRule } from '../common/diagnosticRules';
import { LocMessage } from '../localization/localize';
import {
    ArgumentCategory,
    CallNode,
    DecoratorNode,
    FunctionNode,
    ParameterCategory,
    ParseNodeType,
} from '../parser/parseNodes';
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
import { EvaluatorFlags, FunctionArgument, TypeEvaluator } from './typeEvaluatorTypes';
import { isBuiltInDeprecatedType, isPartlyUnknown, isProperty } from './typeUtils';
import {
    ClassType,
    ClassTypeFlags,
    DataClassBehaviors,
    FunctionType,
    FunctionTypeFlags,
    OverloadedFunctionType,
    Type,
    UnknownType,
    isClassInstance,
    isFunction,
    isInstantiableClass,
    isOverloadedFunction,
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
        if (node.name.value === '__new__') {
            flags |= FunctionTypeFlags.ConstructorMethod;
        }

        // Several magic methods are treated as class methods implicitly
        // by the runtime. Check for these here.
        const implicitClassMethods = ['__init_subclass__', '__class_getitem__'];
        if (implicitClassMethods.some((name) => node.name.value === name)) {
            flags |= FunctionTypeFlags.ClassMethod;
        }
    }

    for (const decoratorNode of node.decorators) {
        // Some stub files (e.g. builtins.pyi) rely on forward declarations of decorators.
        let evaluatorFlags = fileInfo.isStubFile ? EvaluatorFlags.AllowForwardReferences : EvaluatorFlags.None;
        if (decoratorNode.expression.nodeType !== ParseNodeType.Call) {
            evaluatorFlags |= EvaluatorFlags.CallBaseDefaults;
        } else {
            if (decoratorNode.expression.nodeType === ParseNodeType.Call) {
                const decoratorCallType = evaluator.getTypeOfExpression(
                    decoratorNode.expression.leftExpression,
                    evaluatorFlags | EvaluatorFlags.CallBaseDefaults
                ).type;

                if (isBuiltInDeprecatedType(decoratorCallType)) {
                    deprecationMessage = getCustomDeprecationMessage(decoratorNode);
                }
            }
        }

        const decoratorTypeResult = evaluator.getTypeOfExpression(decoratorNode.expression, evaluatorFlags);
        const decoratorType = decoratorTypeResult.type;

        if (isFunction(decoratorType)) {
            if (decoratorType.details.builtInName === 'abstractmethod') {
                if (isInClass) {
                    flags |= FunctionTypeFlags.AbstractMethod;
                }
            } else if (decoratorType.details.builtInName === 'final') {
                flags |= FunctionTypeFlags.Final;
            } else if (decoratorType.details.builtInName === 'override') {
                flags |= FunctionTypeFlags.Overridden;
            } else if (decoratorType.details.builtInName === 'type_check_only') {
                flags |= FunctionTypeFlags.TypeCheckOnly;
            } else if (decoratorType.details.builtInName === 'no_type_check') {
                flags |= FunctionTypeFlags.NoTypeCheck;
            } else if (decoratorType.details.builtInName === 'overload') {
                flags |= FunctionTypeFlags.Overloaded;
            }
        } else if (isInstantiableClass(decoratorType)) {
            if (ClassType.isBuiltIn(decoratorType, 'staticmethod')) {
                if (isInClass) {
                    flags |= FunctionTypeFlags.StaticMethod;
                }
            } else if (ClassType.isBuiltIn(decoratorType, 'classmethod')) {
                if (isInClass) {
                    flags |= FunctionTypeFlags.ClassMethod;
                }
            }
        }

        if (isBuiltInDeprecatedType(decoratorType)) {
            deprecationMessage = getCustomDeprecationMessage(decoratorNode);
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
    let evaluatorFlags = fileInfo.isStubFile ? EvaluatorFlags.AllowForwardReferences : EvaluatorFlags.None;
    if (decoratorNode.expression.nodeType !== ParseNodeType.Call) {
        evaluatorFlags |= EvaluatorFlags.CallBaseDefaults;
    }

    const decoratorTypeResult = evaluator.getTypeOfExpression(decoratorNode.expression, evaluatorFlags);
    const decoratorType = decoratorTypeResult.type;

    // Special-case the "overload" because it has no definition. Older versions of typeshed
    // defined "overload" as an object, but newer versions define it as a function.
    if (
        (isInstantiableClass(decoratorType) && ClassType.isSpecialBuiltIn(decoratorType, 'overload')) ||
        (isFunction(decoratorType) && decoratorType.details.builtInName === 'overload')
    ) {
        if (isFunction(inputFunctionType)) {
            inputFunctionType.details.flags |= FunctionTypeFlags.Overloaded;
            undecoratedType.details.flags |= FunctionTypeFlags.Overloaded;
            return inputFunctionType;
        }
    }

    if (decoratorNode.expression.nodeType === ParseNodeType.Call) {
        const decoratorCallType = evaluator.getTypeOfExpression(
            decoratorNode.expression.leftExpression,
            evaluatorFlags | EvaluatorFlags.CallBaseDefaults
        ).type;

        if (isFunction(decoratorCallType)) {
            if (
                decoratorCallType.details.name === '__dataclass_transform__' ||
                decoratorCallType.details.builtInName === 'dataclass_transform'
            ) {
                undecoratedType.details.decoratorDataClassBehaviors = validateDataClassTransformDecorator(
                    evaluator,
                    decoratorNode.expression
                );
                return inputFunctionType;
            }
        }

        if (isBuiltInDeprecatedType(decoratorCallType)) {
            return inputFunctionType;
        }
    }

    let returnType = getTypeOfDecorator(evaluator, decoratorNode, inputFunctionType);

    // Check for some built-in decorator types with known semantics.
    if (isFunction(decoratorType)) {
        if (decoratorType.details.builtInName === 'abstractmethod') {
            return inputFunctionType;
        }

        if (decoratorType.details.builtInName === 'type_check_only') {
            undecoratedType.details.flags |= FunctionTypeFlags.TypeCheckOnly;
            return inputFunctionType;
        }

        // Handle property setters and deleters.
        if (decoratorNode.expression.nodeType === ParseNodeType.MemberAccess) {
            const baseType = evaluator.getTypeOfExpression(
                decoratorNode.expression.leftExpression,
                evaluatorFlags | EvaluatorFlags.MemberAccessBaseDefaults
            ).type;

            if (isProperty(baseType)) {
                const memberName = decoratorNode.expression.memberName.value;
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
            switch (decoratorType.details.name) {
                case 'classmethod':
                case 'staticmethod': {
                    const requiredFlag =
                        decoratorType.details.name === 'classmethod'
                            ? FunctionTypeFlags.ClassMethod
                            : FunctionTypeFlags.StaticMethod;

                    // If the function isn't currently a class method or static method
                    // (which can happen if the function was wrapped in a decorator),
                    // add the appropriate flag.
                    if (isFunction(inputFunctionType) && (inputFunctionType.details.flags & requiredFlag) === 0) {
                        const newFunction = FunctionType.clone(inputFunctionType);
                        newFunction.details.flags &= ~(
                            FunctionTypeFlags.ConstructorMethod |
                            FunctionTypeFlags.StaticMethod |
                            FunctionTypeFlags.ClassMethod
                        );
                        newFunction.details.flags |= requiredFlag;
                        return newFunction;
                    }

                    return inputFunctionType;
                }
            }
        }

        if (isBuiltInDeprecatedType(decoratorType)) {
            return inputFunctionType;
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
            returnType.details.flags |= FunctionTypeFlags.Overloaded;
        }

        // Copy the docstrings from the input function type if the
        // decorator didn't have its own docstring.
        if (!returnType.details.docString) {
            returnType.details.docString = inputFunctionType.details.docString;
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
    let flags = fileInfo.isStubFile ? EvaluatorFlags.AllowForwardReferences : EvaluatorFlags.None;
    if (decoratorNode.expression.nodeType !== ParseNodeType.Call) {
        flags |= EvaluatorFlags.CallBaseDefaults;
    }
    const decoratorType = evaluator.getTypeOfExpression(decoratorNode.expression, flags).type;

    if (decoratorNode.expression.nodeType === ParseNodeType.Call) {
        const decoratorCallType = evaluator.getTypeOfExpression(
            decoratorNode.expression.leftExpression,
            flags | EvaluatorFlags.CallBaseDefaults
        ).type;

        if (isFunction(decoratorCallType)) {
            if (
                decoratorCallType.details.name === '__dataclass_transform__' ||
                decoratorCallType.details.builtInName === 'dataclass_transform'
            ) {
                originalClassType.details.classDataClassTransform = validateDataClassTransformDecorator(
                    evaluator,
                    decoratorNode.expression
                );
            }
        }

        if (isBuiltInDeprecatedType(decoratorCallType)) {
            originalClassType.details.deprecatedMessage = getCustomDeprecationMessage(decoratorNode);
            return inputClassType;
        }
    }

    if (isOverloadedFunction(decoratorType)) {
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
        if (decoratorType.details.builtInName === 'final') {
            originalClassType.details.flags |= ClassTypeFlags.Final;

            // Don't call getTypeOfDecorator for final. We'll hard-code its
            // behavior because its function definition results in a cyclical
            // dependency between builtins, typing and _typeshed stubs.
            return inputClassType;
        }

        if (decoratorType.details.builtInName === 'type_check_only') {
            originalClassType.details.flags |= ClassTypeFlags.TypeCheckOnly;
            return inputClassType;
        }

        if (decoratorType.details.builtInName === 'runtime_checkable') {
            originalClassType.details.flags |= ClassTypeFlags.RuntimeCheckable;

            // Don't call getTypeOfDecorator for runtime_checkable. It appears
            // frequently in stubs, and it's a waste of time to validate its
            // parameters.
            return inputClassType;
        }

        // Is this a dataclass decorator?
        let dataclassBehaviors: DataClassBehaviors | undefined;
        let callNode: CallNode | undefined;

        if (decoratorNode.expression.nodeType === ParseNodeType.Call) {
            callNode = decoratorNode.expression;
            const decoratorCallType = evaluator.getTypeOfExpression(
                callNode.leftExpression,
                flags | EvaluatorFlags.CallBaseDefaults
            ).type;
            dataclassBehaviors = getDataclassDecoratorBehaviors(decoratorCallType);
        } else {
            const decoratorType = evaluator.getTypeOfExpression(decoratorNode.expression, flags).type;
            dataclassBehaviors = getDataclassDecoratorBehaviors(decoratorType);
        }

        if (dataclassBehaviors) {
            applyDataClassDecorator(evaluator, decoratorNode, originalClassType, dataclassBehaviors, callNode);
            return inputClassType;
        }
    }

    return getTypeOfDecorator(evaluator, decoratorNode, inputClassType);
}

function getTypeOfDecorator(evaluator: TypeEvaluator, node: DecoratorNode, functionOrClassType: Type): Type {
    // Evaluate the type of the decorator expression.
    let flags = getFileInfo(node).isStubFile ? EvaluatorFlags.AllowForwardReferences : EvaluatorFlags.None;
    if (node.expression.nodeType !== ParseNodeType.Call) {
        flags |= EvaluatorFlags.CallBaseDefaults;
    }

    const decoratorTypeResult = evaluator.getTypeOfExpression(node.expression, flags);

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

    const argList: FunctionArgument[] = [
        {
            argumentCategory: ArgumentCategory.Simple,
            typeResult: { type: functionOrClassType },
        },
    ];

    const callTypeResult = evaluator.validateCallArguments(
        node.expression,
        argList,
        decoratorTypeResult,
        /* typeVarContext */ undefined,
        /* skipUnknownArgCheck */ true,
        /* inferenceContext */ undefined,
        /* signatureTracker */ undefined
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
    if (isFunction(returnType) && !returnType.details.declaredReturnType) {
        if (
            !returnType.details.parameters.some((param, index) => {
                // Don't allow * or / separators or params with declared types.
                if (!param.name || param.hasDeclaredType) {
                    return true;
                }

                // Allow *args or **kwargs parameters.
                if (param.category !== ParameterCategory.Simple) {
                    return false;
                }

                // Allow inferred "self" or "cls" parameters.
                return index !== 0 || !param.isTypeInferred;
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
                !decoratorTypeResult.type.details.parameters.find((param) => param.typeAnnotation !== undefined) &&
                decoratorTypeResult.type.details.declaredReturnType === undefined
            ) {
                return functionOrClassType;
            }
        }
    }

    return returnType;
}

// Given a function node and the function type associated with it, this
// method searches for prior function nodes that are marked as @overload
// and creates an OverloadedFunctionType that includes this function and
// all previous ones.
export function addOverloadsToFunctionType(evaluator: TypeEvaluator, node: FunctionNode, type: FunctionType): Type {
    let functionDecl: FunctionDeclaration | undefined;
    const decl = getDeclaration(node);
    if (decl) {
        functionDecl = decl as FunctionDeclaration;
    }
    const symbolWithScope = evaluator.lookUpSymbolRecursive(node, node.name.value, /* honorCodeFlow */ false);
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
                    } else if (isOverloadedFunction(prevDeclDeclTypeInfo.decoratedType)) {
                        // If the previous declaration was itself an overloaded function,
                        // copy the entries from it.
                        appendArray(overloadedTypes, prevDeclDeclTypeInfo.decoratedType.overloads);
                    }
                }
            }

            overloadedTypes.push(type);

            if (overloadedTypes.length === 1) {
                return overloadedTypes[0];
            }

            // Apply the implementation's docstring to any overloads that don't
            // have their own docstrings.
            const implementation = overloadedTypes.find((signature) => !FunctionType.isOverloaded(signature));
            if (implementation?.details.docString) {
                overloadedTypes = overloadedTypes.map((overload) => {
                    if (FunctionType.isOverloaded(overload) && !overload.details.docString) {
                        return FunctionType.cloneWithDocString(overload, implementation.details.docString);
                    }
                    return overload;
                });
            }

            // PEP 702 indicates that if the implementation of an overloaded
            // function is marked deprecated, all of the overloads should be
            // treated as deprecated as well.
            if (implementation && implementation.details.deprecatedMessage !== undefined) {
                overloadedTypes = overloadedTypes.map((overload) => {
                    if (FunctionType.isOverloaded(overload) && overload.details.deprecatedMessage === undefined) {
                        return FunctionType.cloneWithDeprecatedMessage(
                            overload,
                            implementation.details.deprecatedMessage
                        );
                    }
                    return overload;
                });
            }

            // Create a new overloaded type that copies the contents of the previous
            // one and adds a new function.
            const newOverload = OverloadedFunctionType.create(overloadedTypes);

            const prevOverload = overloadedTypes[overloadedTypes.length - 2];
            const isPrevOverloadAbstract = FunctionType.isAbstractMethod(prevOverload);
            const isCurrentOverloadAbstract = FunctionType.isAbstractMethod(type);

            if (isPrevOverloadAbstract !== isCurrentOverloadAbstract) {
                evaluator.addDiagnostic(
                    DiagnosticRule.reportInconsistentOverload,
                    LocMessage.overloadAbstractMismatch().format({ name: node.name.value }),
                    node.name
                );
            }

            return newOverload;
        }
    }

    return type;
}

// Given a @typing.deprecated decorator node, returns either '' or a custom
// deprecation message if one is provided.
function getCustomDeprecationMessage(decorator: DecoratorNode): string {
    if (
        decorator.expression.nodeType === ParseNodeType.Call &&
        decorator.expression.arguments.length > 0 &&
        decorator.expression.arguments[0].argumentCategory === ArgumentCategory.Simple &&
        decorator.expression.arguments[0].valueExpression.nodeType === ParseNodeType.StringList
    ) {
        const stringListNode = decorator.expression.arguments[0].valueExpression;
        const message = stringListNode.strings.map((s) => s.value).join('');
        return convertDocStringToPlainText(message);
    }

    return '';
}
