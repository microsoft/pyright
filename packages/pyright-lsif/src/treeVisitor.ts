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
import { lsiftyped, Options } from './lib';
import {
    getDocString,
    getEnclosingClass,
    getEnclosingSuite,
    isFromImportModuleName,
    isImportModuleName,
} from 'pyright-internal/analyzer/parseTreeUtils';
import { ClassType, isClass, isClassInstance, isFunction, isUnknown, Type } from 'pyright-internal/analyzer/types';
import { getBuiltInScope, getScopeForNode } from 'pyright-internal/analyzer/scopeUtils';
import { ScopeType } from 'pyright-internal/analyzer/scope';
import { Counter } from './lsif-typescript/Counter';
import { TypeStubExtendedWriter } from './TypeStubExtendedWriter';
import { SourceFile } from 'pyright-internal/analyzer/sourceFile';
import { extractParameterDocumentation } from 'pyright-internal/analyzer/docStringUtils';
import { Declaration, isAliasDeclaration, isIntrinsicDeclaration } from 'pyright-internal/analyzer/declaration';

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
    public filepath: string;

    private fileInfo: AnalyzerFileInfo | undefined;
    private imports: Map<number, ParseNode>;
    private _symbols: Map<number, LsifSymbol>;

    private docstringWriter: TypeStubExtendedWriter;

    private _classDepth: number;
    private _functionDepth: number;
    private _lastScope: ParseNode[];

    constructor(
        public document: lsif.lib.codeintel.lsiftyped.Document,
        public sourceFile: SourceFile,
        private evaluator: TypeEvaluator,
        private counter: Counter,
        public options: Options
    ) {
        super();
        this.filepath = sourceFile.getFilePath();
        this._symbols = new Map();
        this.imports = new Map();

        this.docstringWriter = new TypeStubExtendedWriter(this.sourceFile, this.evaluator);

        this._classDepth = 0;
        this._functionDepth = 0;
        this._lastScope = [];
    }

    // private getNearestClass(): ClassNode | undefined {
    //     for (let i = this._lastScope.length - 1; i >= 0; i--) {
    //         if (this._lastScope[i].nodeType == ParseNodeType.Class) {
    //             return this._lastScope[i] as ClassNode;
    //         }
    //     }
    //
    //     return undefined;
    // }

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
            this.walk(node.name);
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
            for (const namePart of listNode.module.nameParts) {
                this.pushNewNameNodeOccurence(
                    namePart,
                    LsifSymbol.global(
                        LsifSymbol.global(LsifSymbol.empty(), packageDescriptor(namePart.value)),
                        metaDescriptor('__init__')
                    )
                );
            }
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
        console.log('visitName:', node.value, node.parent!.nodeType);

        const decls = this.evaluator.getDeclarationsForNameNode(node) || [];
        if (decls.length > 0) {
            const dec = decls[0];
            console.log('  Found Dec...');

            if (!dec.node) {
                return true;
            }
            console.log('  ... with node:', dec.node.id);

            // TODO: Handle intrinsics more usefully (using declaration probably)
            if (isIntrinsicDeclaration(dec)) {
                this.pushNewNameNodeOccurence(node, this.getBuiltinSymbol(node.value));
                return true;
            }

            if (this.imports.has(dec.node.id)) {
                // TODO: ExpressionNode cast is required?
                const evalutedType = this.evaluator.getType(dec.node as ExpressionNode);
                if (evalutedType) {
                    this.pushTypeReference(node, dec.node, evalutedType!);
                }

                return true;
            }

            // TODO: Write a more rigorous check for if this node is a
            // definition node. Probably some util somewhere already for
            // that (need to explore pyright some more)
            if (dec.node.id == node.parent!.id) {
                this.pushNewNameNodeOccurence(node, this.getLsifSymbol(dec.node), lsiftyped.SymbolRole.Definition);
                return true;
            }

            if (isAliasDeclaration(dec)) {
                this.pushNewNameNodeOccurence(node, this.getLsifSymbol(dec.node));
                return true;
            }

            if (dec.node.id == node.id) {
                const symbol = this.getLsifSymbol(dec.node);
                this.pushNewNameNodeOccurence(node, symbol, lsiftyped.SymbolRole.Definition);
                return true;
            }

            const existingLsifSymbol = this.rawGetLsifSymbol(dec.node);
            if (existingLsifSymbol) {
                console.log('Using existing');
                this.pushNewNameNodeOccurence(node, existingLsifSymbol, lsiftyped.SymbolRole.ReadAccess);
                return true;
            }

            // TODO: WriteAccess isn't really implemented yet on my side
            // Now this must be a reference, so let's reference the right thing.
            const symbol = this.getLsifSymbol(dec.node);
            this.pushNewNameNodeOccurence(node, symbol);
            return true;
        }

        if (node && (isImportModuleName(node) || isFromImportModuleName(node))) {
            console.log('we here');
            return true;
        }

        const builtinType = this.evaluator.getBuiltInType(node, node.value);
        if (!isUnknown(builtinType)) {
            // TODO: We're still missing documentation for builtin functions,
            // so that's a bit of a shame...

            if (isFunction(builtinType)) {
                this.document.symbols.push(
                    new lsiftyped.SymbolInformation({
                        symbol: this.getBuiltinSymbol(node.value).value,
                        documentation: [builtinType.details.docString || ''],
                    })
                );
            } else {
                this.pushNewNameNodeOccurence(node, this.getBuiltinSymbol(node.value));
            }

            return true;
        } else {
            let scope = getScopeForNode(node)!;
            let builtinScope = getBuiltInScope(scope);
        }

        return true;
    }

    private getBuiltinSymbol(name: string): LsifSymbol {
        // TODO: put builtin# the correct way (I don't think this is a good way to do the descriptor)
        return LsifSymbol.global(LsifSymbol.package('python', '3.9'), termDescriptor('builtins__' + name));
    }

    private rawGetLsifSymbol(node: ParseNode): LsifSymbol | undefined {
        return this._symbols.get(node.id);
    }

    private rawSetLsifSymbol(node: ParseNode, sym: LsifSymbol): void {
        this._symbols.set(node.id, sym);
    }

    private getLsifSymbol(node: ParseNode): LsifSymbol {
        const existing = this.rawGetLsifSymbol(node);
        if (existing) {
            return existing;
        }

        // not yet right, but good first approximation
        // const scope = getScopeForNode(node)!;
        // if (false && canBeLocal(node) && scope.type != ScopeType.Builtin) {
        //     // const newSymbol = LsifSymbol.local(this.counter.next());
        //     // this._symbols.set(node.id, newSymbol);
        //     // return newSymbol;
        // }

        let newSymbol = this.makeLsifSymbol(node);
        this.rawSetLsifSymbol(node, newSymbol);

        return newSymbol;
    }

    private makeLsifSymbol(node: ParseNode): LsifSymbol {
        switch (node.nodeType) {
            case ParseNodeType.Module:
                const moduleName = getFileInfo(node)!.moduleName;
                if (moduleName == 'builtins') {
                    // TODO: Should get the correct python version for the project here
                    return LsifSymbol.package(moduleName, '3.9');
                }

                // TODO: When we can get versions for different modules, we
                // should use that here to get the correction version (of the other module)
                return LsifSymbol.package(moduleName, this.options.projectVersion);

            case ParseNodeType.MemberAccess:
                throw 'oh ya';

            case ParseNodeType.Parameter:
                if (!node.name) {
                    console.warn('TODO: Paramerter with no name', node);
                    return LsifSymbol.local(this.counter.next());
                }

                return LsifSymbol.global(this.getLsifSymbol(node.parent!), parameterDescriptor(node.name.value));

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

            case ParseNodeType.Decorator:
                throw 'Should not handle decorator directly';

            case ParseNodeType.Assignment:
                // Handle if this variable is in the global scope or not
                // Hard to say for sure (might need to use builtinscope for that?)
                if (this._lastScope.length === 0) {
                    return LsifSymbol.package(getFileInfo(node)!.moduleName, this.options.projectVersion);
                }

                if (this._functionDepth > 0) {
                    // TODO: Check this
                }

                // throw 'what';
                return LsifSymbol.local(this.counter.next());

            // TODO: Handle imports better
            // TODO: `ImportAs` is pretty broken it looks like
            case ParseNodeType.ImportAs:
                console.log(node);
                // @ts-ignore Pretty sure this always is true
                let info = node.module.importInfo;
                return LsifSymbol.global(
                    LsifSymbol.package(info.importName, this.getVersion(info.importName)),
                    metaDescriptor('__init__')
                );

            case ParseNodeType.ImportFrom:
                console.log('from', node);
                return LsifSymbol.empty();

            case ParseNodeType.ImportFromAs:
                console.log('from as', node);
                return LsifSymbol.empty();

            // Some nodes, it just makes sense to return whatever their parent is.
            case ParseNodeType.With:
            case ParseNodeType.If:
            case ParseNodeType.For:
            // To explore:
            case ParseNodeType.StatementList:
            case ParseNodeType.Tuple:
            case ParseNodeType.ListComprehension:
            case ParseNodeType.ListComprehensionFor:
            case ParseNodeType.ListComprehensionIf:
            case ParseNodeType.Argument:
            case ParseNodeType.BinaryOperation:
                // There is some confusion for me about whether we should do this
                // vs the other idea...
                // return LsifSymbol.empty();

                return this.getLsifSymbol(node.parent!);

            default:
                // throw `Unhandled: ${node.nodeType}\n`;
                console.warn(`Unhandled: ${node.nodeType}`);
                if (!node.parent) {
                    return LsifSymbol.local(this.counter.next());
                }

                return this.getLsifSymbol(node.parent!);
        }
    }

    // Take a `Type` from pyright and turn that into an LSIF symbol.
    private typeToSymbol(node: NameNode, typeObj: Type): LsifSymbol {
        if (isFunction(typeObj)) {
            const decl = typeObj.details.declaration;
            if (!decl) {
                // throw 'Unhandled missing declaration for type: function';
                console.warn('Missing Function Decl:', node.token.value, typeObj);
                return LsifSymbol.local(this.counter.next());
            }

            return LsifSymbol.global(
                LsifSymbol.package(decl.moduleName, this.options.projectVersion),
                methodDescriptor(node.value)
            );
        } else if (isClass(typeObj)) {
            return LsifSymbol.global(
                LsifSymbol.package(typeObj.details.moduleName, this.options.projectVersion),
                typeDescriptor(node.value)
            );
        } else if (isClassInstance(typeObj)) {
            typeObj = typeObj as ClassType;
            // return LsifSymbol.global(this.getLsifSymbol(decl.node), Descriptor.term(node.value)).value;
        }

        // throw 'unreachable typeObj';
        // const mod = LsifSymbol.sourceFile(this.getPackageSymbol(), [this.fileInfo!.moduleName]);
        // const mod = LsifSymbol.global(this.getPackageSymbol(), packageDescriptor(this.fileInfo!.moduleName));
        // return LsifSymbol.global(mod, termDescriptor(node.value));
        console.warn(`Unreachable TypeObj: ${node.value}: ${typeObj.category}`);
        return LsifSymbol.local(this.counter.next());
    }

    // TODO: Could maybe just remove this now.
    private pushTypeReference(node: NameNode, declNode: ParseNode, typeObj: Type): void {
        const symbol = this.typeToSymbol(node, typeObj);
        this.rawSetLsifSymbol(declNode, symbol);
        this.pushNewNameNodeOccurence(node, symbol);
    }

    // Might be the only way we can add new occurrences?
    private pushNewNameNodeOccurence(
        node: NameNode,
        symbol: LsifSymbol,
        role: number = lsiftyped.SymbolRole.ReadAccess
    ): void {
        if (symbol.value.trim() != symbol.value) {
            console.trace(`Invalid symbol dude ${node.value} -> ${symbol.value}`);
        }

        this.document.occurrences.push(
            new lsiftyped.Occurrence({
                symbol_roles: role,
                symbol: symbol.value,
                range: nameNodeToRange(node, this.fileInfo!.lines).toLsif(),
            })
        );
    }

    private getVersion(_moduleName: string): string {
        return this.options.projectVersion;
    }
}

function canBeLocal(node: ParseNode): boolean {
    return node.nodeType !== ParseNodeType.Parameter;
}
