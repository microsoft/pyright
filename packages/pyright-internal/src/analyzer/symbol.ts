/*
 * symbol.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Represents an association between a name and the type
 * (or multiple types) that the symbol is associated with
 * in the program.
 */

import { NameNode } from '../parser/parseNodes';
import { Declaration, DeclarationType } from './declaration';
import { areDeclarationsSame, hasTypeForDeclaration } from './declarationUtils';
import { Type } from './types';

export const enum SymbolFlags {
    None = 0,

    // Indicates that the symbol is unbound at the start of
    // execution. Some symbols are initialized by the module
    // loader, so they are bound even before the first statement
    // in the module is executed.
    InitiallyUnbound = 1 << 0,

    // Indicates that the symbol is not visible from other files.
    // Used for module-level symbols.
    ExternallyHidden = 1 << 1,

    // Indicates that the symbol is a class member of a class.
    ClassMember = 1 << 2,

    // Indicates that the symbol is an instance member of a class.
    InstanceMember = 1 << 3,

    // Indicates that the symbol is specified in the __slots__
    // declaration of a class. Such symbols act like instance members
    // in some respects but are actually implemented as class members
    // using descriptor objects.
    SlotsMember = 1 << 4,

    // Indicates that the symbol is considered "private" to the
    // class or module and should not be accessed outside or overridden.
    PrivateMember = 1 << 5,

    // Indicates that the symbol is not considered for protocol
    // matching. This applies to some built-in symbols like __module__.
    IgnoredForProtocolMatch = 1 << 6,

    // Indicates that the symbol is a ClassVar, so it cannot be
    // set when accessed through a class instance.
    ClassVar = 1 << 7,

    // Indicates that the symbol is in __all__.
    InDunderAll = 1 << 8,

    // Indicates that the symbol is a private import in a py.typed module.
    PrivatePyTypedImport = 1 << 9,

    // Indicates that the symbol is an InitVar as specified in PEP 557.
    InitVar = 1 << 10,

    // Indicates that the symbol is a field in a NamedTuple class, which
    // is modeled as an instance member but in some respects acts as a
    // class member.
    NamedTupleMember = 1 << 11,

    // Indicates that the symbol should be exempt from override type checks.
    IgnoredForOverrideChecks = 1 << 12,

    // Indicates that the symbol is marked Final and is assigned a value
    // in the class body. The typing spec indicates that these should be
    // considered ClassVars unless they are found in a dataclass.
    FinalVarInClassBody = 1 << 13,
}

let nextSymbolId = 1;
function getUniqueSymbolId() {
    return nextSymbolId++;
}

// Symbol ID that indicates that there is no specific symbol.
export const indeterminateSymbolId = 0;

export interface SynthesizedTypeInfo {
    type: Type;

    // An optional node that is not used by the type evaluator
    // but can be used by language services to provide additional
    // functionality (such as go-to-definition).
    node?: NameNode;
}

export class Symbol {
    // Information about the node that declared the value -
    // i.e. where the editor will take the user if "show definition"
    // is selected. Multiple declarations can exist for variables,
    // properties, and functions (in the case of @overload).
    private _declarations?: Declaration[];

    // Flags that provide information about the symbol.
    private _flags: SymbolFlags;

    // Unique numeric ID for each symbol allocated.
    readonly id: number;

    // Symbols that are completely synthesized (i.e. have no
    // corresponding declarations in the program) can have
    // a specified type.
    private _synthesizedTypeInfo?: SynthesizedTypeInfo;

    // Is this symbol an alias for a symbol originally imported from
    // the typing or typing_extensions module (e.g. "Final")?
    private _typingSymbolAlias?: string;

    constructor(flags: SymbolFlags) {
        this.id = getUniqueSymbolId();
        this._flags = flags;
    }

    static createWithType(flags: SymbolFlags, type: Type, node?: NameNode): Symbol {
        const newSymbol = new Symbol(flags);
        newSymbol._synthesizedTypeInfo = { type, node };
        return newSymbol;
    }

    isInitiallyUnbound() {
        return !!(this._flags & SymbolFlags.InitiallyUnbound);
    }

    setIsExternallyHidden() {
        this._flags |= SymbolFlags.ExternallyHidden;
    }

    isExternallyHidden() {
        return !!(this._flags & SymbolFlags.ExternallyHidden);
    }

    setIsIgnoredForProtocolMatch() {
        this._flags |= SymbolFlags.IgnoredForProtocolMatch;
    }

    isIgnoredForProtocolMatch() {
        return !!(this._flags & SymbolFlags.IgnoredForProtocolMatch);
    }

    setIsClassMember() {
        this._flags |= SymbolFlags.ClassMember;
    }

    isClassMember() {
        return !!(this._flags & SymbolFlags.ClassMember);
    }

