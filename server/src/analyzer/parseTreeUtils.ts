/*
* parseTreeUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Utility routines for traversing a parse tree.
*/

import { fail } from '../common/debug';
import { convertPositionToOffset } from '../common/positionUtils';
import { Position } from '../common/textRange';
import { TextRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { ArgumentCategory, AssignmentExpressionNode, ClassNode, EvaluationScopeNode,
    ExecutionScopeNode, ExpressionNode, FunctionNode, isExpressionNode, LambdaNode, ModuleNode,
    ParameterCategory, ParseNode, ParseNodeType, StatementNode, SuiteNode } from '../parser/parseNodes';
import { KeywordType, OperatorType, StringTokenFlags } from '../parser/tokenizerTypes';
import { decodeDocString } from './docStringUtils';
import { ParseTreeWalker } from './parseTreeWalker';

export const enum PrintExpressionFlags {
    None = 0,

    // Don't use string literals for forward declarations.
    ForwardDeclarations = 1 << 0
}

export function getNodeDepth(node: ParseNode): number {
    let depth = 0;
    let curNode: ParseNode | undefined = node;

    while (curNode) {
        depth++;
        curNode = curNode.parent;
    }

    return depth;
}

// Returns the deepest node that contains the specified position.
export function findNodeByPosition(node: ParseNode, position: Position,
        lines: TextRangeCollection<TextRange>): ParseNode | undefined {

    const offset = convertPositionToOffset(position, lines);
    if (offset === undefined) {
        return undefined;
    }

    return findNodeByOffset(node, offset);
}

// Returns the deepest node that contains the specified offset.
export function findNodeByOffset(node: ParseNode, offset: number): ParseNode | undefined {
    if (offset < node.start || offset > TextRange.getEnd(node)) {
        return undefined;
    }

    const parseTreeWalker = new ParseTreeWalker();

    // The range is found within this node. See if we can localize it
    // further by checking its children.
    const children = parseTreeWalker.visitNode(node);
    for (const child of children) {
        if (child) {
            const containingChild = findNodeByOffset(child, offset);
            if (containingChild) {
                return containingChild;
            }
        }
    }

    return node;
}

export function printExpression(node: ExpressionNode, flags = PrintExpressionFlags.None): string {
    switch (node.nodeType) {
        case ParseNodeType.Name: {
            return node.value;
        }

        case ParseNodeType.MemberAccess: {
            return printExpression(node.leftExpression, flags) + '.' +
                node.memberName.value;
        }

        case ParseNodeType.Call: {
            return printExpression(node.leftExpression, flags) + '(' +
                node.arguments.map(arg => {
                    let argStr = '';
                    if (arg.argumentCategory === ArgumentCategory.UnpackedList) {
                        argStr = '*';
                    } else if (arg.argumentCategory === ArgumentCategory.UnpackedDictionary) {
                        argStr = '**';
                    }
                    if (arg.name) {
                        argStr += arg.name.value + '=';
                    }
                    argStr += printExpression(arg.valueExpression, flags);
                    return argStr;
                }).join(', ') +
                ')';
        }

        case ParseNodeType.Index: {
            return printExpression(node.baseExpression, flags) + '[' +
                node.items.items.map(item => printExpression(item, flags)).join(', ') +
                ']';
        }

        case ParseNodeType.UnaryOperation: {
            return printOperator(node.operator) + ' ' +
                printExpression(node.expression, flags);
        }

        case ParseNodeType.BinaryOperation: {
            return printExpression(node.leftExpression, flags) + ' ' +
                printOperator(node.operator) + ' ' +
                printExpression(node.rightExpression, flags);
        }

        case ParseNodeType.Number: {
            let value = node.value.toString();
            if (node.isImaginary) {
                value += 'j';
            }
            return value;
        }

        case ParseNodeType.StringList: {
            if ((flags & PrintExpressionFlags.ForwardDeclarations) && node.typeAnnotation) {
                return printExpression(node.typeAnnotation, flags);
            } else {
                return node.strings.map(str => {
                    return printExpression(str, flags);
                }).join(' ');
            }
        }

        case ParseNodeType.String: {
            let exprString = '';
            if (node.token.flags & StringTokenFlags.Raw) {
                exprString += 'r';
            }

            if (node.token.flags & StringTokenFlags.Unicode) {
                exprString += 'u';
            }

            if (node.token.flags & StringTokenFlags.Bytes) {
                exprString += 'b';
            }

            if (node.token.flags & StringTokenFlags.Format) {
                exprString += 'f';
            }

            if (node.token.flags & StringTokenFlags.Triplicate) {
                if (node.token.flags & StringTokenFlags.SingleQuote) {
                    exprString += `'''${ node.token.escapedValue }'''`;
                } else {
                    exprString += `"""${ node.token.escapedValue }"""`;
                }
            } else {
                if (node.token.flags & StringTokenFlags.SingleQuote) {
                    exprString += `'${ node.token.escapedValue }'`;
                } else {
                    exprString += `"${ node.token.escapedValue }"`;
                }
            }

            return exprString;
        }

        case ParseNodeType.Assignment: {
            return printExpression(node.leftExpression, flags) + ' = ' +
                printExpression(node.rightExpression, flags);
        }

        case ParseNodeType.AssignmentExpression: {
            return printExpression(node.name, flags) + ' := ' +
                printExpression(node.rightExpression, flags);
        }

        case ParseNodeType.TypeAnnotation: {
            return printExpression(node.valueExpression, flags) + ': ' +
                printExpression(node.typeAnnotation, flags);
        }

        case ParseNodeType.AugmentedAssignment: {
            return printExpression(node.leftExpression, flags) + ' ' +
                printOperator(node.operator) + ' ' +
                printExpression(node.rightExpression, flags);
        }

        case ParseNodeType.Await: {
            return 'await ' + printExpression(node.expression, flags);
        }

        case ParseNodeType.Ternary: {
            return printExpression(node.ifExpression, flags) + ' if ' +
                printExpression(node.testExpression, flags) + ' else ' +
                printExpression(node.elseExpression, flags);
        }

        case ParseNodeType.List: {
            const expressions = node.entries.map(expr => {
                return printExpression(expr, flags);
            });
            return `[${ expressions.join(', ') }]`;
        }

        case ParseNodeType.Unpack: {
            return '*' + printExpression(node.expression, flags);
        }

        case ParseNodeType.Tuple: {
            const expressions = node.expressions.map(expr => {
                return printExpression(expr, flags);
            });
            if (expressions.length === 1) {
                return `(${ expressions[0] }, )`;
            }
            return `(${ expressions.join(', ') })`;
        }

        case ParseNodeType.Yield: {
            if (node.expression) {
                return 'yield ' + printExpression(node.expression, flags);
            } else {
                return 'yield';
            }
        }

        case ParseNodeType.YieldFrom: {
            return 'yield from ' + printExpression(node.expression, flags);
        }

        case ParseNodeType.Ellipsis: {
            return '...';
        }

        case ParseNodeType.ListComprehension: {
            let listStr = '<ListExpression>';

            if (isExpressionNode(node.expression)) {
                listStr = printExpression(node.expression as ExpressionNode, flags);
            } else if (node.expression.nodeType === ParseNodeType.DictionaryKeyEntry) {
                const keyStr = printExpression(node.expression.keyExpression, flags);
                const valueStr = printExpression(node.expression.valueExpression, flags);
                listStr = `${ keyStr }: ${ valueStr }`;
            }

            return listStr + ' ' +
                node.comprehensions.map(expr => {
                    if (expr.nodeType === ParseNodeType.ListComprehensionFor) {
                        return `${ expr.isAsync ? 'async ' : '' }for ` +
                            printExpression(expr.targetExpression, flags) +
                            ` in ${ printExpression(expr.iterableExpression, flags) }`;
                    } else {
                        return `if ${ printExpression(expr.testExpression, flags) }`;
                    }
                }).join(' ');
        }

        case ParseNodeType.Slice: {
            let result = '';
            if (node.startValue) {
                result += printExpression(node.startValue, flags);
            }
            if (node.endValue) {
                result += ': ' + printExpression(node.endValue, flags);
            }
            if (node.stepValue) {
                result += ': ' + printExpression(node.stepValue, flags);
            }
            return result;
        }

        case ParseNodeType.Lambda: {
            return 'lambda ' + node.parameters.map(param => {
                let paramStr = '';

                if (param.category === ParameterCategory.VarArgList) {
                    paramStr += '*';
                } else if (param.category === ParameterCategory.VarArgDictionary) {
                    paramStr += '**';
                }

                if (param.name) {
                    paramStr += param.name.value;
                }

                if (param.defaultValue) {
                    paramStr += ' = ' + printExpression(param.defaultValue, flags);
                }
                return paramStr;
            }).join(', ') + ': ' + printExpression(node.expression, flags);
        }

        case ParseNodeType.Constant: {
            if (node.constType === KeywordType.True) {
                return 'True';
            } else if (node.constType === KeywordType.False) {
                return 'False';
            } else if (node.constType === KeywordType.Debug) {
                return '__debug__';
            } else if (node.constType === KeywordType.None) {
                return 'None';
            }
            break;
        }

        case ParseNodeType.Dictionary: {
            return `{ ${ node.entries.map(entry => {
                if (entry.nodeType === ParseNodeType.DictionaryKeyEntry) {
                    return `${ printExpression(entry.keyExpression, flags) }: ` +
                        `${ printExpression(entry.valueExpression, flags) }`;
                } else {
                    return printExpression(entry, flags);
                }
            })} }`;
        }

        case ParseNodeType.DictionaryExpandEntry: {
            return `**${ printExpression(node.expandExpression, flags) }`;
        }

        case ParseNodeType.Set: {
            return node.entries.map(entry => printExpression(entry, flags)).join(', ');
        }
    }

    return '<Expression>';
}

export function printOperator(operator: OperatorType): string {
    const operatorMap: { [operator: number]: string } = {
        [OperatorType.Add]: '+',
        [OperatorType.AddEqual]: '+=',
        [OperatorType.Assign]: '=',
        [OperatorType.BitwiseAnd]: '&',
        [OperatorType.BitwiseAndEqual]: '&=',
        [OperatorType.BitwiseInvert]: '~',
        [OperatorType.BitwiseOr]: '|',
        [OperatorType.BitwiseOrEqual]: '|=',
        [OperatorType.BitwiseXor]: '^',
        [OperatorType.BitwiseXorEqual]: '^=',
        [OperatorType.Divide]: '/',
        [OperatorType.DivideEqual]: '/=',
        [OperatorType.Equals]: '==',
        [OperatorType.FloorDivide]: '//',
        [OperatorType.FloorDivideEqual]: '//=',
        [OperatorType.GreaterThan]: '>',
        [OperatorType.GreaterThanOrEqual]: '>=',
        [OperatorType.LeftShift]: '<<',
        [OperatorType.LeftShiftEqual]: '<<=',
        [OperatorType.LessThan]: '<',
        [OperatorType.LessThanOrEqual]: '<=',
        [OperatorType.MatrixMultiply]: '@',
        [OperatorType.MatrixMultiplyEqual]: '@=',
        [OperatorType.Mod]: '%',
        [OperatorType.ModEqual]: '%=',
        [OperatorType.Multiply]: '*',
        [OperatorType.MultiplyEqual]: '*=',
        [OperatorType.NotEquals]: '!=',
        [OperatorType.Power]: '**',
        [OperatorType.PowerEqual]: '**=',
        [OperatorType.RightShift]: '>>',
        [OperatorType.RightShiftEqual]: '>>=',
        [OperatorType.Subtract]: '-',
        [OperatorType.SubtractEqual]: '-=',
        [OperatorType.And]: 'and',
        [OperatorType.Or]: 'or',
        [OperatorType.Not]: 'not',
        [OperatorType.Is]: 'is',
        [OperatorType.IsNot]: 'is not',
        [OperatorType.In]: 'in',
        [OperatorType.NotIn]: 'not in'
    };

    if (operatorMap[operator]) {
        return operatorMap[operator];
    }

    return 'unknown';
}

export function getEnclosingClass(node: ParseNode, stopAtFunction = false): ClassNode | undefined {
    let curNode = node.parent;
    while (curNode) {
        if (curNode.nodeType === ParseNodeType.Class) {
            return curNode;
        }

        if (curNode.nodeType === ParseNodeType.Module) {
            return undefined;
        }

        if (curNode.nodeType === ParseNodeType.Function) {
            if (stopAtFunction) {
                return undefined;
            }
        }

        curNode = curNode.parent;
    }

    return undefined;
}

export function getEnclosingModule(node: ParseNode): ModuleNode {
    let curNode = node.parent;
    while (curNode) {
        if (curNode.nodeType === ParseNodeType.Module) {
            return curNode;
        }

        curNode = curNode.parent;
    }

    fail('Module node not found');
    return undefined!;
}

export function getEnclosingClassOrModule(node: ParseNode,
        stopAtFunction = false): ClassNode | ModuleNode | undefined {

    let curNode = node.parent;
    while (curNode) {
        if (curNode.nodeType === ParseNodeType.Class) {
            return curNode;
        }

        if (curNode.nodeType === ParseNodeType.Module) {
            return curNode;
        }

        if (curNode.nodeType === ParseNodeType.Function) {
            if (stopAtFunction) {
                return undefined;
            }
        }

        curNode = curNode.parent;
    }

    return undefined;
}

export function getEnclosingFunction(node: ParseNode): FunctionNode | undefined {
    let curNode = node.parent;
    while (curNode) {
        if (curNode.nodeType === ParseNodeType.Function) {
            return curNode;
        }

        if (curNode.nodeType === ParseNodeType.Class) {
            return undefined;
        }

        curNode = curNode.parent;
    }

    return undefined;
}

export function getEvaluationNodeForAssignmentExpression(node: AssignmentExpressionNode):
        LambdaNode | FunctionNode | ModuleNode | undefined {

    // PEP 572 indicates that the evaluation node for an assignment expression
    // target is the containing lambda, function or module, but not a class.
    let curNode: ParseNode | undefined = getEvaluationScopeNode(node);

    while (curNode !== undefined) {
        switch (curNode.nodeType) {
            case ParseNodeType.Function:
            case ParseNodeType.Lambda:
            case ParseNodeType.Module:
                return curNode;

            case ParseNodeType.Class:
                return undefined;
        }

        curNode = curNode.parent;
    }

    return undefined;
}

// Returns the parse node corresponding to the scope that is used to evaluate
// a symbol referenced in the specified node.
export function getEvaluationScopeNode(node: ParseNode): EvaluationScopeNode {
    let prevNode: ParseNode | undefined;
    let curNode: ParseNode | undefined = node;
    let isParamNameNode = false;

    while (curNode) {
        if (curNode.nodeType === ParseNodeType.Parameter && prevNode === curNode.name) {
            // Note that we passed through a parameter name node.
            isParamNameNode = true;
        }

        // We found a scope associated with this node. In most cases,
        // we'll return this scope, but in a few cases we need to return
        // the enclosing scope instead.
        switch (curNode.nodeType) {
            case ParseNodeType.Function: {
                if (curNode.parameters.some(param => param === prevNode)) {
                    if (isParamNameNode) {
                        return curNode;
                    }
                } else if (prevNode === curNode.suite) {
                    return curNode;
                }
                break;
            }

            case ParseNodeType.Class: {
                if (prevNode === curNode.suite) {
                    return curNode;
                }
                break;
            }

            case ParseNodeType.ListComprehension:
            case ParseNodeType.Module:
            case ParseNodeType.Lambda: {
                return curNode;
            }
        }

        prevNode = curNode;
        curNode = curNode.parent;
    }

    fail('Did not find evaluation scope');
    return undefined!;
}

// Returns the parse node corresponding to the scope that is used
// for executing the code referenced in the specified node.
export function getExecutionScopeNode(node: ParseNode): ExecutionScopeNode {
    let evaluationScope = getEvaluationScopeNode(node);

    // Classes are not considered execution scope because they are executed
    // within the context of their containing module or function. Likewise, list
    // comprehensions are executed within their container.
    while (evaluationScope.nodeType === ParseNodeType.Class ||
            evaluationScope.nodeType === ParseNodeType.ListComprehension) {

        evaluationScope = getEvaluationScopeNode(evaluationScope.parent!);
    }

    return evaluationScope;
}

export function isNodeContainedWithin(node: ParseNode, potentialContainer: ParseNode): boolean {
    let curNode = node.parent;
    while (curNode) {
        if (curNode === potentialContainer) {
            return true;
        }

        curNode = curNode.parent;
    }

    return false;
}

export function isSuiteEmpty(node: SuiteNode): boolean {
    for (const statement of node.statements) {
        if (statement.nodeType === ParseNodeType.StatementList) {
            for (const substatement of statement.statements) {
                if (substatement.nodeType === ParseNodeType.Ellipsis) {
                    // Allow an ellipsis
                } else if (substatement.nodeType === ParseNodeType.StringList) {
                    // Allow doc strings
                } else {
                    return false;
                }
            }
        } else {
            return false;
        }
    }

    return true;
}

export function isMatchingExpression(expression1: ExpressionNode, expression2: ExpressionNode): boolean {
    if (expression1.nodeType === ParseNodeType.Name && expression2.nodeType === ParseNodeType.Name) {
        return expression1.value === expression2.value;
    } else if (expression1.nodeType === ParseNodeType.MemberAccess && expression2.nodeType === ParseNodeType.MemberAccess) {
        return isMatchingExpression(expression1.leftExpression, expression2.leftExpression) &&
            expression1.memberName.value === expression2.memberName.value;
    }

    return false;
}

export function isWithinDefaultParamInitializer(node: ParseNode) {
    let curNode: ParseNode | undefined = node;
    let prevNode: ParseNode | undefined;

    while (curNode) {
        if (curNode.nodeType === ParseNodeType.Parameter && prevNode === curNode.defaultValue) {
            return true;
        }

        if (curNode.nodeType === ParseNodeType.Lambda ||
                curNode.nodeType === ParseNodeType.Function ||
                curNode.nodeType === ParseNodeType.Class ||
                curNode.nodeType === ParseNodeType.Module) {
            return false;
        }

        prevNode = curNode;
        curNode = curNode.parent;
    }

    return false;
}

export function getDocString(statements: StatementNode[]): string | undefined {
    // See if the first statement in the suite is a triple-quote string.
    if (statements.length === 0) {
        return undefined;
    }

    if (statements[0].nodeType !== ParseNodeType.StatementList) {
        return undefined;
    }

    // If the first statement in the suite isn't a StringNode,
    // assume there is no docString.
    const statementList = statements[0];
    if (statementList.statements.length === 0 ||
            statementList.statements[0].nodeType !== ParseNodeType.StringList) {
        return undefined;
    }

    const docStringNode = statementList.statements[0];
    const docStringToken = docStringNode.strings[0].token;

    // Ignore f-strings.
    if ((docStringToken.flags & StringTokenFlags.Format) !== 0) {
        return undefined;
    }

    return decodeDocString(docStringNode.strings[0].value);
}

// Sometimes a NamedTuple assignment statement is followed by a statement
// that looks like the following:
//    MyNamedTuple.__new__.__defaults__ = ...
// This pattern is commonly used to set the default values that are
// not specified in the original list.
export function isAssignmentToDefaultsFollowingNamedTuple(callNode: ParseNode): boolean {
    if (callNode.nodeType !== ParseNodeType.Call || !callNode.parent ||
            callNode.parent.nodeType !== ParseNodeType.Assignment ||
            callNode.parent.leftExpression.nodeType !== ParseNodeType.Name ||
            !callNode.parent.parent ||
            callNode.parent.parent.nodeType !== ParseNodeType.StatementList) {

        return false;
    }

    const namedTupleAssignedName = callNode.parent.leftExpression.value;
    const statementList = callNode.parent.parent;
    if (statementList.statements[0] !== callNode.parent ||
            !statementList.parent ||
            !(statementList.parent.nodeType === ParseNodeType.Module ||
                statementList.parent.nodeType === ParseNodeType.Suite)) {

        return false;
    }

    const moduleOrSuite = statementList.parent;
    let statementIndex = moduleOrSuite.statements.findIndex(s => s === statementList);

    if (statementIndex < 0) {
        return false;
    }
    statementIndex++;

    while (statementIndex < moduleOrSuite.statements.length) {
        const nextStatement = moduleOrSuite.statements[statementIndex];
        if (nextStatement.nodeType !== ParseNodeType.StatementList) {
            break;
        }

        if (nextStatement.statements[0].nodeType === ParseNodeType.StringList) {
            // Skip over comments
            statementIndex++;
            continue;
        }

        if (nextStatement.statements[0].nodeType === ParseNodeType.Assignment) {
            const assignNode = nextStatement.statements[0];
            if (assignNode.leftExpression.nodeType === ParseNodeType.MemberAccess &&
                    assignNode.leftExpression.memberName.value === '__defaults__') {

                const defaultTarget = assignNode.leftExpression.leftExpression;
                if (defaultTarget.nodeType === ParseNodeType.MemberAccess &&
                        defaultTarget.memberName.value === '__new__' &&
                        defaultTarget.leftExpression.nodeType === ParseNodeType.Name &&
                        defaultTarget.leftExpression.value === namedTupleAssignedName) {

                    return true;
                }
            }
        }

        break;
    }

    return false;
}
