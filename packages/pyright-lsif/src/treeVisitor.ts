import { AnalyzerFileInfo } from 'pyright-internal/analyzer/analyzerFileInfo';
import { getFileInfo } from 'pyright-internal/analyzer/analyzerNodeInfo';
import { ParseTreeWalker } from 'pyright-internal/analyzer/parseTreeWalker';
import { TypeEvaluator } from 'pyright-internal/analyzer/typeEvaluatorTypes';
import { convertOffsetToPosition } from 'pyright-internal/common/positionUtils';
import { TextRange } from 'pyright-internal/common/textRange';
import { TextRangeCollection } from 'pyright-internal/common/textRangeCollection';
import {
    AssignmentNode,
    ClassNode,
    DecoratorNode,
    ExpressionNode,
    FunctionNode,
    ImportFromNode,
    ImportNode,
    ModuleNode,
    NameNode,
    ParameterNode,
    ParseNode,
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
    getEnclosingClass,
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
import { extractParameterDocumentation } from 'pyright-internal/analyzer/docStringUtils';
import { Declaration } from 'pyright-internal/analyzer/declaration';

//  Useful functions for later, but haven't gotten far enough yet to use them.
//      extractParameterDocumentation

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

    private _classDepth: number;
    private _functionDepth: number;
    private _lastScope: ParseNode[];

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

        this._classDepth = 0;
        this._functionDepth = 0;
        this._lastScope = [];
    }

    private getNearestClass(): ClassNode | undefined {
        for (let i = this._lastScope.length - 1; i >= 0; i--) {
            if (this._lastScope[i].nodeType == ParseNodeType.Class) {
                return this._lastScope[i] as ClassNode;
            }
        }

        return undefined;
    }

    private isInsideClass(): boolean {
        if (this._classDepth == 0) {
            return false;
        }

        return this._lastScope[this._lastScope.length - 1].nodeType == ParseNodeType.Class;
    }

    override visitModule(node: ModuleNode): boolean {
        this.fileInfo = getFileInfo(node);
        return true;
    }

    override visitClass(node: ClassNode): boolean {
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

        this.withScopeNode(node, () => {
            this.walk(node.suite);
        });

        return false;
    }

    override visitTypeAnnotation(node: TypeAnnotationNode): boolean {
        // We are close to being able to look up a symbol, which could give us additional information here.
        //  Perhaps we should be using this for additional information for any given name?
        //  We can revisit this in visitName or perhaps when looking up the lsif symbol

        // If we see a type annotation and we are currently inside of a class,
        // that means that we are describing fields of a class (as far as I can tell),
        // so we need to push a new symbol
        if (this.isInsideClass()) {
            this.document.symbols.push(
                new lsiftyped.SymbolInformation({
                    symbol: this.getLsifSymbol(node).value,

                    // TODO: Get the documentation for a type annotation
                    // documentation: ['A Field of a Class'],
                })
            );
        }

        return true;
    }

    override visitAssignment(node: AssignmentNode): boolean {
        // Probably not performant, we should figure out if we can tell that
        // this particular spot is a definition or not, or potentially cache
        // per file or something?
        if (node.leftExpression.nodeType == ParseNodeType.Name) {
            const decls = this.evaluator.getDeclarationsForNameNode(node.leftExpression) || [];
            if (decls.length > 0) {
                let dec = decls[0];
                if (dec.node.parent && dec.node.parent.id == node.id) {
                    this.document.symbols.push(
                        new lsiftyped.SymbolInformation({
                            symbol: this.getLsifSymbol(dec.node).value,
                        })
                    );
                }
            }
        }

        return true;
    }

    private withScopeNode(node: ParseNode, f: () => void): void {
        if (node.nodeType == ParseNodeType.Function) {
            this._functionDepth++;
        } else if (node.nodeType == ParseNodeType.Class) {
            this._classDepth++;
        } else {
            throw 'unsupported scope type';
        }

        const scopeLen = this._lastScope.push(node);

        f();

        // Assert we have a balanced traversal
        if (scopeLen !== this._lastScope.length) {
            throw 'Scopes are not matched';
        }
        this._lastScope.pop();

        if (node.nodeType == ParseNodeType.Function) {
            this._functionDepth--;
        } else if (node.nodeType == ParseNodeType.Class) {
            this._classDepth--;
        } else {
            throw 'unsupported scope type';
        }
    }

    override visitFunction(node: FunctionNode): boolean {
        this.docstringWriter.visitFunction(node);

        let stubs = this.docstringWriter.docstrings.get(node.id)!;
        let functionDoc = getDocString(node.suite.statements) || '';

        this.document.symbols.push(
            new lsiftyped.SymbolInformation({
                symbol: this.getLsifSymbol(node).value,
                documentation: ['```python\n' + stubs.join('\n') + '\n```', functionDoc],
            })
        );

        this.withScopeNode(node, () => {
            // Since we are manually handling various aspects, we need to make sure that we handle
            // - decorators
            // - name
            // - return type
            // - parameters
            node.decorators.forEach((decoratorNode) => this.walk(decoratorNode));
            this.visitName(node.name);
            if (node.returnTypeAnnotation) {
                this.walk(node.returnTypeAnnotation);
            }

            // Walk the parameters individually, with additional information about the function
            node.parameters.forEach((paramNode: ParameterNode) => {
                const symbol = this.getLsifSymbol(paramNode);

                // This pulls documentation of various styles from function docstring
                const paramDocstring = paramNode.name
                    ? extractParameterDocumentation(functionDoc, paramNode.name!.value)
                    : undefined;

                const paramDocumentation = paramDocstring ? [paramDocstring] : undefined;

                this.document.symbols.push(
                    new lsiftyped.SymbolInformation({
                        symbol: symbol.value,
                        documentation: paramDocumentation,
                    })
                );

                // Walk the parameter child nodes
                // TODO: Consider calling these individually so we can pass more metadata directly
                this.walk(paramNode);
            });

            // Walk the function definition
            this.walk(node.suite);
        });

        return false;
    }

    // `import requests`
    override visitImport(node: ImportNode): boolean {
        this.docstringWriter.visitImport(node);

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
                let symbol = this.getLsifSymbol(dec.node).value;
                this.document.occurrences.push(
                    new lsiftyped.Occurrence({
                        symbol_roles: lsiftyped.SymbolRole.Definition,
                        symbol: symbol,
                        range: nameNodeToRange(node, this.fileInfo!.lines).toLsif(),
                    })
                );

                return true;
            }

            // TODO: WriteAccess isn't really implemented yet on my side
            const symbol = this.declarationToSymbol(dec);
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
        if (false && canBeLocal(node) && scope.type != ScopeType.Builtin) {
            const newSymbol = LsifSymbol.local(this.counter.next());
            this.symbols.set(node.id, newSymbol);
            return newSymbol;
        }

        const newSymbol = this.makeLsifSymbol(node);
        this.symbols.set(node.id, newSymbol);

        return newSymbol;
    }

    private declarationToSymbol(declaration: Declaration): LsifSymbol {
        return this.getLsifSymbol(declaration.node);
    }

    private makeLsifSymbol(node: ParseNode): LsifSymbol {
        switch (node.nodeType) {
            case ParseNodeType.Module:
                // TODO: When we can get versions for different modules, we
                // should use that here to get the correction version (of the other module)
                return LsifSymbol.package(getFileInfo(node)!.moduleName, this.version);

            case ParseNodeType.Parameter:
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
                let cls = getEnclosingClass(node, false);
                if (cls) {
                    return LsifSymbol.global(
                        this.getLsifSymbol(cls),
                        methodDescriptor((node as FunctionNode).name!.value)
                    );
                }

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
                switch (node.valueExpression.nodeType) {
                    case ParseNodeType.Name:
                        return LsifSymbol.global(
                            this.getLsifSymbol(getEnclosingSuite(node) || node.parent!),
                            termDescriptor(node.valueExpression.value)
                        );
                    default:
                        throw 'Unhandled type annotation';
                }

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

            case ParseNodeType.Decorator:
                throw 'Should not handle decorator directly';

            case ParseNodeType.Assignment:
                console.log(
                    'Assignment:',
                    node.id,
                    this._lastScope.length,
                    LsifSymbol.package(getFileInfo(node)!.moduleName, this.version).value
                );

                if (this._lastScope.length === 0) {
                    return LsifSymbol.package(getFileInfo(node)!.moduleName, this.version);
                }

                // throw 'what';
                return LsifSymbol.local(this.counter.next());

            // Some nodes, it just makes sense to return whatever their parent is.
            case ParseNodeType.With:
                return this.getLsifSymbol(node.parent!);

            default:
                throw 'Unhandled: ' + node.nodeType;
        }
    }

    // Take a `Type` from pyright and turn that into an LSIF symbol.
    private typeToSymbol(node: NameNode, typeObj: Type): LsifSymbol {
        if (isFunction(typeObj)) {
            const decl = typeObj.details.declaration;
            if (!decl) {
                throw 'Unhandled missing declaration for type: function';
            }

            return LsifSymbol.global(LsifSymbol.package(decl.moduleName, this.version), methodDescriptor(node.value));
        } else if (isClass(typeObj)) {
            let sourceFile = typeObj.details.moduleName;
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
        return LsifSymbol.package(this.fileInfo!.moduleName, '0.0');
    }
}

function canBeLocal(node: ParseNode): boolean {
    return node.nodeType !== ParseNodeType.Parameter;
}
