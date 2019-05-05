/*
* typeConstraintUtils.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Utility functions that act upon type constraint objects.
*/

import * as assert from 'assert';

import { ExpressionNode } from '../parser/parseNodes';
import { TypeConstraint } from './typeConstraint';
import { TypeUtils } from './typeUtils';

export class TypeConstraintUtils {
    // Combines two type constraint lists that come from two paired
    // conditional scopes (e.g. an if/else scope pair). For expressions
    // that are common, it combines the two. For expressions that are
    // unique, it marks them as conditional.

    static combineTypeConstraints(tcList1: TypeConstraint[], tcList2: TypeConstraint[]): TypeConstraint[] {
        // Start by deduping the two lists.
        let dedupedList1 = this.dedupeTypeConstraints(tcList1);
        let dedupedList2 = this.dedupeTypeConstraints(tcList2);

        const combinedList: TypeConstraint[] = [];

        for (const tc of dedupedList1) {
            const expression = tc.getExpression();
            const [inList, outList] = this._splitList(dedupedList2, expression);
            assert(inList.length <= 1);

            if (inList.length > 0) {
                const types = [inList[0].getType(), tc.getType()];
                const combinedTc = new TypeConstraint(expression, TypeUtils.combineTypes(types));

                // If either of the two contributing TCs was conditional, the
                // resulting TC is as well.
                if (inList[0].isConditional() || tc.isConditional()) {
                    combinedTc.setIsConditional();
                }

                combinedList.push(combinedTc);
            } else {
                tc.setIsConditional();
                combinedList.push(tc);
            }

            dedupedList2 = outList;
        }

        // Handle the remaining items on the second list that were not
        // also found on the first list.
        for (const tc of dedupedList2) {
            tc.setIsConditional();
            combinedList.push(tc);
        }

        return combinedList;
    }

    // Given a list of type constraints, it deduplicates the list, combining any
    // type constraints that apply to the same expression. For unconditional
    // type constraints, later constraints replace earlier. For conditional type
    // constraints, they are combined.
    static dedupeTypeConstraints(tcList: TypeConstraint[], markConditional = false): TypeConstraint[] {
        let remainingList = tcList;
        let dedupedList: TypeConstraint[] = [];

        while (remainingList.length > 0) {
            const expression = remainingList[0].getExpression();
            const [inList, outList] = this._splitList(remainingList, expression);

            assert(inList.length > 0);

            let combinedTc = inList[0];
            let hitUnconditionalTc = !combinedTc.isConditional();

            inList.forEach((tc, index) => {
                if (index > 0) {
                    if (!tc.isConditional()) {
                        combinedTc = tc;
                        hitUnconditionalTc = true;
                    } else {
                        const types = [combinedTc.getType(), tc.getType()];
                        combinedTc = new TypeConstraint(expression, TypeUtils.combineTypes(types));
                    }
                }
            });

            if (markConditional || !hitUnconditionalTc) {
                combinedTc.setIsConditional();
            }

            dedupedList.push(combinedTc);
            remainingList = outList;
        }

        return dedupedList;
    }

    // Splits a list into a tuple of two lists. The first contains all of the
    // type constraints associated with a particular expression. The second
    // contains the remainder.
    private static _splitList(tcList: TypeConstraint[], expression: ExpressionNode): [TypeConstraint[], TypeConstraint[]] {
        const inList: TypeConstraint[] = [];
        const outList: TypeConstraint[] = [];

        for (const tc of tcList) {
            if (tc.doesExpressionMatch(expression)) {
                inList.push(tc);
            } else {
                outList.push(tc);
            }
        }

        return [inList, outList];
    }
}
