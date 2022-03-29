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
import { lsiftyped, Options } from './lib';
import { SourceFile } from 'pyright-internal/analyzer/sourceFile';
import { Counter } from './lsif-typescript/Counter';
import { getTypeShedFallbackPath } from 'pyright-internal/analyzer/pythonPathUtils';
import { PyrightFileSystem } from 'pyright-internal/pyrightFileSystem';

export interface Config {}

export class Indexer {
    program: Program;
    importResolver: ImportResolver;
    counter: Counter;

    constructor(public readonly config: Config, public options: Options) {
        this.counter = new Counter();

        const configOptions = new ConfigOptions(options.projectRoot);
        configOptions.checkOnlyOpenFiles = false;
        configOptions.indexing = true;

        const fs = new PyrightFileSystem(createFromRealFileSystem());
        configOptions.typeshedPath = getTypeShedFallbackPath(fs);

        const host = new FullAccessHost(fs);
        this.importResolver = new ImportResolver(fs, configOptions, host);
        this.program = new Program(this.importResolver, configOptions);

        // TODO:
        // - [ ] pyi files?
        const pyFiles = glob.sync(options.projectRoot + '/**/*.py');
        this.program.setTrackedFiles(pyFiles);
    }

    public index(): void {
        const token = {
            isCancellationRequested: false,
            onCancellationRequested: Event.None,
        };

        // TODO: I don't understand how typescript & jest & webpack work together
        // so I don't know how to make sure that this always works (cause it fails when
        // I run it via jet but not via webpacked javascript and what not)
        let version = "0.0"
        try {
            version = require('package.json');
        } catch (e) {};


        // Emit metadata
        this.options.writeIndex(
            new lsiftyped.Index({
                metadata: new lsiftyped.Metadata({
                    project_root: url.pathToFileURL(this.options.workspaceRoot).toString(),
                    text_document_encoding: lsiftyped.TextEncoding.UTF8,
                    tool_info: new lsiftyped.ToolInfo({
                        name: 'lsif-pyright',
                        version,
                        arguments: [],
                    }),
                }),
            })
        );

        // Run program analysis once.
        while (this.program.analyze()) {}

        // let visitors: lib.codeintel.lsiftyped.Document[] = [];
        let projectSourceFiles: SourceFile[] = [];
        this.program.indexWorkspace((filepath: string, _results: IndexResults) => {
            // Filter out filepaths not part of this project
            if (filepath.indexOf(this.options.projectRoot) != 0) {
                return;
            }

            const sourceFile = this.program.getSourceFile(filepath)!;
            projectSourceFiles.push(sourceFile);

            let requestsImport = sourceFile.getImports();
            requestsImport.forEach((entry) =>
                entry.resolvedPaths.forEach((value) => {
                    this.program.addTrackedFile(value, true, false);
                })
            );
        }, token);

        // Mark every original sourceFile as dirty so that we can
        // visit them via the program again (with all dependencies noted)
        projectSourceFiles.forEach((sourceFile) => {
            sourceFile.markDirty(true);
        });

        while (this.program.analyze()) {}

        const typeEvaluator = this.program.evaluator!;
        projectSourceFiles.forEach((sourceFile) => {
            const filepath = sourceFile.getFilePath();
            let doc = new lsiftyped.Document({
                relative_path: path.relative(this.options.workspaceRoot, filepath),
            });

            const parseResults = sourceFile.getParseResults();
            const tree = parseResults?.parseTree!;

            let visitor = new TreeVisitor(doc, sourceFile, typeEvaluator, this.counter, this.options);
            visitor.walk(tree);

            this.options.writeIndex(
                new lsiftyped.Index({
                    documents: [doc],
                })
            );
        });
    }
}
