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
import { SourceFile } from 'pyright-internal/analyzer/sourceFile';

export interface Config {}

export class Indexer {
    program: Program;
    importResolver: ImportResolver;

    constructor(public readonly config: Config, public options: Options) {
        const fs = createFromRealFileSystem();
        fs.chdir(options.projectRoot);

        const configOptions = new ConfigOptions(options.projectRoot);
        configOptions.checkOnlyOpenFiles = false;
        configOptions.indexing = true;

        const host = new FullAccessHost(fs);
        this.importResolver = new ImportResolver(fs, configOptions, host);
        // importResolver.fileSystem.chdir(options.project)

        this.program = new Program(this.importResolver, configOptions);

        const pyFiles = glob.sync(options.projectRoot + '/**/*.py');
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
        // this.program.indexWorkspace((_a, _b) => {}, {
        //     isCancellationRequested: false,
        //     onCancellationRequested: Event.None,
        // });

        const typeEvaluator = this.program.evaluator;

        // let visitors: lib.codeintel.lsif_typed.Document[] = [];
        let sourceFiles: SourceFile[] = [];
        this.program.indexWorkspace(
            (filepath: string, _results: IndexResults) => {
                if (filepath.indexOf(this.options.projectRoot) != 0) {
                    return;
                }

                const sourceFile = this.program.getSourceFile(filepath)!;
                sourceFiles.push(sourceFile);

                console.log('Source File', filepath);

                let requestsImport = sourceFile.getImports();
                requestsImport.forEach((entry) =>
                    entry.resolvedPaths.forEach((value) => {
                        this.program.addTrackedFile(value, true, false);
                    })
                );

                // const parseResults = sourceFile.getParseResults();
                // const tree = parseResults?.parseTree;
                // // sourceFile.getDeclarationForNode()
                //
                //
                // let visitor = new TreeVisitor(filepath, this.program, typeEvaluator!, doc);
                // visitor.walk(tree!);
                //
            },
            {
                isCancellationRequested: false,
                onCancellationRequested: Event.None,
            }
        );

        console.log(
            'Source Files:',
            sourceFiles.map((value) => value.getFilePath())
        );

        sourceFiles.forEach((sourceFile) => {
            sourceFile.markDirty(true);
        });

        while (this.program.analyze()) {}

        sourceFiles.forEach((sourceFile) => {
            const filepath = sourceFile.getFilePath();
            let doc = new lsif_typed.Document({
                relative_path: path.relative(this.options.projectRoot, filepath),
            });

            const parseResults = sourceFile.getParseResults();
            const tree = parseResults?.parseTree;
            let visitor = new TreeVisitor(sourceFile.getFilePath(), this.program, typeEvaluator!, doc);
            visitor.walk(tree!);

            this.options.writeIndex(
                new lsif_typed.Index({
                    documents: [doc],
                })
            );
        });
    }
}
