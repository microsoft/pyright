/*
* sourceFile.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
* Author: Eric Traut
*
* Class that represents a source file.
*/

import * as assert from 'assert';
import * as fs from 'fs';

import { ConfigOptions, ExecutionEnvironment } from '../common/configOptions';
import { ConsoleInterface, StandardConsole } from '../common/console';
import { Diagnostic, DiagnosticCategory, DiagnosticTextPosition, DocumentTextRange } from '../common/diagnostic';
import { DiagnosticSink, TextRangeDiagnosticSink } from '../common/diagnosticSink';
import { getFileName } from '../common/pathUtils';
import { timingStats } from '../common/timing';
import { ModuleNameNode, ModuleNode } from '../parser/parseNodes';
import { ParseOptions, Parser, ParseResults } from '../parser/parser';
import { AnalyzerFileInfo, ImportMap } from './analyzerFileInfo';
import { AnalyzerNodeInfo } from './analyzerNodeInfo';
import { DefinitionProvider } from './definitionProvider';
import { HoverProvider } from './hoverProvider';
import { ImportResolver } from './importResolver';
import { ImportResult } from './importResult';
import { ParseTreeCleanerWalker } from './parseTreeCleaner';
import { PostParseWalker } from './postParseWalker';
import { Scope } from './scope';
import { ModuleScopeAnalyzer } from './semanticAnalyzer';
import { TypeAnalyzer } from './typeAnalyzer';

export enum AnalysisPhase {
    Parse = 0,
    SemanticAnalysis = 1,
    TypeAnalysis = 2,

    FirstAnalysisPhase = SemanticAnalysis,
    LastAnalysisPhase = TypeAnalysis
}

// Represents a pending or completed parse or analysis operation.
export interface AnalysisJob {
    fileContentsVersion: number;
    nextPhaseToRun: AnalysisPhase;
    parseTreeNeedsCleaning: boolean;
    parseResults?: ParseResults;

    parseDiagnostics: Diagnostic[];
    semanticAnalysisDiagnostics: Diagnostic[];
    typeHintAnalysisDiagnostics: Diagnostic[];
    typeAnalysisLastPassDiagnostics: Diagnostic[];
    typeAnalysisFinalDiagnostics: Diagnostic[];

    typeAnalysisPassNumber: number;
    isTypeAnalysisPassNeeded: boolean;
    isTypeAnalysisFinalized: boolean;

    imports?: ImportResult[];
    builtinsImport?: ImportResult;
}

export class SourceFile {
    // Console interface to use for debugging.
    private _console: ConsoleInterface;

    // File path on disk.
    private readonly _filePath: string;

    // True if file is a type-hint (.pyi) file versus a python
    // (.py) file.
    private readonly _isStubFile: boolean;

    // True if the file is a typeshed stub file.
    private readonly _isTypeshedStubFile: boolean;

    // True if the file is the "typing.pyi" file, which needs
    // special-case handling.
    private readonly _isTypingStubFile: boolean;

    // True if the file is the "collections.pyi" file, which needs
    // special-case handling.
    private readonly _isCollectionsStubFile: boolean;

    // Latest analysis job that has completed at least one phase
    // of analysis.
    private _analysisJob: AnalysisJob = {
        fileContentsVersion: -1,
        nextPhaseToRun: AnalysisPhase.SemanticAnalysis,
        parseTreeNeedsCleaning: false,

        parseDiagnostics: [],
        semanticAnalysisDiagnostics: [],
        typeHintAnalysisDiagnostics: [],
        typeAnalysisLastPassDiagnostics: [],
        typeAnalysisFinalDiagnostics: [],

        typeAnalysisPassNumber: 1,
        isTypeAnalysisPassNeeded: true,
        isTypeAnalysisFinalized: false
    };

    // Number that is incremented every time the diagnostics
    // are updated.
    private _diagnosticVersion = 0;

    // Generation count of the file contents. When the contents
    // change, this is incremented.
    private _fileContentsVersion = 0;

    // Client's version of the file. Null implies that contents
    // need to be read from disk.
    private _clientVersion: number | null = null;

    // In-memory contents if sent from the language client. If
    // clientVersion is null, we'll ignore this and read the
    // contents from disk.
    private _fileContents: string | undefined;

