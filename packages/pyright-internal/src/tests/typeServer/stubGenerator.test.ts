/*
 * stubGenerator.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import { isClass } from '../../analyzer/types';
import { isExpressionNode } from '../../parser/parseNodes';
import { generateStubFromClassType } from '../../typeServer/stubGenerator';
import { ITypeServerEvaluator } from '../../typeServer/typeServerEvaluator';
import { getNodeAtMarker, parseAndGetTestState } from '../harness/fourslash/testState';

test('Generate stub for synthesized class with an internal intersection name', () => {
    const code = `
// @filename: test.py
//// class RegularBase:
////     value: int
//// class SynthesizedBase:
////     name: str
//// class OtherBase:
////     other: bool
//// class /*marker*/Derived(RegularBase, SynthesizedBase, OtherBase):
////     pass
`;

    const state = parseAndGetTestState(code).state;
    state.program.analyze();

    const evaluator = state.program.evaluator;
    const node = getNodeAtMarker(state);
    const type = isExpressionNode(node) ? evaluator?.getType(node) : undefined;
    if (!evaluator || !type || !isClass(type)) {
        throw new Error('Expected marker to point to a class');
    }

    const synthesizedBase = type.shared.baseClasses.find(
        (base) => isClass(base) && base.shared.name === 'SynthesizedBase'
    );
    if (!synthesizedBase || !isClass(synthesizedBase)) {
        throw new Error('Expected to find SynthesizedBase');
    }
    const otherBase = type.shared.baseClasses.find((base) => isClass(base) && base.shared.name === 'OtherBase');
    if (!otherBase || !isClass(otherBase)) {
        throw new Error('Expected to find OtherBase');
    }

    const originalName = synthesizedBase.shared.name;
    const originalDeclaration = synthesizedBase.shared.declaration;
    const otherOriginalName = otherBase.shared.name;
    const otherOriginalDeclaration = otherBase.shared.declaration;
    synthesizedBase.shared.name = '<A-B>';
    synthesizedBase.shared.declaration = undefined;
    otherBase.shared.name = '<A B>';
    otherBase.shared.declaration = undefined;

    try {
        const typeServerEvaluator = Object.assign(Object.create(evaluator), {
            getSymbolLookup: () => {
                throw new Error('Symbol lookup should not be needed to generate this stub');
            },
        }) as ITypeServerEvaluator;
        const result = generateStubFromClassType(typeServerEvaluator, synthesizedBase, {
            pythonVersion: state.configOptions.getDefaultExecEnvironment().pythonVersion,
        });

        expect(result.stubContent).toContain('class _A_B_:');
        expect(result.stubContent.slice(result.primaryDefinitionOffset)).toMatch(/^class _A_B_:/);

        const derivedResult = generateStubFromClassType(typeServerEvaluator, type, {
            pythonVersion: state.configOptions.getDefaultExecEnvironment().pythonVersion,
        });
        expect(derivedResult.stubContent).toContain('class _A_B_:');
        expect(derivedResult.stubContent).toContain('class _A_B__2:');
        expect(derivedResult.stubContent).toContain('class Derived(test.RegularBase, _A_B_, _A_B__2):');
    } finally {
        synthesizedBase.shared.name = originalName;
        synthesizedBase.shared.declaration = originalDeclaration;
        otherBase.shared.name = otherOriginalName;
        otherBase.shared.declaration = otherOriginalDeclaration;
    }
});