    setIsInstanceMember() {
        this._flags |= SymbolFlags.InstanceMember;
    }

    isInstanceMember() {
        return !!(this._flags & SymbolFlags.InstanceMember);
    }

    setIsSlotsMember() {
        this._flags |= SymbolFlags.ClassMember | SymbolFlags.InstanceMember | SymbolFlags.SlotsMember;
    }

    isSlotsMember() {
        return !!(this._flags & SymbolFlags.SlotsMember);
    }

    setIsClassVar() {
        this._flags |= SymbolFlags.ClassVar;
    }

    isClassVar() {
        return !!(this._flags & SymbolFlags.ClassVar);
    }

    setIsFinalVarInClassBody() {
        this._flags |= SymbolFlags.FinalVarInClassBody;
    }

    isFinalVarInClassBody() {
        return !!(this._flags & SymbolFlags.FinalVarInClassBody);
    }

    setIsInitVar() {
        this._flags |= SymbolFlags.InitVar;
    }

    isInitVar() {
        return !!(this._flags & SymbolFlags.InitVar);
    }

    setIsInDunderAll() {
        this._flags |= SymbolFlags.InDunderAll;
    }

    isInDunderAll() {
        return !!(this._flags & SymbolFlags.InDunderAll);
    }

    setIsPrivateMember() {
        this._flags |= SymbolFlags.PrivateMember;
    }

    isPrivateMember() {
        return !!(this._flags & SymbolFlags.PrivateMember);
    }

    setPrivatePyTypedImport() {
        this._flags |= SymbolFlags.PrivatePyTypedImport;
    }

    isPrivatePyTypedImport() {
        return !!(this._flags & SymbolFlags.PrivatePyTypedImport);
    }

    isNamedTupleMemberMember() {
        return !!(this._flags & SymbolFlags.NamedTupleMember);
    }

    isIgnoredForOverrideChecks() {
        return !!(this._flags & SymbolFlags.IgnoredForOverrideChecks);
    }

    setTypingSymbolAlias(aliasedName: string) {
        this._typingSymbolAlias = aliasedName;
    }

    getTypingSymbolAlias(): string | undefined {
        return this._typingSymbolAlias;
    }

    addDeclaration(declaration: Declaration) {
        if (this._declarations) {
            // See if this node was already identified as a declaration. If so,
            // replace it. Otherwise, add it as a new declaration to the end of
            // the list.
            const declIndex = this._declarations.findIndex((decl) => areDeclarationsSame(decl, declaration));
            if (declIndex < 0) {
                this._declarations.push(declaration);

                // If there is more than one declaration for a symbol, we will
                // assume it is not a type alias.
                this._declarations.forEach((decl) => {
                    if (decl.type === DeclarationType.Variable && decl.typeAliasName) {
                        delete decl.typeAliasName;
                    }
                });
            } else {
                // If the new declaration has a defined type, it should replace
                // the existing one.
                const curDecl = this._declarations[declIndex];
                if (hasTypeForDeclaration(declaration)) {
                    this._declarations[declIndex] = declaration;
                    if (curDecl.type === DeclarationType.Variable && declaration.type === DeclarationType.Variable) {
                        if (!declaration.inferredTypeSource && curDecl.inferredTypeSource) {
                            declaration.inferredTypeSource = curDecl.inferredTypeSource;
                        }
                    }
                } else if (declaration.type === DeclarationType.Variable) {
                    // If it's marked "final" or "type alias", this should be reflected
                    // in the existing declaration. Likewise, if the existing declaration
                    // doesn't have a type source, add it.
                    if (curDecl.type === DeclarationType.Variable) {
                        if (declaration.isFinal) {
                            curDecl.isFinal = true;
                        }

                        curDecl.typeAliasName = declaration.typeAliasName;

                        if (!curDecl.inferredTypeSource && declaration.inferredTypeSource) {
                            curDecl.inferredTypeSource = declaration.inferredTypeSource;
                        }
                    }
                }
            }
        } else {
            this._declarations = [declaration];
        }
    }

    hasDeclarations() {
        return this._declarations ? this._declarations.length > 0 : false;
    }

    getDeclarations() {
        return this._declarations ? this._declarations : [];
    }

    hasTypedDeclarations() {
        // We'll treat an synthesized type as an implicit declaration.
        if (this._synthesizedTypeInfo) {
            return true;
        }

        return this.getDeclarations().some((decl) => hasTypeForDeclaration(decl));
    }

    getTypedDeclarations() {
        return this.getDeclarations().filter((decl) => hasTypeForDeclaration(decl));
    }

    getSynthesizedType() {
        return this._synthesizedTypeInfo;
    }
}

// Maps names to symbol information.
export type SymbolTable = Map<string, Symbol>;
