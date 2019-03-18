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
import { CallExpressionNode, ClassNode, ExpressionNode, FunctionNode,
    IndexExpressionNode, MemberAccessExpressionNode, ModuleNode,
    NameNode, ParseNode } from '../parser/parseNodes';

export class ParseTreeUtils {
    // Returns the deepest node that contains the specified position.
    static findNodeByPosition(node: ParseNode, position: DiagnosticTextPosition,
            lines: TextRangeCollection<TextRange>): ParseNode | undefined {

        let offset = convertPositionToOffset(position, lines);
        if (offset === undefined) {
            return undefined;
        }

        return ParseTreeUtils.findNodeByOffset(node, offset);
    }

    // Returns the deepest node that contains the specified offset.
    static findNodeByOffset(node: ParseNode, offset: number): ParseNode | undefined {
        if (offset < node.start || offset >= node.end) {
            return undefined;
        }

        // The range is found within this node. See if we can localize it
        // further by checking its children.
        let children = node.getChildrenFlattened();
        for (let child of children) {
            let containingChild = ParseTreeUtils.findNodeByOffset(child, offset);
            if (containingChild) {
                return containingChild;
            }
        }

        return node;
    }

    static printExpression(node: ExpressionNode): string {
        if (node instanceof NameNode) {
            return node.nameToken.value;
        } else if (node instanceof MemberAccessExpressionNode) {
            return ParseTreeUtils.printExpression(node.leftExpression) + '.' +
                node.memberName.nameToken.value;
        } else if (node instanceof CallExpressionNode) {
            return ParseTreeUtils.printExpression(node.leftExpression) + '(' +
                node.arguments.map(arg => this.printExpression(arg.valueExpression)).join(', ') +
                ')';
        } else if (node instanceof IndexExpressionNode) {
            return ParseTreeUtils.printExpression(node.baseExpression) + '[' +
                this.printExpression(node.indexExpression) + ']';
        }

        // TODO - need to finish
        return '<Expression>';
    }

    static getEnclosingClass(node: ParseNode): ClassNode | undefined {
        let curNode = node.parent;
        while (curNode) {
            if (curNode instanceof ClassNode) {
                return curNode;
            }

            curNode = curNode.parent;
        }

        return undefined;
    }

    static getEnclosingFunction(node: ParseNode): FunctionNode | undefined {
        let curNode = node.parent;
        while (curNode) {
            if (curNode instanceof FunctionNode) {
                return curNode;
            }
            if (curNode instanceof ClassNode) {
                return undefined;
            }

            curNode = curNode.parent;
        }

        return undefined;
    }

    static isFunctionInClass(functionNode: FunctionNode): boolean {
        let curNode = functionNode.parent;
        while (curNode) {
            if (curNode instanceof ClassNode) {
                return true;
            }

            if (curNode instanceof FunctionNode || curNode instanceof ModuleNode) {
                return false;
            }

            curNode = curNode.parent;
        }

        return false;
    }

    static functionHasDecorator(node: FunctionNode, decoratorName: string): boolean {
        let targetDecorator = node.decorators.find(decorator => {
            return decorator.callName instanceof NameNode &&
                decorator.callName.nameToken.value === decoratorName &&
                decorator.arguments.length === 0;
        });

        return targetDecorator !== undefined;
    }
}
