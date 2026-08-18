/*
 * stringUtils.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import * as assert from 'assert';

import * as core from '../common/core';
import * as utils from '../common/stringUtils';

test('string fingerprint preserves the legacy hash and separates known collisions', () => {
    const values = ['', 'plain text', '\0', '😀', 'value_Aa = 1\n', 'value_BB = 1\n'];

    for (const value of values) {
        assert.equal(utils.getStringFingerprint(value).primary, utils.hashString(value));
    }

    const first = utils.getStringFingerprint('value_Aa = 1\n');
    const second = utils.getStringFingerprint('value_BB = 1\n');
    const equalValue = { ...first };
    assert.equal(first.primary, second.primary);
    assert.notEqual(first.secondary, second.secondary);
    assert.notStrictEqual(equalValue, first);
    assert.equal(utils.areStringFingerprintsEqual(first, first), true);
    assert.equal(utils.areStringFingerprintsEqual(first, equalValue), true);
    assert.equal(utils.areStringFingerprintsEqual(first, second), false);
    assert.equal(utils.areStringFingerprintsEqual(first, { ...first, primary: first.primary + 1 }), false);
    assert.equal(utils.areStringFingerprintsEqual(first, { ...first, secondary: first.secondary + 1 }), false);
});

test('stringUtils isPatternInSymbol', () => {
    assert.equal(utils.isPatternInSymbol('', 'abcd'), true);

    assert.equal(utils.isPatternInSymbol('abcd', 'abcd'), true);
    assert.equal(utils.isPatternInSymbol('abc', 'abcd'), true);

    assert.equal(utils.isPatternInSymbol('ABCD', 'abcd'), true);
    assert.equal(utils.isPatternInSymbol('ABC', 'abcd'), true);

    assert.equal(utils.isPatternInSymbol('acbd', 'abcd'), false);
    assert.equal(utils.isPatternInSymbol('abce', 'abcd'), false);
    assert.equal(utils.isPatternInSymbol('abcde', 'abcd'), false);
    assert.equal(utils.isPatternInSymbol('azcde', 'abcd'), false);
    assert.equal(utils.isPatternInSymbol('acde', 'abcd'), false);
    assert.equal(utils.isPatternInSymbol('zbcd', 'abcd'), false);

    // A typed value longer than the symbol can never match (the loop exhausts the
    // symbol before consuming all typed characters).
    assert.equal(utils.isPatternInSymbol('abcd', 'abc'), false);
});

test('stringUtils isPatternInSymbol unicode/locale parity', () => {
    // The fast path folds case for the Latin-1 range; verify it still matches the
    // locale-aware original behavior for accented Latin-1 letters.
    assert.equal(utils.isPatternInSymbol('café', 'CAFÉ'), true);
    assert.equal(utils.isPatternInSymbol('é', 'CAFÉ'), true);
    assert.equal(utils.isPatternInSymbol('É', 'e'), false);

    // Characters whose toLocaleLowerCase() changes length must go through the
    // full-string fallback. Turkish dotted capital I (U+0130) lower-cases to two
    // code units ("i" + combining dot), so these must match the original exactly.
    assert.equal(utils.isPatternInSymbol('İ', 'I'), false);
    assert.equal(utils.isPatternInSymbol('İ', 'i'), false);
    assert.equal(utils.isPatternInSymbol('istanbul', 'İstanbul'), true);

    // A typed value that is longer in code units than the symbol can still match
    // once both are lower-cased, because İ (U+0130) lower-cases to two code units
    // ("i" + U+0307 combining dot). Typing that exact 2-unit sequence must match a
    // symbol of "İ". This is the case a raw pre-lowercase length check would break.
    assert.equal(utils.isPatternInSymbol('i\u0307', 'İ'), true);
    assert.equal(utils.isPatternInSymbol('i\u0307', 'i'), false);

    // Directly assert parity with the original toLocaleLowerCase-based algorithm
    // over a spread of tricky inputs (ASCII, Latin-1, ligatures, ß, non-Latin-1),
    // so any future edit that breaks exact behavior is caught here.
    const reference = (typedValue: string, symbolName: string): boolean => {
        const typedLower = typedValue.toLocaleLowerCase();
        const symbolLower = symbolName.toLocaleLowerCase();
        let typedPos = 0;
        let symbolPos = 0;
        while (typedPos < typedLower.length && symbolPos < symbolLower.length) {
            if (typedLower[typedPos] === symbolLower[symbolPos]) {
                typedPos += 1;
            }
            symbolPos += 1;
        }
        return typedPos === typedLower.length;
    };

    const tokens = [
        '',
        'a',
        'A',
        'abc',
        'ABC',
        'aXbYc',
        'café',
        'CAFÉ',
        'É',
        'straße',
        'STRASSE',
        'İ',
        'I',
        'i',
        'ı',
        'i\u0307',
        'İstanbul',
        'istanbul',
        'ﬁle',
        'file',
        'µm',
        'MM',
    ];
    for (const typed of tokens) {
        for (const symbol of tokens) {
            assert.equal(
                utils.isPatternInSymbol(typed, symbol),
                reference(typed, symbol),
                `mismatch for typed=${JSON.stringify(typed)} symbol=${JSON.stringify(symbol)}`
            );
        }
    }
});

test('CoreCompareStringsCaseInsensitive1', () => {
    assert.equal(utils.compareStringsCaseInsensitive('Hello', 'hello'), core.Comparison.EqualTo);
});

test('CoreCompareStringsCaseInsensitive2', () => {
    assert.equal(utils.compareStringsCaseInsensitive('Hello', undefined), core.Comparison.GreaterThan);
});

test('CoreCompareStringsCaseInsensitive3', () => {
    assert.equal(utils.compareStringsCaseInsensitive(undefined, 'hello'), core.Comparison.LessThan);
});

test('CoreCompareStringsCaseInsensitive4', () => {
    assert.equal(utils.compareStringsCaseInsensitive(undefined, undefined), core.Comparison.EqualTo);
});

test('CoreCompareStringsCaseSensitive', () => {
    assert.equal(utils.compareStringsCaseSensitive('Hello', 'hello'), core.Comparison.LessThan);
});
