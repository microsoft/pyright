/*
 * streamUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Utility functions for dealing with standard IO streams in node.
 */

import { stdin } from 'process';

export async function getStdinBuffer() {
    if (stdin.isTTY) {
        return Buffer.alloc(0);
    }

    const result = [];
    let length = 0;

    for await (const chunk of stdin) {
        result.push(chunk);
        length += chunk.length;
    }

    return Buffer.concat(result, length);
}

export async function getStdin() {
    const buffer = await getStdinBuffer();
    return buffer.toString();
}