    constructor(filePath: string, isTypeshedStubFile: boolean, console?: ConsoleInterface) {
        this._console = console || new StandardConsole();
        if (this._console) {
            // This is here to prevent the compiler from complaining
            // about an unused instance variable.
        }
        this._filePath = filePath;
        this._isStubFile = filePath.endsWith('.pyi');
        this._isTypeshedStubFile = isTypeshedStubFile;
        const fileName = getFileName(filePath);
        this._isTypingStubFile = this._isStubFile && (
            fileName === 'typing.pyi' || fileName === 'typing_extensions.pyi');
        this._isCollectionsStubFile = this._isStubFile &&
            this._filePath.endsWith('/collections/__init__.pyi');
    }

    getFilePath(): string {
        return this._filePath;
    }

    getDiagnosticVersion(): number {
        return this._diagnosticVersion;
    }

    // Returns a list of cached diagnostics from the latest analysis job.
    // If the prevVersion is specified, the method returns undefined if
    // the diagnostics haven't changed.
    getDiagnostics(options: ConfigOptions, prevDiagnosticVersion?: number): Diagnostic[] | undefined {
        if (this._diagnosticVersion === prevDiagnosticVersion) {
            return undefined;
        }

        let diagList: Diagnostic[] = [];
        diagList = diagList.concat(
            this._analysisJob.parseDiagnostics,
            this._analysisJob.semanticAnalysisDiagnostics,
            this._analysisJob.typeHintAnalysisDiagnostics,
            this._analysisJob.typeAnalysisFinalDiagnostics);

        if (this._isTypeshedStubFile) {
            if (options.reportTypeshedErrors === 'none') {
                return undefined;
            } else if (options.reportTypeshedErrors === 'warn') {
                // Convert all the errors to warnings.
                diagList = diagList.map(diag => {
                    if (diag.category === DiagnosticCategory.Error) {
                        return new Diagnostic(DiagnosticCategory.Warning,
                            diag.message, diag.range);
                    }
                    return diag;
                });
            }
        }

        return diagList;
    }

    getImports(): ImportResult[] {
        return this._analysisJob.imports || [];
    }

    getBuiltinsImport(): ImportResult | undefined {
        return this._analysisJob.builtinsImport;
    }

    markDirty(): void {
        this._fileContentsVersion++;
        this._analysisJob.isTypeAnalysisFinalized = false;
        this._analysisJob.nextPhaseToRun = AnalysisPhase.SemanticAnalysis;
    }

    markReanalysisRequired(): void {
        // Keep the parse info, but reset the analysis to the beginning.
        this._analysisJob.nextPhaseToRun = AnalysisPhase.SemanticAnalysis;
        this._analysisJob.parseTreeNeedsCleaning = true;
        this._analysisJob.isTypeAnalysisFinalized = false;
    }

    setClientVersion(version: number | null, contents: string): void {
        this._clientVersion = version;

        if (version === null) {
            this._fileContents = undefined;
        } else {
            if (this._fileContents !== undefined) {
                if (this._fileContents !== contents) {
                    this.markDirty();
                }
            }

            this._fileContents = contents;
        }
    }

    prepareForClose() {
        // Nothing to do currently.
    }

    isParseRequired() {
        return this._analysisJob.fileContentsVersion !== this._fileContentsVersion;
    }

    isSemanticAnalysisRequired() {
        return this._analysisJob.nextPhaseToRun <= AnalysisPhase.SemanticAnalysis;
    }

    isTypeAnalysisRequired() {
        // If the analysis is complete, no more analysis is required.
        if (this._analysisJob.nextPhaseToRun < AnalysisPhase.TypeAnalysis ||
                this._analysisJob.isTypeAnalysisPassNeeded) {
            return true;
        }

        return false;
    }

    isAnalysisFinalized() {
        return !this.isTypeAnalysisRequired() && this._analysisJob.isTypeAnalysisFinalized;
    }

    getParseResults(): ParseResults | undefined {
        if (!this.isParseRequired()) {
            return this._analysisJob.parseResults;
        }

        return undefined;
    }

