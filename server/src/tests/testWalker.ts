/*
* testWalker.ts
*
* Walks a parse tree to validate internal consistency and completeness.
*/

import * as assert from 'assert';

import { ParseTreeWalker } from '../analyzer/parseTreeWalker';
import { AssignmentNode, ParseNode } from '../parser/parseNodes';

export class TestWalker extends ParseTreeWalker {
    constructor() {
        super();
    }

    visitNode(node: ParseNode): boolean {
        let children = this.getChildren(node);
        this._verifyParentChildLinks(node, children);
        this._verifyChildRanges(node, children);

        return super.visitNode(node);
    }

    // Make sure that all of the children point to their parent.
    private _verifyParentChildLinks(node: ParseNode, children: ParseNode[]) {
        children.forEach(child => {
            assert.equal(child.parent, node);
        });
    }

    // Verify that:
    //      Children are all contained within the parent
    //      Children have non-overlapping ranges
    //      Children are listed in increasing order
    private _verifyChildRanges(node: ParseNode, children: ParseNode[]) {
        let prevNode: ParseNode | undefined;

        children.forEach(child => {
            let skipCheck = false;

            // There's an exception we need to deal with here. Comment
            // annotations can occur outside of an assignment node's range.
            if (node instanceof AssignmentNode) {
                if (child === node.typeAnnotationComment) {
                    skipCheck = true;
                }
            }

            if (!skipCheck) {
                // Make sure the child is contained within the parent.
                assert(child.start >= node.start && child.end <= node.end);
                if (prevNode) {
                    // Make sure the child is after the previous child.
                    assert(child.start >= prevNode.end);
                }

                prevNode = child;
            }
        });
    }
}
