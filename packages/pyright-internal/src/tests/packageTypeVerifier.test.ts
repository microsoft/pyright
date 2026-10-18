/*
 * packageTypeVerifier.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 */

import assert from 'assert';

import { TypeKnownStatus } from '../analyzer/packageTypeReport';
import { PackageTypeVerifier } from '../analyzer/packageTypeVerifier';
import { CommandLineOptions } from '../common/commandLineOptions';
import { DiagnosticCategory } from '../common/diagnostic';
import { UriEx } from '../common/uri/uriUtils';
import { parseAndGetTestState } from './harness/fourslash/testState';
import { TestAccessHost } from './harness/testAccessHost';
import { libFolder } from './harness/vfs/factory';
import { MODULE_PATH } from './harness/vfs/filesystem';

describe('Package type verifier', () => {
    test.each([false, true])('unresolved external submodules (ignoreExternal=%s)', (ignoreExternal) => {
        const code = `
// @filename: test_pkg/py.typed
// @library: true
////

// @filename: test_pkg/__init__.pyi
// @library: true
//// from missing_external.engine import Connectable
//// import missing_external.engine
//// import missing_external.engine.connection
//// import missing_external.engine as engine_alias
//// import installed_external.missing
//// from ._internal import Internal
////
//// def direct(value: str | Connectable) -> None: ...
//// def qualified(value: str | missing_external.engine.Connectable) -> None: ...
//// def nested(value: missing_external.engine.connection.Connectable) -> None: ...
//// def alias(value: engine_alias.Connectable) -> None: ...
//// def missing_child(value: installed_external.missing.Connectable) -> None: ...
//// def known(value: int) -> str: ...
//// def unannotated(value) -> None: ...
//// def internal(value: Internal) -> None: ...

// @filename: test_pkg/_internal.pyi
// @library: true
//// class Internal:
////     def method(self, value) -> None: ...

// @filename: installed_external/__init__.pyi
// @library: true
////
        `;

        const state = parseAndGetTestState(code).state;
        const host = new TestAccessHost(UriEx.file(MODULE_PATH), [libFolder]);
        const options = new CommandLineOptions('/', /* fromLanguageServer */ false);
        const report = new PackageTypeVerifier(
            state.serviceProvider,
            host,
            options,
            'test_pkg',
            ignoreExternal
        ).verify();

        assert.deepStrictEqual(report.generalDiagnostics, []);

        for (const name of ['direct', 'qualified', 'nested', 'alias', 'missing_child']) {
            const symbol = report.symbols.get(`test_pkg.${name}`);
            assert(symbol, name);
            assert.strictEqual(
                symbol.typeKnownStatus,
                ignoreExternal ? TypeKnownStatus.Known : TypeKnownStatus.Unknown,
                name
            );
            const errors = symbol.diagnostics.filter((diag) => diag.diagnostic.category === DiagnosticCategory.Error);
            assert.strictEqual(errors.length, ignoreExternal ? 0 : 1, name);
        }

        assert.strictEqual(report.symbols.get('test_pkg.known')?.typeKnownStatus, TypeKnownStatus.Known);
        assert.strictEqual(report.symbols.get('test_pkg.unannotated')?.typeKnownStatus, TypeKnownStatus.Unknown);
        assert.strictEqual(report.symbols.get('test_pkg.internal')?.typeKnownStatus, TypeKnownStatus.Unknown);
    });
});
