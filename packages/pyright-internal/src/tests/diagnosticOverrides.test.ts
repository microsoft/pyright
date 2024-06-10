/*
 * diagnosticOverrides.test.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Tests to verify consistency between declarations of diagnostic
 * overrides in code and in the configuration schema.
 */

import * as fs from 'fs';
import * as path from 'path';

import { DiagnosticRule } from '../common/diagnosticRules';

describe('Diagnostic overrides', () => {
    test('Compare DiagnosticRule to pyrightconfig.schema.json', () => {
        const schemasFolder = path.resolve(__dirname, '..', '..', '..', 'vscode-pyright', 'schemas');
        const schemaJson = path.join(schemasFolder, 'pyrightconfig.schema.json');
        const jsonString = fs.readFileSync(schemaJson, { encoding: 'utf-8' });
        const json = JSON.parse(jsonString);

        expect(json.definitions?.diagnostic?.anyOf).toBeDefined();
        const anyOf = json.definitions?.diagnostic?.anyOf;

        expect(Array.isArray(anyOf));
        expect(anyOf).toHaveLength(2);

        expect(anyOf[0].type).toEqual('boolean');
        expect(anyOf[1].type).toEqual('string');

        const enumValues = anyOf[1].enum;
        expect(Array.isArray(enumValues));
        expect(enumValues).toHaveLength(4);
        expect(enumValues[0]).toEqual('none');
        expect(enumValues[1]).toEqual('information');
        expect(enumValues[2]).toEqual('warning');
        expect(enumValues[3]).toEqual('error');

        expect(json.properties).toBeDefined();
        const overrideNamesInJson = Object.keys(json.properties).filter((n) => n.startsWith('report'));

        for (const propName of overrideNamesInJson) {
            const p = json.properties[propName];

            const ref = p['$ref'];
            const def = json.definitions[ref.substring(ref.lastIndexOf('/') + 1)];

            expect(def['$ref']).toEqual(`#/definitions/diagnostic`);
            expect(def.title).toBeDefined();
            expect(def.title.length).toBeGreaterThan(0);
            expect(def.default).toBeDefined();
            expect(enumValues).toContain(def.default);
        }

        const overrideNamesInCode: string[] = Object.values(DiagnosticRule).filter((x) => x.startsWith('report'));

        for (const n of overrideNamesInJson) {
            expect(overrideNamesInCode).toContain(n);
        }
        for (const n of overrideNamesInCode) {
            expect(overrideNamesInJson).toContain(n);
        }
    });
    test('Compare DiagnosticRule to package.json', () => {
        const extensionRoot = path.resolve(__dirname, '..', '..', '..', 'vscode-pyright');
        const packageJson = path.join(extensionRoot, 'package.json');
        const jsonString = fs.readFileSync(packageJson, { encoding: 'utf-8' });
        const json = JSON.parse(jsonString);

        expect(json.contributes?.configuration?.properties).toBeDefined();
        const overrides = json.contributes?.configuration?.properties['python.analysis.diagnosticSeverityOverrides'];
        expect(overrides).toBeDefined();
        const props = overrides.properties;
        expect(props).toBeDefined();

        const overrideNamesInJson = Object.keys(props);
        for (const propName of overrideNamesInJson) {
            const p = props[propName];

            expect(p.type).toEqual(['string', 'boolean']);
            expect(p.description).toBeDefined();
            expect(p.description.length).toBeGreaterThan(0);
            expect(p.default).toBeDefined();

            expect(p.enum).toBeDefined();
            expect(Array.isArray(p.enum));
            expect(p.enum).toHaveLength(6);

            expect(p.enum[0]).toEqual('none');
            expect(p.enum[1]).toEqual('information');
            expect(p.enum[2]).toEqual('warning');
            expect(p.enum[3]).toEqual('error');
            expect(p.enum[4]).toEqual(true);
            expect(p.enum[5]).toEqual(false);

            expect(p.enum).toContain(p.default);
        }

        const overrideNamesInCode: string[] = Object.values(DiagnosticRule).filter((x) => x.startsWith('report'));

        for (const n of overrideNamesInJson) {
            expect(overrideNamesInCode).toContain(n);
        }
        for (const n of overrideNamesInCode) {
            expect(overrideNamesInJson).toContain(n);
        }
    });
});
