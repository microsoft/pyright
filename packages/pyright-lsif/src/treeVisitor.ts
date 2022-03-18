import { AnalyzerFileInfo } from 'pyright-internal/analyzer/analyzerFileInfo';
import { getFileInfo } from 'pyright-internal/analyzer/analyzerNodeInfo';
import { ParseTreeWalker } from 'pyright-internal/analyzer/parseTreeWalker';
import { TypeEvaluator } from 'pyright-internal/analyzer/typeEvaluatorTypes';
import { convertOffsetToPosition } from 'pyright-internal/common/positionUtils';
import { TextRange } from 'pyright-internal/common/textRange';
import { TextRangeCollection } from 'pyright-internal/common/textRangeCollection';
import {
    ClassNode,
    ExpressionNode,
    FunctionNode,
    ImportFromNode,
    ImportNode,
    ModuleNode,
    NameNode,
    ParameterNode,
    ParseNode,
    ParseNodeBase,
    ParseNodeType,
    TypeAnnotationNode,
} from 'pyright-internal/parser/parseNodes';

import * as lsif from './lsif';
import {
    metaDescriptor,
    methodDescriptor,
    packageDescriptor,
    parameterDescriptor,
    termDescriptor,
    typeDescriptor,
} from './lsif-typescript/Descriptor';
import { LsifSymbol } from './LsifSymbol';
import { Position } from './lsif-typescript/Position';
import { Range } from './lsif-typescript/Range';
import { lsiftyped } from './lib';
import {
    getDocString,
    getEnclosingSuite,
    isFromImportModuleName,
    isImportModuleName,
} from 'pyright-internal/analyzer/parseTreeUtils';
import { ClassType, isClass, isClassInstance, isFunction, Type } from 'pyright-internal/analyzer/types';
import { getScopeForNode } from 'pyright-internal/analyzer/scopeUtils';
import { ScopeType } from 'pyright-internal/analyzer/scope';
import { Counter } from './lsif-typescript/Counter';
import { TypeStubExtendedWriter } from './TypeStubExtendedWriter';
import { SourceFile } from 'pyright-internal/analyzer/sourceFile';

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
    public filepath: string;

    private docstringWriter: TypeStubExtendedWriter;

    constructor(
        public sourceFile: SourceFile,
        private evaluator: TypeEvaluator,
        public document: lsif.lib.codeintel.lsiftyped.Document,
        private version: string,
        private counter: Counter
    ) {
        super();
        this.filepath = sourceFile.getFilePath();
        this.symbols = new Map();
        this.imports = new Map();

        this.docstringWriter = new TypeStubExtendedWriter(this.sourceFile, this.evaluator);
        console.log('Visiting:', document.relative_path);
    }

    override visitModule(node: ModuleNode): boolean {
        this.fileInfo = getFileInfo(node);
        return true;
    }

    override visitClass(node: ClassNode): boolean {
        // console.log(node.suite.statements[0])

        // This might not even be worth it to be honest...
        this.docstringWriter.visitClass(node);

        const symbol = this.getLsifSymbol(node);

        const stub = this.docstringWriter.docstrings.get(node.id)!;
        const doc = getDocString(node.suite.statements) || '';

        this.document.symbols.push(
            new lsiftyped.SymbolInformation({
                symbol: symbol.value,
                documentation: [...stub, doc],
            })
        );

        return true;
    }

    override visitTypeAnnotation(node: TypeAnnotationNode): boolean {
        // We are close to being able to look up a symbol, which could give us additional information here.
        //  Perhaps we should be using this for additional information for any given name?
        //  We can revisit this in visitName or perhaps when looking up the lsif symbol
        // console.log("TypeAnnotation", this.evaluator.lookUpSymbolRecursive(node, 'a', false)?.symbol.isClassMember());

        return true;
    }

    override visitFunction(node: FunctionNode): boolean {
        this.docstringWriter.visitFunction(node);

        // const name = node.name;
        // const range = nameNodeToRange(name, this.fileInfo!.lines);
        // const type_ = this.evaluator.getType(node.name)

        const symbol = this.getLsifSymbol(node);

        let stubs = this.docstringWriter.docstrings.get(node.id)!;
        let doc = getDocString(node.suite.statements) || '';

        this.document.symbols.push(
            new lsiftyped.SymbolInformation({
                symbol: symbol.value,
                documentation: [doc, '```python\n' + stubs.join('\n') + '\n```'],
                // documentation: ['```' + (getDocString(node.suite.statements) || '') + '```'],
            })
        );

        return true;
    }

    // override visitParameter(node: ParameterNode): boolean {
    //     const name = node.name!;
    //     const symbol = this.getLsifSymbol(node);
    //
    //     this.document.occurrences.push(
    //         new lsiftyped.Occurrence({
    //             symbol_roles: lsiftyped.SymbolRole.Definition,
    //             symbol: symbol.value,
    //             range: nameNodeToRange(name, this.fileInfo!.lines).toLsif(),
    //         })
    //     );
    //
    //     return true;
    // }

    // `import requests`
    override visitImport(node: ImportNode): boolean {
        this.docstringWriter.visitImport(node);

        // console.log('Hitting Import', getImportInfo(node));
        // this.program.addTrackedFiles([], true, true)

        // this.evaluator.getImportInfo

        // console.log(node.list[0])
        for (const listNode of node.list) {
            this.document.occurrences.push(
                new lsiftyped.Occurrence({
                    symbol: LsifSymbol.global(LsifSymbol.empty(), packageDescriptor(listNode.module.nameParts[0].value))
                        .value,
                    symbol_roles: lsiftyped.SymbolRole.ReadAccess,

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
        const decls = this.evaluator.getDeclarationsForNameNode(node) || [];
        if (decls.length > 0) {
            const dec = decls[0];

            if (!dec.node) {
                // console.log('Skipping:', node.value, '->', nameNodeToRange(node, this.fileInfo!.lines));
                return true;
            }

            if (this.imports.has(dec.node.id)) {
                // TODO: ExpressionNode cast is required?
                const thingy = this.evaluator.getType(dec.node as ExpressionNode);

                if (thingy) {
                    this.pushTypeReference(node, thingy!);
                }

                // this.document.occurrences.push(
                //     new lsiftyped.Occurrence({
                //         symbol_roles: lsiftyped.SymbolRole.ReadAccess,
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
                    new lsiftyped.Occurrence({
                        symbol_roles: lsiftyped.SymbolRole.Definition,
                        symbol: this.getLsifSymbol(dec.node).value,
                        range: nameNodeToRange(node, this.fileInfo!.lines).toLsif(),
                    })
                );
                return true;
            }

            const symbol = this.getLsifSymbol(dec.node);
            const symbol_roles =
                dec.node.id == node.id ? lsiftyped.SymbolRole.Definition : lsiftyped.SymbolRole.ReadAccess;

            if (symbol_roles == lsiftyped.SymbolRole.Definition) {
                const scope = getScopeForNode(node);
                if (scope?.type != ScopeType.Builtin) {
                }
                // if scope
            }

            // Now this must be a reference, so let's reference the right thing.
            this.document.occurrences.push(
                new lsiftyped.Occurrence({
                    symbol_roles,
                    symbol: symbol.value,
                    range: nameNodeToRange(node, this.fileInfo!.lines).toLsif(),
                })
            );
            return true;
        }

        if (node && (isImportModuleName(node) || isFromImportModuleName(node))) {
            return true;
        }

        const builtinType = this.evaluator.getBuiltInType(node, node.value);
        if (builtinType) {
            this.document.occurrences.push(
                new lsiftyped.Occurrence({
                    symbol_roles: lsiftyped.SymbolRole.ReadAccess,
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
        return LsifSymbol.global(LsifSymbol.package('python', '3.9'), termDescriptor('builtins__' + name));
    }

    private getLsifSymbol(node: ParseNode): LsifSymbol {
        const existing = this.symbols.get(node.id);
        if (existing) {
            return existing;
        }

        const scope = getScopeForNode(node)!;

        // not yet right, but good first approximation
        if (canBeLocal(node) && scope.type != ScopeType.Builtin) {
            // console.log(node);
            // const newSymbol = LsifSymbol.global(this.getPackageSymbol(), LsifSymbol.local(this.counter.next())),
            const newSymbol = LsifSymbol.local(this.counter.next());
            this.symbols.set(node.id, newSymbol);
            return newSymbol;
        }

        const newSymbol = this.makeLsifSymbol(node);
        this.symbols.set(node.id, newSymbol);

        return newSymbol;
    }

    // private declarationToSymbol(declaration: Declaration): LsifSymbol {
    //     console.log('declaration path ->', declaration.path, this.program._getImportNameForFile(declaration.path));
    //     return LsifSymbol.global(LsifSymbol.package(declaration.moduleName, '2.3'), methodDescriptor('get'));
    // }

    private makeLsifSymbol(node: ParseNode): LsifSymbol {
        switch (node.nodeType) {
            case ParseNodeType.Module:
                // return LsifSymbol.package('module', '0.0.0');
                return LsifSymbol.package(this.fileInfo!.moduleName, this.version);

            case ParseNodeType.Parameter:
                // console.log(node);
                return LsifSymbol.global(
                    this.getLsifSymbol(node.parent!),
                    parameterDescriptor((node as ParameterNode).name!.value)
                );

            case ParseNodeType.Class:
                return LsifSymbol.global(
                    this.getLsifSymbol(node.parent!),
                    typeDescriptor((node as ClassNode).name.value)
                );

            case ParseNodeType.Function:
                return LsifSymbol.global(
                    this.getLsifSymbol(node.parent!),
                    methodDescriptor((node as FunctionNode).name!.value)
                );

            case ParseNodeType.Suite:
                if (node.parent) {
                    return this.getLsifSymbol(node.parent!);
                }

                // TODO: Not sure what to do about this...
                //  I don't know if we ever need to include this at all.
                return LsifSymbol.global(this.getLsifSymbol(node.parent!), metaDescriptor('#'));

            case ParseNodeType.Name:
                return LsifSymbol.global(
                    // TODO(perf)
                    this.getLsifSymbol(getEnclosingSuite(node as ParseNode) || node.parent!),
                    termDescriptor((node as NameNode).value)
                );

            case ParseNodeType.TypeAnnotation:
                throw 'oh no'
                // console.log(this.evaluator.lookUpSymbolRecursive(node, ))
                return LsifSymbol.global(
                    this.getLsifSymbol(getEnclosingSuite(node) || node.parent!),
                    // Descriptor.term((node as TypeAnnotationNode).typeAnnotation)
                    termDescriptor('hello')
                );

            case ParseNodeType.FunctionAnnotation:
                return LsifSymbol.global(
                    this.getLsifSymbol(node.parent!),
                    // Descriptor.term((node as TypeAnnotationNode).typeAnnotation)
                    termDescriptor('FuncAnnotation')
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
                // console.log('Unhandled', node.nodeType, node);
                // return LsifSymbol.empty();
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

            return LsifSymbol.global(LsifSymbol.package(decl.moduleName, this.version), methodDescriptor(node.value));
        } else if (isClass(typeObj)) {
            // console.log('SourceFile:', typeObj.details);

            let sourceFile = typeObj.details.moduleName;
            // let module =
            // let sym = LsifSymbol.global(
            //     LsifSymbol.sourceFile(this.getPackageSymbol(), sourceFile),
            //     typeDescriptor(node.value)
            // );
            const sym = LsifSymbol.global(this.getPackageSymbol(), packageDescriptor(sourceFile));
            return sym;
        } else if (isClassInstance(typeObj)) {
            typeObj = typeObj as ClassType;
            // return LsifSymbol.global(this.getLsifSymbol(decl.node), Descriptor.term(node.value)).value;
        }

        // throw 'unreachable typeObj';
        // const mod = LsifSymbol.sourceFile(this.getPackageSymbol(), [this.fileInfo!.moduleName]);
        const mod = LsifSymbol.global(this.getPackageSymbol(), packageDescriptor(this.fileInfo!.moduleName));
        return LsifSymbol.global(mod, termDescriptor(node.value));
    }

    private pushTypeReference(node: NameNode, typeObj: Type): void {
        const symbol = this.typeToSymbol(node, typeObj).value;
        this.document.occurrences.push(
            new lsiftyped.Occurrence({
                symbol_roles: lsiftyped.SymbolRole.ReadAccess,
                symbol,
                range: nameNodeToRange(node, this.fileInfo!.lines).toLsif(),
            })
        );
    }

    private getPackageSymbol(): LsifSymbol {
        console.log('Getting package symbol');
        return LsifSymbol.package(this.fileInfo!.moduleName, '0.0');
    }

    // override visitName(node: NameNode): boolean {
    //   console.log("Visiting Node:", node);
    //   return true;
    // }
}

function canBeLocal(node: ParseNode): boolean {
    return node.nodeType !== ParseNodeType.Parameter 
}
