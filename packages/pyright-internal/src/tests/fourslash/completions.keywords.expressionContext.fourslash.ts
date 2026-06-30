/// <reference path="typings/fourslash.d.ts" />

// Statement-only keywords (e.g. `raise`, `return`) should be suppressed in
// slots that can only contain an expression, while still being offered at the
// start of a statement. Expression-valid keywords (e.g. `lambda`) must keep
// appearing in expression slots.

// @filename: stmtStart.py
//// def func():
////     re[|/*stmtStart*/|]

// @filename: forIterable.py
//// for item in ra[|/*forIterable*/|]

// @filename: forIterableExprKeyword.py
//// for item in la[|/*forIterableExprKeyword*/|]

// @filename: assignRhs.py
//// x = re[|/*assignRhs*/|]

// @filename: assignRhsExprKeyword.py
//// x = la[|/*assignRhsExprKeyword*/|]

// @filename: walrusRhs.py
//// if (n := re[|/*walrusRhs*/|]):
////     pass

// @filename: comprehensionIterable.py
//// z = [i for i in re[|/*comprehensionIterable*/|]]

// @filename: callArg.py
//// print(re[|/*callArg*/|])

// @filename: subscript.py
//// data = [1, 2]
//// w = data[re[|/*subscript*/|]]

// @filename: returnValue.py
//// def func():
////     return ra[|/*returnValue*/|]

// @filename: whileCondition.py
//// while re[|/*whileCondition*/|]:
////     pass

// @filename: ifCondition.py
//// if re[|/*ifCondition*/|]:
////     pass

{
    helper.openFiles(helper.getMarkers().map((m) => m.fileName));

    // Statement-only keywords are still offered at statement start, and
    // expression-valid keywords are still offered in expression slots.
    // @ts-ignore
    await helper.verifyCompletion('included', 'markdown', {
        stmtStart: {
            completions: [{ label: 'return', kind: Consts.CompletionItemKind.Keyword }],
        },
        forIterableExprKeyword: {
            completions: [{ label: 'lambda', kind: Consts.CompletionItemKind.Keyword }],
        },
        assignRhsExprKeyword: {
            completions: [{ label: 'lambda', kind: Consts.CompletionItemKind.Keyword }],
        },
    });

    // Statement-only keywords are suppressed in expression-only slots.
    // @ts-ignore
    await helper.verifyCompletion('excluded', 'markdown', {
        forIterable: {
            completions: [{ label: 'raise', kind: Consts.CompletionItemKind.Keyword }],
        },
        assignRhs: {
            completions: [{ label: 'return', kind: Consts.CompletionItemKind.Keyword }],
        },
        walrusRhs: {
            completions: [{ label: 'return', kind: Consts.CompletionItemKind.Keyword }],
        },
        comprehensionIterable: {
            completions: [{ label: 'return', kind: Consts.CompletionItemKind.Keyword }],
        },
        callArg: {
            completions: [{ label: 'return', kind: Consts.CompletionItemKind.Keyword }],
        },
        subscript: {
            completions: [{ label: 'return', kind: Consts.CompletionItemKind.Keyword }],
        },
        returnValue: {
            completions: [{ label: 'raise', kind: Consts.CompletionItemKind.Keyword }],
        },
        whileCondition: {
            completions: [{ label: 'return', kind: Consts.CompletionItemKind.Keyword }],
        },
        ifCondition: {
            completions: [{ label: 'return', kind: Consts.CompletionItemKind.Keyword }],
        },
    });
}
