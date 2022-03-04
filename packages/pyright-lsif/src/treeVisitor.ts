import { Event } from 'vscode-languageserver/lib/common/api';
import { AnalyzerFileInfo } from 'pyright-internal/analyzer/analyzerFileInfo';
import { getFileInfo, getImportInfo } from 'pyright-internal/analyzer/analyzerNodeInfo';
import { ParseTreeWalker } from 'pyright-internal/analyzer/parseTreeWalker';
import { Program } from 'pyright-internal/analyzer/program';
import { TypeEvaluator } from 'pyright-internal/analyzer/typeEvaluatorTypes';
import { convertOffsetToPosition } from 'pyright-internal/common/positionUtils';
import { TextRange } from 'pyright-internal/common/textRange';
import { TextRangeCollection } from 'pyright-internal/common/textRangeCollection';
import {
    ClassNode,
    ExpressionNode,
    FunctionNode,
    ImportAsNode,
    ImportFromAsNode,
    ImportFromNode,
    ImportNode,
    ModuleNode,
    NameNode,
    ParameterNode,
    ParseNode,
    ParseNodeBase,
    ParseNodeType,
} from 'pyright-internal/parser/parseNodes';

import * as lsif from './lsif';
import { Descriptor } from './lsif-typescript/Descriptor';
import { LsifSymbol } from './LsifSymbol';
import { Position } from './lsif-typescript/Position';
import { Range } from './lsif-typescript/Range';
import { lsif_typed } from './lib';
import {
    getDocString,
    getEnclosingClass,
    getEnclosingSuite,
    isFromImportModuleName,
    isImportModuleName,
} from 'pyright-internal/analyzer/parseTreeUtils';
import { ClassType, isClass, isClassInstance, isFunction, Type } from 'pyright-internal/analyzer/types';
import { DefinitionFilter, DefinitionProvider } from 'pyright-internal/languageService/definitionProvider';
import { Declaration } from 'pyright-internal/analyzer/declaration';

// TODO:
// - [ ] Emit definitions for all class
// - [ ] Emit references for classes
// - [ ] Emit definitions for all functions
// - [ ] Emit references for functions

// I think we can do something like,
//  keep track of where a particular scope would END
//  when we pass that spot, we pop whatever the last scope was until we're done.
//
//  so for a class, we can keep some "state" at the moment of who is where
//  and then pop that off as we move outside of each scope.
//
//  This should let us do a lot more stuff in a "single pass" style, instead
//  of looking back up the tree as we go the whole time.

function nameNodeToRange(name: NameNode, lines: TextRangeCollection<TextRange>) {
    const _start = convertOffsetToPosition(name.start, lines);
    const start = new Position(_start.line, _start.character);

    const _end = convertOffsetToPosition(name.start + name.length, lines);
    const end = new Position(_end.line, _end.character);

    return new Range(start, end);
}

export class TreeVisitor extends ParseTreeWalker {
    private fileInfo: AnalyzerFileInfo | undefined;
    private symbols: Map<number, LsifSymbol>;
    private imports: Map<number, ParseNode>;

    constructor(
        public filepath: string,
        private program: Program,
        private evaluator: TypeEvaluator,
        public document: lsif.lib.codeintel.lsif_typed.Document
    ) {
        super();
        this.symbols = new Map();
        this.imports = new Map();

        console.log('Visiting:', document.relative_path);
    }

    override visitModule(node: ModuleNode): boolean {
        this.fileInfo = getFileInfo(node);
        return true;
    }

    override visitClass(node: ClassNode): boolean {
        const name = node.name;
        const range = nameNodeToRange(name, this.fileInfo!.lines);
        const symbol = this.getLsifSymbol(node);

        this.document.symbols.push(
            new lsif_typed.SymbolInformation({
                symbol: symbol.value,
                documentation: (getDocString(node.suite.statements) || '').split('\n'),
            })
        );

        return true;
    }

