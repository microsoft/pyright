/*
 * crypto.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Platform-independent helper functions for crypto.
 */

import { fail } from './debug';

let nodeCrypto: typeof import('crypto') | undefined;

try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    nodeCrypto = require('crypto');
    if (!nodeCrypto?.randomBytes) {
        nodeCrypto = undefined;
    }
} catch {
    // Not running in node.
}

// See lib.dom.d.ts.
interface Crypto {
    getRandomValues<
        T extends
            | Int8Array
            | Int16Array
            | Int32Array
            | Uint8Array
            | Uint16Array
            | Uint32Array
            | Uint8ClampedArray
            | Float32Array
            | Float64Array
            | DataView
            | null
    >(
        array: T
    ): T;
}

declare const crypto: Crypto | undefined;

function arrayToHex(arr: Uint8Array): string {
    return [...arr].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export function randomBytesHex(size: number): string {
    if (nodeCrypto) {
        return nodeCrypto.randomBytes(size).toString('hex');
    }

    if (crypto) {
        const buf = crypto.getRandomValues(new Uint8Array(size));
        return arrayToHex(buf);
    }

    fail('crypto library not found');
}
