/*
 * serviceProvider.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Container for different services used within the application.
 */

import { addIfUnique, removeArrayElements } from './collectionUtils';
import { Disposable } from './core';
import * as debug from './debug';

abstract class InternalKey {
    abstract readonly kind: 'singleton' | 'group';
    abstract readonly id: string;
}

/**
 * Key for singleton service T.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export class ServiceKey<T> extends InternalKey {
    readonly kind = 'singleton';
    constructor(readonly id: string) {
        super();
    }
}

/**
 * Key for group of service T.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export class GroupServiceKey<T> extends InternalKey {
    readonly kind = 'group';
    constructor(readonly id: string) {
        super();
    }
}

export type AllServiceKeys<T> = ServiceKey<T> | GroupServiceKey<T>;

export class ServiceProvider {
    private _container = new Map<string, any>();
    private _disposed = false;

    get disposed() {
        return this._disposed;
    }
    add<T>(key: ServiceKey<T>, value: T | undefined): void;
    add<T>(key: GroupServiceKey<T>, value: T): void;
    add<T>(key: AllServiceKeys<T>, value: T | undefined): void {
        if (key.kind === 'group') {
            this._addGroupService(key, value);
            return;
        }

        if (key.kind === 'singleton') {
            if (value !== undefined) {
                this._container.set(key.id, value);
            } else {
                this.remove(key);
            }
            return;
        }

        debug.assertNever(key, `Unknown key type ${typeof key}`);
    }

    remove<T>(key: ServiceKey<T>): void;
    remove<T>(key: GroupServiceKey<T>, value: T): void;
    remove<T>(key: AllServiceKeys<T>, value?: T): void {
        if (key.kind === 'group') {
            this._removeGroupService(key, value);
            return;
        }

        if (key.kind === 'singleton') {
            this._container.delete(key.id);
            return;
        }

        debug.assertNever(key, `Unknown key type ${typeof key}`);
    }

    tryGet<T>(key: ServiceKey<T>): T | undefined;
    tryGet<T>(key: GroupServiceKey<T>): readonly T[] | undefined;
    tryGet<T>(key: AllServiceKeys<T>): T | readonly T[] | undefined {
        return this._container.get(key.id);
    }

    get<T>(key: ServiceKey<T>): T;
    get<T>(key: GroupServiceKey<T>): readonly T[];
    get<T>(key: AllServiceKeys<T>): T | readonly T[] {
        const value = key.kind === 'group' ? this.tryGet(key) : this.tryGet(key);
        if (value === undefined) {
            throw new Error(`Global service provider not initialized for ${key.id}.`);
        }

        return value;
    }

    clone() {
        const serviceProvider = new ServiceProvider();
        this._container.forEach((value, key) => {
            if (Array.isArray(value)) {
                serviceProvider._container.set(key, [...(value ?? [])]);
            } else if (value.clone !== undefined) {
                serviceProvider._container.set(key, value.clone());
            } else {
                serviceProvider._container.set(key, value);
            }
        });

        return serviceProvider;
    }

    dispose() {
        if (this._disposed) {
            return;
        }
        this._disposed = true;
        for (const service of this._container.values()) {
            if (Disposable.is(service)) {
                service.dispose();
            }
        }

        // Clear out everything except for some essential services,
        // as those may be needed during shutdown.
        const essentialList = ['fs', 'CaseSensitivityDetector', 'TempFile'];
        const essentials = new Map<string, any>();
        for (const key of essentialList) {
            const service = this._container.get(key);
            if (service) {
                essentials.set(key, service);
            }
        }
        this._container.clear();
        essentials.forEach((value, key) => {
            this._container.set(key, value);
        });
    }

    private _addGroupService<T>(key: GroupServiceKey<T>, newValue: T | undefined) {
        // Explicitly cast to remove `readonly`
        const services = this.tryGet(key) as T[] | undefined;
        if (services === undefined) {
            this._container.set(key.id, [newValue]);
            return;
        }

        if (newValue !== undefined) {
            addIfUnique(services, newValue);
        }
    }

    private _removeGroupService<T>(key: GroupServiceKey<T>, oldValue: T) {
        const services = this.tryGet(key) as T[];
        if (services === undefined) {
            return;
        }

        removeArrayElements(services, (s) => s === oldValue);
    }
}