    // override visitFunction(node: FunctionNode): boolean {
    //     const name = node.name;
    //     const range = nameNodeToRange(name, this.fileInfo!.lines);
    //     const symbol = this.getLsifSymbol(node);
    //
    //     this.document.occurrences.push(
    //         new lsif_typed.Occurrence({
    //             symbol_roles: lsif_typed.SymbolRole.Definition,
    //             symbol: symbol.value,
    //             range: range.toLsif(),
    //         })
    //     );
    //
    //     return true;
    // }

    // TODO: Could possibly move this into visitFunction.
    //  I'm not sure of what the best way is to do this, since
    //  we don't always need to traverse these if we already know good info?
    // override visitParameter(node: ParameterNode): boolean {
    //     const name = node.name!;
    //     const symbol = this.getLsifSymbol(node);
    //
    //     this.document.occurrences.push(
    //         new lsif_typed.Occurrence({
    //             symbol_roles: lsif_typed.SymbolRole.Definition,
    //             symbol: symbol.value,
    //             range: nameNodeToRange(name, this.fileInfo!.lines).toLsif(),
    //         })
    //     );
    //
    //     return true;
    // }

    // `import requests`
    override visitImport(node: ImportNode): boolean {
        // console.log('Hitting Import', getImportInfo(node));
        // this.program.addTrackedFiles([], true, true)

        // this.evaluator.getImportInfo

        // console.log(node.list[0])
        for (const listNode of node.list) {
            this.document.occurrences.push(
                new lsif_typed.Occurrence({
                    symbol: LsifSymbol.global(
                        LsifSymbol.empty(),
                        Descriptor.package(listNode.module.nameParts[0].value)
                    ).value,
                    symbol_roles: lsif_typed.SymbolRole.ReadAccess,

                    range: nameNodeToRange(listNode.module.nameParts[0], this.fileInfo!.lines).toLsif(),
                })
            );
        }

        return true;
    }

    override visitImportFrom(node: ImportFromNode): boolean {
        for (const importNode of node.imports) {
            this.imports.set(importNode.id, importNode);
        }

        return true;
    }

