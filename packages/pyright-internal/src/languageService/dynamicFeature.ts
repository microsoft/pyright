/*
 * dynamicFeature.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * LanguageServer features that can be dynamically added or removed from LSP server
 */
import { Disposable } from 'vscode-languageserver';
import { ServerSettings } from '../common/languageServerInterface';

export abstract class DynamicFeature {
    private _lastRegistration: Disposable | undefined;

    constructor(readonly name: string) {
        // Empty
    }

    register() {
        this.registerFeature().then((d) => {
            this.dispose();
            this._lastRegistration = d;
        });
    }

    update(settings: ServerSettings) {
        // Default is no-op
    }

    dispose() {
        this._lastRegistration?.dispose();
        this._lastRegistration = undefined;
    }

    protected abstract registerFeature(): Promise<Disposable>;
}

export class DynamicFeatures {
    private readonly _map = new Map<string, DynamicFeature>();

    add(feature: DynamicFeature) {
        const old = this._map.get(feature.name);
        if (old) {
            old.dispose();
        }

        this._map.set(feature.name, feature);
    }

    update(settings: ServerSettings) {
        for (const feature of this._map.values()) {
            feature.update(settings);
        }
    }

    register() {
        for (const feature of this._map.values()) {
            feature.register();
        }
    }

    unregister() {
        for (const feature of this._map.values()) {
            feature.dispose();
        }

        this._map.clear();
    }
}
