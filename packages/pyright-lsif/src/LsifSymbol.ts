import { LsifSymbol as TypescriptLsifSymbol } from './lsif-typescript/LsifSymbol';

export class LsifSymbol extends TypescriptLsifSymbol {
    constructor(value: string) {
        super(value);
    }

    public static override package(name: string, version: string): TypescriptLsifSymbol {
        return new TypescriptLsifSymbol(`lsif-pyright pypi ${name} ${version} `);
    }
}
