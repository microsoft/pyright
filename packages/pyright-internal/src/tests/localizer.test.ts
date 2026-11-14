/*
 * localizer.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Unit tests for localizer module, including default localized strings.
 */

import * as assert from 'assert';

import { LocMessage, Localizer, ParameterizedString, setGetRawString } from '../localization/localize';

const namespaces = [Localizer.Diagnostic, Localizer.DiagnosticAddendum, Localizer.CodeAction];

test.each(['a$&b', 'a$$b', 'a$`b', "a$'b", 'a$b', '$5', 'plain', ''])(
    'Parameterized strings preserve parameter value %j',
    (value) => {
        const message = new ParameterizedString<{ value: string }>('before {value}, {value} after');

        assert.strictEqual(message.format({ value }), `before ${value}, ${value} after`);
    }
);

test('Parameterized strings format multiple parameters', () => {
    const message = new ParameterizedString<{ source: string; dest: string }>(
        'Type {source} is not assignable to {dest}'
    );

    assert.strictEqual(message.format({ source: 'a$&b', dest: 'a$$b' }), 'Type a$&b is not assignable to a$$b');
});

test('Parameterized strings preserve existing formatting behavior', () => {
    const message = new ParameterizedString<{ count: number; value: string; unused: string }>(
        '{count}: {value}, {value}; {missing}'
    );

    assert.strictEqual(message.format({ count: 0, value: 'plain', unused: 'ignored' }), '0: plain, plain; {missing}');
    assert.strictEqual(message.format({ count: 2, value: '', unused: 'ignored' }), '2: , ; {missing}');
    assert.strictEqual(message.getFormatString(), '{count}: {value}, {value}; {missing}');
});

test('Parameterized strings convert each parameter to a string once', () => {
    let calls = 0;
    const value = {
        toString: () => `${++calls}`,
    };
    const message = new ParameterizedString<{ value: typeof value }>('{value}, {value}');

    assert.strictEqual(message.format({ value }), '1, 1');
    assert.strictEqual(calls, 1);
});

test('Raw strings present', () => {
    // Allocate a map so we can detect duplicate strings. This is
    // an indication that the string key (e.g. 'DiagnosticAddendum.useDictInstead')
    // used to fetch the localized string is a duplicate of another string key.
    const stringContentMap = new Map<string, string>();

    namespaces.forEach((namespace) => {
        Object.keys(namespace).forEach((key) => {
            const value = (namespace as any)[key]();
            let formatString: string;

            if (value === undefined) {
                assert.fail(`Default value for localized string "${key}" is missing`);
            } else if (typeof value === 'string') {
                formatString = value;
            } else if (value instanceof ParameterizedString) {
                formatString = value.getFormatString();
                if (!formatString) {
                    assert.fail(`Format string for localized string "${key}" is missing`);
                }
            } else {
                assert.fail(`Default value for localized string "${key}" is unexpected type`);
            }

            if (stringContentMap.has(formatString)) {
                assert.fail(`Localized string for "${key}" is duplicate of ${stringContentMap.get(formatString)}`);
            }

            stringContentMap.set(formatString, key);
        });
    });
});

test('Override a specific string', () => {
    // eslint-disable-next-line prefer-const
    let originalRawString: ((key: string) => string) | undefined;
    function overrideImportResolve(key: string): string {
        if (key === 'Diagnostic.importResolveFailure') {
            return 'Import is {importName}';
        }
        return originalRawString!(key);
    }
    originalRawString = setGetRawString(overrideImportResolve);

    const value = LocMessage.importResolveFailure().format({ importName: 'foo', venv: 'python' });

    try {
        assert.equal(value, 'Import is foo');
        const nonMovedValue = LocMessage.abstractMethodInvocation().format({ method: 'foo' });
        assert.equal(nonMovedValue, 'Method "foo" cannot be called because it is abstract and unimplemented');
    } finally {
        setGetRawString(originalRawString);
    }
});
