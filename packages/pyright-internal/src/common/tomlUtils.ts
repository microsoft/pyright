/*
 * tomlUtils.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * helpers related to TOML
 */

type TomlPrimitive =
    | string
    | number
    | boolean
    | {
          [key: string]: TomlPrimitive;
      }
    | TomlPrimitive[];

// Dynamically load `smol-toml` to address module loading issues and
// maintain existing module resolution to support multiple environments.
let TOML: any;
const loadTomlModule = (async () => {
    TOML = await import('smol-toml');
})();

export async function ensureTomlModuleLoaded() {
    await loadTomlModule;
}

export const parse = (toml: string): Record<string, TomlPrimitive> => {
    if (!TOML) {
        throw new Error('TOML module not loaded');
    }
    return TOML.parse(toml);
};
