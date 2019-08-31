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
import { Type } from './types';
import { TypeUtils } from './typeUtils';

export class TypeConstraintUtils {
    // Combines two type constraint lists that come from multiple
    // conditional scopes (e.g. an if/else scope pair). For expressions
    // that are common to all lists, it combines them. For expressions
    // that are not common to all lists, it marks them as conditional.
    static combineTypeConstraints(tcLists: TypeConstraint[][]): TypeConstraint[] {
        const combinedList: TypeConstraint[] = [];

        // Start by deduping the lists.
        const dedupedLists = tcLists.map(tcList => this.dedupeTypeConstraints(tcList));

        for (let listIndex = 0; listIndex < tcLists.length; listIndex++) {
            while (dedupedLists[listIndex].length > 0) {
                const tc = dedupedLists[listIndex][0];
                const expression = tc.getExpression();
                const typesToCombine: Type[] = [];
                let isConditional = false;

                const splits = dedupedLists.map(list => this._splitList(list, expression));
                for (let splitIndex = 0; splitIndex < splits.length; splitIndex++) {
                    // Write back the remaining list (those that don't target this expression).
                    dedupedLists[splitIndex] = splits[splitIndex][1];

                    // Since the lists were deduped, we should have found at most one
                    // TC that matched this expression. Get its type.
                    assert(splits[splitIndex][0].length <= 1);
                    if (splits[splitIndex][0].length > 0) {
                        typesToCombine.push(splits[splitIndex][0][0].getType());
                        if (splits[splitIndex][0][0].isConditional()) {
                            isConditional = true;
                        }
                    } else {
                        // If one of the lists didn't contribute a type for this
                        // expression, mark it conditional.
                        isConditional = true;
                    }
                }

                const combinedTc = new TypeConstraint(expression,
                    TypeUtils.combineTypes(typesToCombine));

                if (isConditional) {
                    combinedTc.setIsConditional();
                }

                combinedList.push(combinedTc);
            }
        }

        return combinedList;
    }

    // Given a list of type constraints, it deduplicates the list, combining any
    // type constraints that apply to the same expression. For unconditional
    // type constraints, later constraints replace earlier. For conditional type
    // constraints, they are combined.
    static dedupeTypeConstraints(tcList: TypeConstraint[], markConditional = false): TypeConstraint[] {
        let remainingList = tcList;
        const dedupedList: TypeConstraint[] = [];

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
