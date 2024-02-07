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
