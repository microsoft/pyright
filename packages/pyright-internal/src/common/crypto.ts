/*
 * crypto.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Platform-independent helper functions for crypto.
 *
 * randomBytesHex uses platform CSPRNGs (Node's crypto.randomBytes or the Web
 * Crypto API's getRandomValues). Both are cryptographically secure, so the
 * output is safe for generating secrets such as auth tokens. A pure-JS
 * fallback is intentionally *not* provided — insecure randomness must never
 * be silently substituted for secrets. If neither platform API is available
 * the function fails loudly.
 *
 * Contrast with sha256 (in pylance-internal's crypto.ts), which *can* safely
 * fall back to a JS polyfill because SHA-256 is a deterministic algorithm —
 * any correct implementation produces identical output for the same input.
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