    override visitName(node: NameNode): boolean {
        // TODO: We probably want to just ignore a bunch of different nodes,
        // that get captured more efficiently elsewhere.
        // For example, functions get captured above, and we don't need to do a
        // bunch of extra work to calculate that somethign is a function?
        //
        //
        //
        // DefinitionProvider
        // this.program
        // this.evaluator
        //
        // if (node.token.value !== "get") {
        //     return true
        // }

        if (false) {
            const sourceFile = this.program.getSourceFile(this.filepath)!;
            const position = convertOffsetToPosition(node.start, this.fileInfo!.lines);
            const defs = DefinitionProvider.getDefinitionsForPosition(
                {} as any,
                sourceFile.getParseResults()!,
                position,
                'all' as any,
                this.evaluator,
                {} as any
            );
        } else {
            // console.log(
            //     'Definitions:',
            //     node.value,
            //     '->',
            //     this.program.getDefinitionsForPosition(
            //         this.filepath,
            //         convertOffsetToPosition(node.start, this.fileInfo!.lines),
            //         DefinitionFilter.All,
            //         {
            //             isCancellationRequested: false,
            //             onCancellationRequested: Event.None,
            //         }
            //     )
            // );
            // console.log('Declarations:', node.value, '->', this.evaluator.getDeclarationsForNameNode(node));
            // console.log("Declarations:", node.value, "->", this.program.getTypeForSymbol());
        }

        const decls = this.evaluator.getDeclarationsForNameNode(node) || [];
        if (node.token.value === 'get') {
            console.log('Declarations:', decls);
        }
        if (decls.length > 0) {
            const dec = decls[0];

            if (!dec.node) {
                // console.log('Skipping:', node.value, '->', nameNodeToRange(node, this.fileInfo!.lines));
                return true;
            }

            if (this.imports.has(dec.node.id)) {
                throw 'oh no no, i do not remember how this happens';

                // TODO: ExpressionNode cast is required?
                try {
                    const thingy = this.evaluator.getType(dec.node as ExpressionNode);

                    if (thingy) {
                        this.pushTypeReference(node, thingy!);
                    }
                } catch (e) {}

                // this.document.occurrences.push(
                //     new lsif_typed.Occurrence({
                //         symbol_roles: lsif_typed.SymbolRole.ReadAccess,
                //         symbol: this.getLsifSymbol((thingy as any).details.declaration.node).value,
                //         range: nameNodeToRange(node, this.fileInfo!.lines).toLsif(),
                //     })
                // );

                // TODO: Handle ?
                return true;
            }

            // TODO: Write a more rigorous check for if this node is a
            // definition node. Probably some util somewhere already for
            // that (need to explore pyright some more)
            if (dec.node.id == node.parent!.id) {
                this.document.occurrences.push(
                    new lsif_typed.Occurrence({
                        symbol_roles: lsif_typed.SymbolRole.Definition,
                        symbol: this.getLsifSymbol(dec.node).value,
                        range: nameNodeToRange(node, this.fileInfo!.lines).toLsif(),
                    })
                );
                return true;
            }

            if (node.token.value == 'get') {
                this.document.occurrences.push(
                    new lsif_typed.Occurrence({
                        symbol_roles: lsif_typed.SymbolRole.ReadAccess,
                        symbol: this.declarationToSymbol(dec).value,
                        range: nameNodeToRange(node, this.fileInfo!.lines).toLsif(),
                    })
                );

                return true;
            }

            const symbol = this.getLsifSymbol(dec.node);
            const symbol_roles =
                dec.node.id == node.id ? lsif_typed.SymbolRole.Definition : lsif_typed.SymbolRole.ReadAccess;

            if (symbol_roles == lsif_typed.SymbolRole.Definition) {
                // console.log('Definion Symbol:', symbol);
            }

            // Now this must be a reference, so let's reference the right thing.
            this.document.occurrences.push(
                new lsif_typed.Occurrence({
                    symbol_roles,
                    symbol: symbol.value,
                    range: nameNodeToRange(node, this.fileInfo!.lines).toLsif(),
                })
            );
            return true;
        }

        if (node && (isImportModuleName(node) || isFromImportModuleName(node))) {
            // console.log('Import Thingy:', node);
            return true;
        }

        const builtinType = this.evaluator.getBuiltInType(node, node.value);
        if (builtinType) {
            this.document.occurrences.push(
                new lsif_typed.Occurrence({
                    symbol_roles: lsif_typed.SymbolRole.ReadAccess,
                    symbol: this.getBuiltinSymbol(node.value).value,
                    range: nameNodeToRange(node, this.fileInfo!.lines).toLsif(),
                })
            );
            return true;
        }

        return true;
    }

    private getBuiltinSymbol(name: string): LsifSymbol {
        // TODO: put builtin# the correct way (I don't think this is a good way to do the descriptor)
        return LsifSymbol.global(LsifSymbol.package('python', '3.9'), Descriptor.term('builtins#' + name));
    }

    private getLsifSymbol(node: ParseNodeBase): LsifSymbol {
        const existing = this.symbols.get(node.id);
        if (existing) {
            return existing;
        }

        // LsifSymbol.package
        const newSymbol = this.makeLsifSymbol(node);
        this.symbols.set(node.id, newSymbol);

        return newSymbol;
    }

    private declarationToSymbol(declaration: Declaration): LsifSymbol {
      return LsifSymbol.global(LsifSymbol.package(declaration.moduleName, '2.3'), Descriptor.method('get', ''))
    }

