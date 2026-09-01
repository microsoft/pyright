/// <reference types="jest" />

/*
 * wildcardImportPackageMerge.test.ts
 *
 * Regression coverage for multipart package members that survive wildcard-import merges.
 */

import { CompletionItemKind, MarkupKind } from 'vscode-languageserver-types';

import { DefinitionFilter } from '../languageService/definitionProvider';
import { parseAndGetTestState } from './harness/fourslash/testState';
import { verifyReferencesAtPosition } from './testStateUtils';

const wildcardImportPackageMergeCode = `
// @filename: mylib/__init__.py
////

// @filename: mylib/a.py
//// [|/*defA*/|]# module a
//// def do_something(value: str) -> None:
////     pass

// @filename: mylib/b.py
//// [|/*defB*/|]# module b
//// def do_other() -> None:
////     pass

// @filename: my_common_stuffs.py
//// import mylib.[|/*importB*/b|]
//// BLA = '123'

// @filename: test.py
//// import mylib.[|/*importA*/a|]
////
//// from my_common_stuffs import *
////
//// mylib.[|/*markerA*/a|].do_something(BLA)
//// mylib.[|/*markerB*/b|].do_other()
//// mylib./*completionMarker*/
`;

function createState() {
    return parseAndGetTestState(wildcardImportPackageMergeCode).state;
}

function getExpectedDefinition(state: ReturnType<typeof createState>, markerName: string) {
    return {
        path: state.getMarkerByName(markerName).fileName,
        range: state.getPositionRange(markerName),
    };
}

test('wildcard import package merge - go to definition for sibling modules', () => {
    const state = createState();

    state.verifyFindDefinitions(
        {
            markerA: {
                definitions: [getExpectedDefinition(state, 'defA')],
            },
            markerB: {
                definitions: [getExpectedDefinition(state, 'defB')],
            },
        },
        DefinitionFilter.PreferSource
    );
});

test('wildcard import package merge - hover for sibling modules', () => {
    const state = createState();
    const marker = state.getMarkerByName('markerA');
    state.openFile(marker.fileName);

    state.verifyHover('markdown', {
        markerA: '```python\n(module) a\n```',
        markerB: '```python\n(module) b\n```',
    });
});

test('wildcard import package merge - completion exposes sibling modules', async () => {
    const state = createState();
    const marker = state.getMarkerByName('completionMarker');
    state.openFile(marker.fileName);

    await state.verifyCompletion('included', MarkupKind.Markdown, {
        completionMarker: {
            completions: [
                {
                    kind: CompletionItemKind.Module,
                    label: 'a',
                },
                {
                    kind: CompletionItemKind.Module,
                    label: 'b',
                },
            ],
        },
    });
});

test('wildcard import package merge - find references for sibling modules', () => {
    const state = createState();

    for (const symbolName of ['a', 'b']) {
        const ranges = state.getRangesByText().get(symbolName)!;
        for (const range of ranges) {
            verifyReferencesAtPosition(
                state.program,
                state.configOptions,
                symbolName,
                range.fileName,
                range.pos,
                ranges
            );
        }
    }
});
