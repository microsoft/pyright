import * as path from 'path';
import { Event } from 'vscode-languageserver/lib/common/api';

import { Program } from 'pyright-internal/analyzer/program';
import { ImportResolver } from 'pyright-internal/analyzer/importResolver';
import { createFromRealFileSystem } from 'pyright-internal/common/realFileSystem';
import { ConfigOptions } from 'pyright-internal/common/configOptions';
import { IndexResults } from 'pyright-internal/languageService/documentSymbolProvider';
import { TreeVisitor } from './treeVisitor';
import { FullAccessHost } from 'pyright-internal/common/fullAccessHost';
import { glob } from 'glob';
import * as url from 'url';
import { lsif_typed, Options } from './lib';
import { lib } from './lsif';

export interface Config {}

export class Indexer {
    program: Program;
    importResolver: ImportResolver;

    constructor(public readonly config: Config, public options: Options) {
        const fs = createFromRealFileSystem();
        fs.chdir(options.project)

        const configOptions = new ConfigOptions('.');
        configOptions.checkOnlyOpenFiles = false;
        configOptions.indexing = true;

        const host = new FullAccessHost(fs);
        this.importResolver = new ImportResolver(fs, configOptions, host);
        // importResolver.fileSystem.chdir(options.project)

        this.program = new Program(this.importResolver, configOptions);

        const pyFiles = glob.sync('**/*.py');
        this.program.setTrackedFiles(pyFiles);
    }

    public index(): void {
        // Emit metadata
        this.options.writeIndex(
            new lsif_typed.Index({
                metadata: new lsif_typed.Metadata({
                    // TODO: Might need to change project -> projectRoot
                    project_root: url.pathToFileURL(this.options.project).toString(),
                    tool_info: new lsif_typed.ToolInfo({
                        name: 'lsif-pyright',
                        // TODO: import __version__
                        version: require('package.json').version,
                        arguments: [],
                    }),
                }),
            })
        );

        while (this.program.analyze()) {}
        const typeEvaluator = this.program.evaluator;

        // let visitors: lib.codeintel.lsif_typed.Document[] = [];
        this.program.indexWorkspace(
            (filepath: string, _results: IndexResults) => {
                // this.importResolver.resolveImport(filepath, 
                const sourceFile = this.program.getSourceFile(filepath)!;
                // console.log("Source File", 

                let requestsImport = sourceFile.getImports().filter((i) => i.importName == "requests");
                console.log(requestsImport);
                requestsImport[0].resolvedPaths.forEach((value) => {
                  this.program.addTrackedFile(value, true, false);
                });
                this.program.analyze();


                const parseResults = sourceFile.getParseResults();
                const tree = parseResults?.parseTree;
                // sourceFile.getDeclarationForNode()

                let doc = new lsif_typed.Document({
                    relative_path: path.relative(this.options.projectRoot, filepath),
                });

                let visitor = new TreeVisitor(filepath, this.program, typeEvaluator!, doc);
                visitor.walk(tree!);

                this.options.writeIndex(
                    new lsif_typed.Index({
                        documents: [doc],
                    })
                );
            },
            {
                isCancellationRequested: false,
                onCancellationRequested: Event.None,
            }
        );
    }
}