    private makeLsifSymbol(node: ParseNodeBase): LsifSymbol {
        // const parentSymbol = this.getLsifSymbol(node.parent!);

        switch (node.nodeType) {
            case ParseNodeType.Module:
                // return LsifSymbol.package('module', '0.0.0');
                return LsifSymbol.package(this.fileInfo!.moduleName, '0.0');

            case ParseNodeType.Parameter:
                return LsifSymbol.global(
                    this.getLsifSymbol(node.parent!),
                    Descriptor.parameter((node as ParameterNode).name!.value)
                );

            case ParseNodeType.Class:
                return LsifSymbol.global(
                    this.getLsifSymbol(node.parent!),
                    Descriptor.type((node as ClassNode).name.value)
                );

            case ParseNodeType.Function:
                return LsifSymbol.global(
                    this.getLsifSymbol(node.parent!),
                    Descriptor.method((node as FunctionNode).name!.value, '')
                );

            case ParseNodeType.Suite:
                if (node.parent) {
                    return this.getLsifSymbol(node.parent!);
                }

                // TODO: Not sure what to do about this...
                //  I don't know if we ever need to include this at all.
                return LsifSymbol.global(this.getLsifSymbol(node.parent!), Descriptor.meta('#'));

            case ParseNodeType.Name:
                return LsifSymbol.global(
                    // TODO(perf)
                    this.getLsifSymbol(getEnclosingSuite(node as ParseNode) || node.parent!),
                    Descriptor.term((node as NameNode).value)
                );

            case ParseNodeType.TypeAnnotation:
                return LsifSymbol.global(
                    this.getLsifSymbol(node.parent!),
                    // Descriptor.term((node as TypeAnnotationNode).typeAnnotation)
                    Descriptor.term('hello')
                );

            case ParseNodeType.FunctionAnnotation:
                return LsifSymbol.global(
                    this.getLsifSymbol(node.parent!),
                    // Descriptor.term((node as TypeAnnotationNode).typeAnnotation)
                    Descriptor.term('FuncAnnotation')
                );

            case ParseNodeType.ImportAs:
            case ParseNodeType.ImportFrom:
            case ParseNodeType.ImportFromAs:
                // TODO:
                return LsifSymbol.empty();

            case ParseNodeType.If:
                return LsifSymbol.empty();

            default:
                throw 'Unhandled: ' + node.nodeType;
        }
    }

    // Take a `Type` from pyright and turn that into an LSIF symbol.
    private typeToSymbol(node: NameNode, typeObj: Type): LsifSymbol {
        // console.log(node, typeObj);

        if (isFunction(typeObj)) {
            const decl = typeObj.details.declaration;
            if (!decl) {
                throw 'Unhandled missing declaration for type: function';
            }

            return LsifSymbol.global(this.getLsifSymbol(decl.node), Descriptor.term(node.value));
        } else if (isClass(typeObj)) {
            // console.log('SourceFile:', typeObj.details);

            let sourceFile = typeObj.details.moduleName.split('.');
            // let module =
            let sym = LsifSymbol.global(
                LsifSymbol.sourceFile(this.getPackageSymbol(), sourceFile),
                Descriptor.type(node.value)
            );
            return sym;
        } else if (isClassInstance(typeObj)) {
            typeObj = typeObj as ClassType;
            // return LsifSymbol.global(this.getLsifSymbol(decl.node), Descriptor.term(node.value)).value;
        }

        // throw 'unreachable typeObj';
        const mod = LsifSymbol.sourceFile(this.getPackageSymbol(), [this.fileInfo!.moduleName]);
        return LsifSymbol.global(mod, Descriptor.term(node.value));
    }

    private pushTypeReference(node: NameNode, typeObj: Type): void {
        const symbol = this.typeToSymbol(node, typeObj).value;
        this.document.occurrences.push(
            new lsif_typed.Occurrence({
                symbol_roles: lsif_typed.SymbolRole.ReadAccess,
                symbol,
                range: nameNodeToRange(node, this.fileInfo!.lines).toLsif(),
            })
        );
    }

    private getPackageSymbol(): LsifSymbol {
        return LsifSymbol.package(this.fileInfo!.moduleName, '0.0');
    }

    // override visitName(node: NameNode): boolean {
    //   console.log("Visiting Node:", node);
    //   return true;
    // }
}
