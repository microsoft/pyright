/*
 * testWalker.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Walks a parse tree to validate internal consistency and completeness.
 */

import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { fail } from '../common/debug';
import { TextRange } from '../common/textRange';
import { NameNode, ParseNode, ParseNodeArray, ParseNodeType } from '../parser/parseNodes';
import { isCompliantWithNodeRangeRules } from './parseTreeUtils';
import { TypeEvaluator } from './typeEvaluatorTypes';

export class TestWalker extends ParseTreeWalker {
    constructor() {
        super();
    }

    override visitNode(node: ParseNode) {
        const children = super.visitNode(node);
        this._verifyParentChildLinks(node, children);
        this._verifyChildRanges(node, children);

        return children;
    }

    // Make sure that all of the children point to their parent.
    private _verifyParentChildLinks(node: ParseNode, children: ParseNodeArray) {
        children.forEach((child) => {
            if (child) {
                if (child.parent !== node) {
                    fail(
                        `Child node ${child.nodeType} does not ` + `contain a reference to its parent ${node.nodeType}`
                    );
                }
            }
        });
    }

    // Verify that:
    //      Children are all contained within the parent
    //      Children have non-overlapping ranges
    //      Children are listed in increasing order
    private _verifyChildRanges(node: ParseNode, children: ParseNodeArray) {
        let prevNode: ParseNode | undefined;

        const compliant = isCompliantWithNodeRangeRules(node);
        children.forEach((child) => {
            if (child) {
                let skipCheck = false;

                if (!compliant) {
                    switch (node.nodeType) {
                        case ParseNodeType.Assignment:
                            // There are a few exceptions we need to deal with here. Comment
                            // annotations can occur outside of an assignment node's range.
                            if (child === node.d.annotationComment) {
                                skipCheck = true;
                            }

                            // Portions of chained assignments can occur outside of an
                            // assignment node's range.
                            if (child.nodeType === ParseNodeType.Assignment) {
                                skipCheck = true;
                            }
                            break;

                        case ParseNodeType.StringList:
                            if (child === node.d.annotation) {
                                skipCheck = true;
                            }
                            break;

                        case ParseNodeType.Argument: {
                            if (node.d.isNameSameAsValue) {
                                skipCheck = true;
                            }
                            break;
                        }

                        default:
                            fail(`node ${node.nodeType} is not marked as not following range rules.`);
                    }
                }

                if (!skipCheck) {
                    // Make sure the child is contained within the parent.
                    if (child.start < node.start || TextRange.getEnd(child) > TextRange.getEnd(node)) {
                        fail(`Child node ${child.nodeType} is not contained within its parent ${node.nodeType}`);
                    }

                    if (prevNode) {
                        // Make sure the child is after the previous child.
                        if (child.start < TextRange.getEnd(prevNode)) {
                            // Special-case the function annotation which can "bleed" into the suite.
                            let exempted = prevNode.nodeType === ParseNodeType.FunctionAnnotation;

                            // Special-case name nodes that are part of an argument node that's
                            // using a keyword argument shortcut.
                            if (node.nodeType === ParseNodeType.Argument && node.d.isNameSameAsValue) {
                                exempted = true;
                            }

                            if (!exempted) {
                                fail(`Child node is not after previous child node`);
                            }
                        }
                    }

                    prevNode = child;
                }
            }
        });
    }
}

// Custom parse node walker that evaluates the types of all
// NameNodes. This helps find bugs in evaluation ordering.
export class NameTypeWalker extends ParseTreeWalker {
    constructor(private _evaluator: TypeEvaluator) {
        super();
    }

    override visitName(node: NameNode) {
        if (node.parent?.nodeType !== ParseNodeType.ImportFromAs && node.parent?.nodeType !== ParseNodeType.ImportAs) {
            if (this._evaluator.isNodeReachable(node, /* sourceNode */ undefined)) {
                this._evaluator.getType(node);
            }
        }
        return true;
    }
}