    // Parse the file and update the state. Callers should wait for completion
    // (or at least cancel) prior to calling again. It returns true if a parse
    // was required and false if the parse information was up to date already.
    parse(configOptions: ConfigOptions): boolean {
        // If the file is already parsed, we can skip.
        if (!this.isParseRequired()) {
            return false;
        }

        let diagSink = new DiagnosticSink();
        let fileContents = this._fileContents;
        if (this._clientVersion === null) {
            try {
                timingStats.readFileTime.timeOperation(() => {
                    // Read the file's contents.
                    fileContents = fs.readFileSync(this._filePath, { encoding: 'utf8' });
                });
            } catch (error) {
                diagSink.addError(`Source file could not be read`);
                fileContents = '';
            }
        }

        // Use the configuration options to determine the environment in which
        // this source file will be executed.
        let execEnvironment = configOptions.findExecEnvironment(this._filePath);

        let parseOptions = new ParseOptions();
        if (this._filePath.endsWith('pyi')) {
            parseOptions.isStubFile = true;
        }
        parseOptions.pythonVersion = execEnvironment.pythonVersion;

        try {
            // Parse the token stream, building the abstract syntax tree.
            let parser = new Parser();
            let parseResults = parser.parseSourceFile(fileContents!, parseOptions, diagSink);

            // Convert the diagnostic sink into one that knows how to convert
            // to line numbers.
            let textRangeDiagSink = new TextRangeDiagnosticSink(parseResults.lines, diagSink.diagnostics);

            // Fill in the parent links and get the list of imports.
            let walker = new PostParseWalker(textRangeDiagSink, parseResults.parseTree, this._isStubFile);
            timingStats.postParseWalkerTime.timeOperation(() => {
                walker.analyze();
            });

            // Save information in the analysis job.
            this._analysisJob.fileContentsVersion = this._fileContentsVersion;
            this._analysisJob.nextPhaseToRun = AnalysisPhase.SemanticAnalysis;
            this._analysisJob.parseTreeNeedsCleaning = false;
            this._analysisJob.parseResults = parseResults;
            [this._analysisJob.imports, this._analysisJob.builtinsImport] =
                this._resolveImports(parseResults.parseTree,
                    walker.getImportedModules(), configOptions, execEnvironment);

            this._analysisJob.parseDiagnostics = diagSink.diagnostics;
            this._diagnosticVersion++;
        } catch (e) {
            let message: string;
            if (e instanceof Error) {
                message = e.message;
            } else {
                message = JSON.stringify(e);
            }

            this._console.log(
                `An internal error occurred while parsing ${ this.getFilePath() }: ` + message);
        }

        return true;
    }

    getDefinitionForPosition(position: DiagnosticTextPosition): DocumentTextRange | undefined {
        // If we have no completed analysis job, there's nothing to do.
        if (!this._analysisJob.parseResults) {
            return;
        }

        return DefinitionProvider.getDefinitionForPosition(
                this._analysisJob.parseResults, position);
    }

    getHoverForPosition(position: DiagnosticTextPosition): string | undefined {
        // If we have no completed analysis job, there's nothing to do.
        if (!this._analysisJob.parseResults) {
            return;
        }

        return HoverProvider.getHoverForPosition(
                this._analysisJob.parseResults, position);
    }

    setTypeAnalysisPassNeeded() {
        this._analysisJob.isTypeAnalysisPassNeeded = true;
        this._analysisJob.isTypeAnalysisFinalized = false;
    }

    doSemanticAnalysis(configOptions: ConfigOptions, builtinsScope?: Scope) {
        assert(!this.isParseRequired());
        assert(this.isSemanticAnalysisRequired());
        assert(this._analysisJob.parseResults);
        assert(this._analysisJob.nextPhaseToRun === AnalysisPhase.SemanticAnalysis);

        const fileInfo = this._buildFileInfo(configOptions, undefined, builtinsScope);

        try {
            this._cleanParseTreeIfRequired();

            // Perform semantic analysis.
            let scopeAnalyzer = new ModuleScopeAnalyzer(
                this._analysisJob.parseResults!.parseTree, fileInfo);
            timingStats.semanticAnalyzerTime.timeOperation(() => {
                scopeAnalyzer.analyze();
                this._analysisJob.semanticAnalysisDiagnostics = fileInfo.diagnosticSink.diagnostics;
                this._analysisJob.nextPhaseToRun = AnalysisPhase.TypeAnalysis;
                this._diagnosticVersion++;
            });

            // Prepare for the next stage of the analysis.
            this._analysisJob.typeAnalysisPassNumber = 1;
            this._analysisJob.isTypeAnalysisPassNeeded = true;
            this._analysisJob.isTypeAnalysisFinalized = false;
            this._analysisJob.nextPhaseToRun = AnalysisPhase.TypeAnalysis;
        } catch (e) {
            let message: string;
            if (e instanceof Error) {
                message = e.message;
            } else {
                message = JSON.stringify(e);
            }

            this._console.log(
                `An internal error occurred while analyzing ${ this.getFilePath() }: ` + message);
        }
    }

