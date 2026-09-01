/*
 * docStringReturnExtraction.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Tests for extractReturnDocumentation, which pulls the return-value description
 * out of a function docstring (reST, Epytext, and Google styles).
 */

import assert = require('assert');

import { extractReturnDocumentation } from '../analyzer/docStringUtils';

describe('extractReturnDocumentation', () => {
    test('reST :returns: (plural)', () => {
        const doc = `Compute a value.

:returns: The computed integer value.`;
        assert.strictEqual(extractReturnDocumentation(doc), 'The computed integer value.');
    });

    test('reST :return: (singular)', () => {
        const doc = `Compute a value.

:return: The computed integer value.`;
        assert.strictEqual(extractReturnDocumentation(doc), 'The computed integer value.');
    });

    test('Epytext @returns: (plural)', () => {
        const doc = `Compute a value.

@returns: The computed integer value.`;
        assert.strictEqual(extractReturnDocumentation(doc), 'The computed integer value.');
    });

    test('Epytext @return (singular, no colon)', () => {
        const doc = `Compute a value.

@return The computed integer value.`;
        assert.strictEqual(extractReturnDocumentation(doc), 'The computed integer value.');
    });

    test('Epytext @returns:description (no space after colon)', () => {
        // Mirrors reST: a missing space after the colon must still extract the description.
        const doc = `Compute a value.

@returns:The computed integer value.`;
        assert.strictEqual(extractReturnDocumentation(doc), 'The computed integer value.');
    });

    test('Google Returns: single line', () => {
        const doc = `Compute a value.

Returns:
    The computed integer value.`;
        assert.strictEqual(extractReturnDocumentation(doc), 'The computed integer value.');
    });

    test('Google Returns: multi-line stops at next section (dedent)', () => {
        const doc = `Compute a value.

Returns:
    The computed integer value.
    Spanning two lines.
Raises:
    ValueError: if the value is bad.`;
        assert.strictEqual(extractReturnDocumentation(doc), 'The computed integer value.\nSpanning two lines.');
    });

    test('Google Returns: multi-line stops at blank line after collecting', () => {
        const doc = `Compute a value.

Returns:
    The computed integer value.
    Spanning two lines.

Some trailing prose that is not part of the return section.`;
        assert.strictEqual(extractReturnDocumentation(doc), 'The computed integer value.\nSpanning two lines.');
    });

    test('Google Returns: type: description form', () => {
        const doc = `Compute a value.

Returns:
    int: The computed integer value.`;
        assert.strictEqual(extractReturnDocumentation(doc), 'int: The computed integer value.');
    });

    test('Google Return: (singular header)', () => {
        const doc = `Compute a value.

Return:
    The computed integer value.`;
        assert.strictEqual(extractReturnDocumentation(doc), 'The computed integer value.');
    });

    test('reST empty :returns: yields undefined', () => {
        const doc = `Compute a value.

:returns:`;
        assert.strictEqual(extractReturnDocumentation(doc), undefined);
    });

    test('Google Returns: with no indented body yields undefined', () => {
        const doc = `Compute a value.

Returns:
Raises:
    ValueError: if the value is bad.`;
        assert.strictEqual(extractReturnDocumentation(doc), undefined);
    });

    test('no return section yields undefined', () => {
        const doc = `Compute a value.

Args:
    x: the input.`;
        assert.strictEqual(extractReturnDocumentation(doc), undefined);
    });

    test('Google Returns: header on the first physical line', () => {
        // The "Returns:" header sits on the docstring's first physical line, so its indentation
        // must still be recovered correctly even though the first line is special-cased during
        // docstring cleanup.
        const doc = `Returns:
    The computed integer value.`;
        assert.strictEqual(extractReturnDocumentation(doc), 'The computed integer value.');
    });

    test('Google Returns: header on the first physical line, multi-line body', () => {
        const doc = `Returns:
    The computed integer value.
    Spanning two lines.`;
        assert.strictEqual(extractReturnDocumentation(doc), 'The computed integer value.\nSpanning two lines.');
    });

    test('empty docstring yields undefined', () => {
        assert.strictEqual(extractReturnDocumentation(''), undefined);
    });
});
