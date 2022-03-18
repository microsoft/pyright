import { LsifSymbol as TypescriptLsifSymbol } from './lsif-typescript/LsifSymbol';

// @ts-ignore
export class LsifSymbol extends TypescriptLsifSymbol {
    constructor(value: string) {
        super(value);
    }

    public static override package(name: string, version: string): TypescriptLsifSymbol {
        name = name.replace(/\./, '/');
        name = name.trim();

        // @ts-ignore
        return new TypescriptLsifSymbol(`lsif-pyright pypi ${name} ${version} `);
    }
}