    doTypeAnalysis(configOptions: ConfigOptions, importMap: ImportMap) {
        assert(!this.isParseRequired());
        assert(!this.isSemanticAnalysisRequired());
        assert(this.isTypeAnalysisRequired());
        assert(this._analysisJob.parseResults);
        assert(this._analysisJob.nextPhaseToRun === AnalysisPhase.TypeAnalysis);

        const fileInfo = this._buildFileInfo(configOptions, importMap, undefined);

        try {
            // Perform static type analysis.
            let typeAnalyzer = new TypeAnalyzer(this._analysisJob.parseResults!.parseTree,
                fileInfo, this._analysisJob.typeAnalysisPassNumber);
            this._analysisJob.typeAnalysisPassNumber++;

            timingStats.typeAnalyzerTime.timeOperation(() => {
                // Repeatedly call the analyzer until everything converges.
                this._analysisJob.isTypeAnalysisPassNeeded = typeAnalyzer.analyze();
                this._analysisJob.typeAnalysisLastPassDiagnostics = fileInfo.diagnosticSink.diagnostics;
            });
        } catch (e) {
            let message: string;
            if (e instanceof Error) {
                message = e.message;
            } else {
                message = JSON.stringify(e);
            }

            this._console.log(
                `An internal error occurred while analyzing ${ this.getFilePath() }: ` + message);
        }
    }

    // This method should be called once type analysis has completed for
    // this file and all of its dependent files.
    finalizeAnalysis() {
        assert(!this.isTypeAnalysisRequired());

        // Mark the type analysis as final.
        this._analysisJob.isTypeAnalysisFinalized = true;

        // Finalize the diagnostics from the last pass of type analysis
        // so they become visible.
        this._analysisJob.typeAnalysisFinalDiagnostics =
            this._analysisJob.typeAnalysisLastPassDiagnostics;
        this._analysisJob.typeAnalysisLastPassDiagnostics = [];
        this._diagnosticVersion++;
    }

    private _buildFileInfo(configOptions: ConfigOptions, importMap?: ImportMap, builtinsScope?: Scope) {
        assert(this._analysisJob.parseResults !== undefined);
        let analysisDiagnostics = new TextRangeDiagnosticSink(this._analysisJob.parseResults!.lines);

        let fileInfo: AnalyzerFileInfo = {
            importMap: importMap || {},
            builtinsScope,
            diagnosticSink: analysisDiagnostics,
            executionEnvironment: configOptions.findExecEnvironment(this._filePath),
            configOptions,
            lines: this._analysisJob.parseResults!.lines,
            filePath: this._filePath,
            isStubFile: this._isStubFile,
            isTypingStubFile: this._isTypingStubFile,
            isCollectionsStubFile: this._isCollectionsStubFile,
            console: this._console
        };
        return fileInfo;
    }

    private _cleanParseTreeIfRequired() {
        if (this._analysisJob && this._analysisJob.parseResults) {
            if (this._analysisJob.parseTreeNeedsCleaning) {
                let cleanerWalker = new ParseTreeCleanerWalker(
                    this._analysisJob.parseResults.parseTree);
                cleanerWalker.clean();
                this._analysisJob.parseTreeNeedsCleaning = false;
            }
        }
    }

    private _resolveImports(moduleNode: ModuleNode, moduleNameNodes: ModuleNameNode[],
            configOptions: ConfigOptions, execEnv: ExecutionEnvironment):
            [ImportResult[], ImportResult?] {
        let imports: ImportResult[] = [];

        let resolver = new ImportResolver(this._filePath, configOptions, execEnv);

        // Always include an implicit import of the builtins module.
        let builtinsImportResult: ImportResult | undefined = resolver.resolveImport({
            leadingDots: 0,
            nameParts: ['builtins']
        });

        // Avoid importing builtins from the builtins.pyi file itself.
        if (builtinsImportResult.resolvedPaths.length === 0 ||
                builtinsImportResult.resolvedPaths[0] !== this.getFilePath()) {
            imports.push(builtinsImportResult);

            // Associate the builtins import with the module node so we can find it later.
            AnalyzerNodeInfo.setImportInfo(moduleNode, builtinsImportResult);
        } else {
            builtinsImportResult = undefined;
        }

        for (let moduleNameNode of moduleNameNodes) {
            let importResult = resolver.resolveImport({
                leadingDots: moduleNameNode.leadingDots,
                nameParts: moduleNameNode.nameParts.map(p => p.nameToken.value)
            });
            imports.push(importResult);

            AnalyzerNodeInfo.setImportInfo(moduleNameNode, importResult);
        }

        return [imports, builtinsImportResult];
    }
}
