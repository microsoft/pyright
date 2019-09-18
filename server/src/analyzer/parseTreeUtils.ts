/*
* parseTreeUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Utility routines for traversing a parse tree.
*/

import { DiagnosticTextPosition } from '../common/diagnostic';
import { convertPositionToOffset } from '../common/positionUtils';
import { TextRange } from '../common/textRange';
import { TextRangeCollection } from '../common/textRangeCollection';
import { ArgumentCategory, ClassNode, ExpressionNode, FunctionNode, isExpressionNode,
    ModuleNode, ParameterCategory, ParseNode, ParseNodeType, SuiteNode } from '../parser/parseNodes';
import { KeywordType, OperatorType, StringTokenFlags } from '../parser/tokenizerTypes';
import { ParseTreeWalker } from './parseTreeWalker';

export const enum PrintExpressionFlags {
    None = 0,

    // Don't use string literals for forward declarations.
    ForwardDeclarations = 0x01
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
export function findNodeByPosition(node: ParseNode, position: DiagnosticTextPosition,
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

// Some nodes (like decorators) are contained within an inner parse
// node (like a function or class) but whose scope belongs to an
// outer node. This method handles these special cases and returns
// a parse node that can be used to determine the appropriate scope
// for evaluating the node.
export function getScopeNodeForNode(node: ParseNode) {
    let curNode = node.parent;

    while (curNode) {
        // The function name is evaluated within the scope of its container.
        if (curNode.nodeType === ParseNodeType.Function && node === curNode.name) {
            return curNode.parent;
        }

        if (curNode.nodeType === ParseNodeType.Decorator) {
            // All decorators are contained within a function or class.
            // Return the container of this function or class.
            return curNode.parent!.parent;
        }

        if (curNode.nodeType === ParseNodeType.Parameter) {
            // Is this a default value initializer for a function parameter?
            // They are evaluated outside the scope of the function.
            if (node !== curNode.name) {
                const paramParent = curNode.parent;
                if (paramParent && paramParent.nodeType === ParseNodeType.Function) {
                    return paramParent.parent;
                }
            }
        }

        if (curNode.nodeType === ParseNodeType.Function ||
                curNode.nodeType === ParseNodeType.Lambda ||
                curNode.nodeType === ParseNodeType.Class) {
            break;
        }

        curNode = curNode.parent;
    }

    return node;
}

export function printExpression(node: ExpressionNode, flags = PrintExpressionFlags.None): string {
    if (node.nodeType === ParseNodeType.Name) {
        return node.nameToken.value;
    } else if (node.nodeType === ParseNodeType.MemberAccess) {
        return printExpression(node.leftExpression, flags) + '.' +
            node.memberName.nameToken.value;
    } else if (node.nodeType === ParseNodeType.Call) {
        return printExpression(node.leftExpression, flags) + '(' +
            node.arguments.map(arg => {
                let argStr = '';
                if (arg.argumentCategory === ArgumentCategory.UnpackedList) {
                    argStr = '*';
                } else if (arg.argumentCategory === ArgumentCategory.UnpackedDictionary) {
                    argStr = '**';
                }
                if (arg.name) {
                    argStr += arg.name.nameToken.value + '=';
                }
                argStr += printExpression(arg.valueExpression, flags);
                return argStr;
            }).join(', ') +
            ')';
    } else if (node.nodeType === ParseNodeType.Index) {
        return printExpression(node.baseExpression, flags) + '[' +
            node.items.items.map(item => printExpression(item, flags)).join(', ') +
            ']';
    } else if (node.nodeType === ParseNodeType.UnaryOperation) {
        return printOperator(node.operator) + ' ' +
            printExpression(node.expression, flags);
    } else if (node.nodeType === ParseNodeType.BinaryOperation) {
        return printExpression(node.leftExpression, flags) + ' ' +
            printOperator(node.operator) + ' ' +
            printExpression(node.rightExpression, flags);
    } else if (node.nodeType === ParseNodeType.Number) {
        return node.token.value.toString();
    } else if (node.nodeType === ParseNodeType.StringList) {
        if ((flags & PrintExpressionFlags.ForwardDeclarations) && node.typeAnnotation) {
            return printExpression(node.typeAnnotation, flags);
        } else {
            return node.strings.map(str => {
                return printExpression(str, flags);
            }).join(' ');
        }
    } else if (node.nodeType === ParseNodeType.String) {
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
    } else if (node.nodeType === ParseNodeType.Assignment) {
        return printExpression(node.leftExpression, flags) + ' = ' +
            printExpression(node.rightExpression, flags);
    } else if (node.nodeType === ParseNodeType.TypeAnnotation) {
        return printExpression(node.valueExpression, flags) + ': ' +
            printExpression(node.typeAnnotation, flags);
    } else if (node.nodeType === ParseNodeType.AugmentedAssignment) {
        return printExpression(node.leftExpression, flags) + ' ' +
            printOperator(node.operator) + ' ' +
            printExpression(node.rightExpression, flags);
    } else if (node.nodeType === ParseNodeType.Await) {
        return 'await ' + printExpression(node.expression, flags);
    } else if (node.nodeType === ParseNodeType.Ternary) {
        return printExpression(node.ifExpression, flags) + ' if ' +
            printExpression(node.testExpression, flags) + ' else ' +
            printExpression(node.elseExpression, flags);
    } else if (node.nodeType === ParseNodeType.List) {
        const expressions = node.entries.map(expr => {
            return printExpression(expr, flags);
        });
        return `[${ expressions.join(', ') }]`;
    } else if (node.nodeType === ParseNodeType.Unpack) {
        return '*' + printExpression(node.expression, flags);
    } else if (node.nodeType === ParseNodeType.Tuple) {
        const expressions = node.expressions.map(expr => {
            return printExpression(expr, flags);
        });
        if (expressions.length === 1) {
            return `(${ expressions[0] }, )`;
        }
        return `(${ expressions.join(', ') })`;
    } else if (node.nodeType === ParseNodeType.Yield) {
        return 'yield ' + printExpression(node.expression, flags);
    } else if (node.nodeType === ParseNodeType.YieldFrom) {
        return 'yield from ' + printExpression(node.expression, flags);
    } else if (node.nodeType === ParseNodeType.Ellipsis) {
        return '...';
    } else if (node.nodeType === ParseNodeType.ListComprehension) {
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
    } else if (node.nodeType === ParseNodeType.Slice) {
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
    } else if (node.nodeType === ParseNodeType.Lambda) {
        return 'lambda ' + node.parameters.map(param => {
            let paramStr = '';

            if (param.category === ParameterCategory.VarArgList) {
                paramStr += '*';
            } else if (param.category === ParameterCategory.VarArgDictionary) {
                paramStr += '**';
            }

            if (param.name) {
                paramStr += param.name.nameToken.value;
            }

            if (param.defaultValue) {
                paramStr += ' = ' + printExpression(param.defaultValue, flags);
            }
            return paramStr;
        }).join(', ') + ': ' + printExpression(node.expression, flags);
    } else if (node.nodeType === ParseNodeType.Constant) {
        if (node.token.keywordType === KeywordType.True) {
            return 'True';
        } else if (node.token.keywordType === KeywordType.False) {
            return 'False';
        } else if (node.token.keywordType === KeywordType.Debug) {
            return '__debug__';
        } else if (node.token.keywordType === KeywordType.None) {
            return 'None';
        }
    } else if (node.nodeType === ParseNodeType.Dictionary) {
        return `{ ${ node.entries.map(entry => {
            if (entry.nodeType === ParseNodeType.DictionaryKeyEntry) {
                return `${ printExpression(entry.keyExpression, flags) }: ` +
                    `${ printExpression(entry.valueExpression, flags) }`;
            } else {
                return printExpression(entry, flags);
            }
        })} }`;
    } else if (node.nodeType === ParseNodeType.DictionaryExpandEntry) {
        return `**${ printExpression(node.expandExpression, flags) }`;
    } else if (node.nodeType === ParseNodeType.Set) {
        return node.entries.map(entry => printExpression(entry, flags)).join(', ');
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
