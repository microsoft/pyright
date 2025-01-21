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
    // Use a magic comment to prevent webpack from creating an extra chunk for the dynamic import by default.
    // An extra chunk will still be created if explicitly configured in the webpack config.
    TOML = await import(/* webpackMode: "eager" */ 'smol-toml');
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
