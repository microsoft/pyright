/*
 * typeStubGeneration.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 *
 * Planning and semantic generation for type stub files.
 */

import { CancellationToken } from 'vscode-languageserver';

import { throwIfCancellationRequested } from '../common/cancellationUtils';
import { ConfigOptions } from '../common/configOptions';
import { ProgramView, SourceFileInfo } from '../common/extensibility';
import { ReadOnlyFileSystem } from '../common/fileSystem';
import { defaultStubsDirectory, stubsSuffix } from '../common/pathConsts';
import { Uri } from '../common/uri/uri';
import { isDirectory, isFile } from '../common/uri/uriUtils';
import { Tokenizer } from '../parser/tokenizer';
import { getInfoReader } from './analyzerNodeInfo';
import { ImportResolver, createImportedModuleDescriptor } from './importResolver';
import { renderTypeStubFile } from './typeStubRenderer';

export type GeneratedTypeStubFileKind = 'stub' | 'partialMarker';

export interface GeneratedTypeStubFile {
    uri: Uri;
    contents: string;
    kind: GeneratedTypeStubFileKind;
}

export interface TypeStubGenerationResult {
    files: readonly GeneratedTypeStubFile[];
}

export interface ResolvedTypeStubTarget {
    targetImportPath: Uri;
    targetIsSingleFile: boolean;
    outputPath: Uri;
    stubPath: Uri;
}

export interface TypeStubGenerationPlan {
    source: Omit<ResolvedTypeStubTarget, 'stubPath'>;
    additionalFiles: readonly GeneratedTypeStubFile[];
}

export function createTypeStubGenerationPlan(target: ResolvedTypeStubTarget): TypeStubGenerationPlan {
    return {
        source: {
            targetImportPath: target.targetImportPath,
            targetIsSingleFile: target.targetIsSingleFile,
            outputPath: target.outputPath,
        },
        additionalFiles: [],
    };
}

export function resolveTypeStubTarget(
    importResolver: ImportResolver,
    configOptions: ConfigOptions,
    importName: string,
    sourceFileUri?: Uri
): ResolvedTypeStubTargetWithSources {
    const moduleNameParts = validateImportName(importName);

    const fs = importResolver.fileSystem;
    const importResult = importResolver.resolveImport(
        Uri.empty(),
        configOptions.findExecEnvironment(sourceFileUri ?? configOptions.projectRoot),
        createImportedModuleDescriptor(importName)
    );
    if (!importResult.isImportFound) {
        throw new Error(`Import '${importName}' could not be resolved`);
    }

    const firstConcretePartIndex = importResult.resolvedUris.findIndex((uri) => !uri.isEmpty());
    if (firstConcretePartIndex < 0) {
        throw new Error(`Import '${importName}' resolves through a namespace package, which is not supported`);
    }

    const finalResolvedPath = importResult.resolvedUris[importResult.resolvedUris.length - 1];
    const isFinalPathFile = isFile(fs, finalResolvedPath);
    const isFinalPathInitFile = isFinalPathFile && finalResolvedPath.stripAllExtensions().fileName === '__init__';
    const targetIsSingleFile = importResult.resolvedUris.length === 1 && !isFinalPathInitFile;
    const firstConcretePath = importResult.resolvedUris[firstConcretePartIndex];
    const isFirstConcretePathFile = isFile(fs, firstConcretePath);
    const isFirstConcretePathInitFile =
        isFirstConcretePathFile && firstConcretePath.stripAllExtensions().fileName === '__init__';
    const targetImportPath =
        isFirstConcretePathInitFile || targetIsSingleFile ? firstConcretePath.getDirectory() : firstConcretePath;

    if (!isFile(fs, targetImportPath) && !isDirectory(fs, targetImportPath)) {
        throw new Error(`Import '${importName}' could not be resolved`);
    }

    const sourceFileUris: Uri[] = [];
    if (!finalResolvedPath.isEmpty()) {
        sourceFileUris.push(finalResolvedPath);
    }
    importResult.filteredImplicitImports?.forEach((implicitImport) => {
        if (ImportResolver.isSupportedImportSourceFile(implicitImport.uri)) {
            sourceFileUris.push(implicitImport.uri);
        }
    });

    const stubPath = getTypeStubPath(fs, configOptions);
    const outputPartCount = targetIsSingleFile ? 1 : firstConcretePartIndex + (isFirstConcretePathInitFile ? 1 : 0);
    return {
        outputPath: stubPath.resolvePaths(...moduleNameParts.slice(0, outputPartCount)),
        stubPath,
        targetImportPath,
        targetIsSingleFile,
        sourceFileUris,
    };
}

export interface PartialTypeStubGenerationOptions {
    importName: string;
    targetFileUri: Uri;
}

export class TypeStubGenerationConflictError extends Error {
    constructor(message: string, readonly uri: Uri) {
        super(message);
        this.name = 'TypeStubGenerationConflictError';
    }
}

export type TypeStubGenerationRequest =
    | {
          kind: 'full';
          importName: string;
          sourceFileUri?: Uri;
      }
    | {
          kind: 'partial';
          importName: string;
          sourceFileUri?: Uri;
          targetFileUri: Uri;
      };

export async function runTypeStubGeneration<TService extends TypeStubGenerationService, TResult>(
    createService: () => TService | Promise<TService>,
    request: TypeStubGenerationRequest,
    handleResult: (service: TService, result: TypeStubGenerationResult) => TResult | Promise<TResult>,
    token: CancellationToken
): Promise<TResult> {
    throwIfCancellationRequested(token);
    const service = await createService();

    try {
        let plan: TypeStubGenerationPlan;
        let sourceFileUris: readonly Uri[];
        if (request.kind === 'partial') {
            plan = createPartialTypeStubGenerationPlan(
                service.fs,
                getTypeStubPath(service.fs, service.getConfigOptions()),
                request
            );
            sourceFileUris = [request.targetFileUri];
        } else {
            const target = resolveTypeStubTarget(
                service.getImportResolver(),
                service.getConfigOptions(),
                request.importName,
                request.sourceFileUri
            );
            plan = createTypeStubGenerationPlan(target);
            sourceFileUris = collectTypeStubSourceFileUris(service.fs, target, token);
        }

        service.backgroundAnalysisProgram.setAllowedThirdPartyImports([request.importName]);
        service.backgroundAnalysisProgram.setTrackedFiles([...sourceFileUris]);
        const result = await service.backgroundAnalysisProgram.generateTypeStubFiles(plan, token);
        return await handleResult(service, result);
    } finally {
        service.dispose();
    }
}

export function collectTypeStubSourceFileUris(
    fs: ReadOnlyFileSystem,
    target: ResolvedTypeStubTargetWithSources,
    token: CancellationToken
): readonly Uri[] {
    throwIfCancellationRequested(token);
    return target.targetIsSingleFile || isFile(fs, target.targetImportPath)
        ? target.sourceFileUris
        : collectPackageSourceFileUris(fs, target.targetImportPath, token);
}

function collectPackageSourceFileUris(fs: ReadOnlyFileSystem, root: Uri, token: CancellationToken): readonly Uri[] {
    const sourceFileUrisByStubUri = new Map<string, Uri>();
    const pending = [root];
    while (pending.length > 0) {
        throwIfCancellationRequested(token);
        const directory = pending.pop()!;
        const entries = fs.readdirEntriesSync(directory).sort((left, right) => left.name.localeCompare(right.name));
        for (const entry of entries) {
            const uri = directory.resolvePaths(entry.name);
            if (entry.isDirectory()) {
                pending.push(uri);
            } else if (entry.isFile() && ImportResolver.isSupportedImportSourceFile(uri)) {
                const stubUriKey = uri.replaceExtension('.pyi').key;
                const existingSource = sourceFileUrisByStubUri.get(stubUriKey);
                if (
                    !existingSource ||
                    (existingSource.lastExtension.toLowerCase() !== '.pyi' &&
                        uri.lastExtension.toLowerCase() === '.pyi')
                ) {
                    sourceFileUrisByStubUri.set(stubUriKey, uri);
                }
            }
        }
    }
    return [...sourceFileUrisByStubUri.values()].sort((left, right) => left.toString().localeCompare(right.toString()));
}

export function createPartialTypeStubGenerationPlan(
    fs: ReadOnlyFileSystem,
    stubPath: Uri,
    options: PartialTypeStubGenerationOptions
): TypeStubGenerationPlan {
    const moduleNameParts = validateImportName(options.importName);
    const partialStubRoot = stubPath.resolvePaths(`${moduleNameParts[0]}${stubsSuffix}`);
    return {
        source: createPartialTypeStubSource(partialStubRoot, options),
        additionalFiles: createPartialStubMarker(fs, partialStubRoot),
    };
}

function getTypeStubPath(fs: ReadOnlyFileSystem, configOptions: ConfigOptions): Uri {
    return configOptions.stubPath ?? fs.realCasePath(configOptions.projectRoot.resolvePaths(defaultStubsDirectory));
}

function validateImportName(importName: string): string[] {
    const moduleNameParts = importName.split('.');
    if (moduleNameParts.some((part) => part.length === 0 || !Tokenizer.isPythonIdentifier(part))) {
        throw new Error(`Invalid import name: ${importName}`);
    }

    return moduleNameParts;
}

export function generateTypeStubFiles(
    program: ProgramView,
    plan: TypeStubGenerationPlan,
    token: CancellationToken
): TypeStubGenerationResult {
    const files: GeneratedTypeStubFile[] = [];
    const fileSystem = program.serviceProvider.fs();

    if (isFile(fileSystem, plan.source.targetImportPath)) {
        const sourceFileInfo = program.getSourceFileInfo(plan.source.targetImportPath);
        if (!sourceFileInfo) {
            throw new Error(`Could not find source file '${plan.source.targetImportPath.toUserVisibleString()}'`);
        }

        files.push(generateTypeStubFile(program, sourceFileInfo, sourceFileInfo.uri.fileName, plan, token));
    } else {
        for (const sourceFileInfo of program.getSourceFileInfoList()) {
            throwIfCancellationRequested(token);

            const relativePath = plan.source.targetImportPath.getRelativePath(sourceFileInfo.uri);
            if (relativePath !== undefined) {
                files.push(generateTypeStubFile(program, sourceFileInfo, relativePath, plan, token));
            }
        }
    }

    if (files.length === 0) {
        throw new Error(`No source files found for '${plan.source.targetImportPath.toUserVisibleString()}'`);
    }

    files.push(...plan.additionalFiles);
    return { files };
}

function generateTypeStubFile(
    program: ProgramView,
    sourceFileInfo: SourceFileInfo,
    relativePath: string,
    plan: TypeStubGenerationPlan,
    token: CancellationToken
): GeneratedTypeStubFile {
    throwIfCancellationRequested(token);
    program.analyzeFile(sourceFileInfo.uri, token);

    let stubUri = plan.source.outputPath.resolvePaths(relativePath);
    if (plan.source.targetIsSingleFile) {
        stubUri = stubUri.getDirectory().initPyiUri;
    } else {
        stubUri = stubUri.replaceExtension('.pyi');
    }

    const parseResults = program.getParseResults(sourceFileInfo.uri);
    if (!parseResults) {
        throw new Error(`Could not bind file '${sourceFileInfo.uri.toUserVisibleString()}' for stub generation`);
    }

    const evaluator = program.evaluator;
    if (!evaluator) {
        throw new Error('Type evaluator unavailable for stub generation');
    }

    const contents = renderTypeStubFile(stubUri, parseResults, evaluator, getInfoReader(program));
    program.handleMemoryHighUsage();
    return { uri: stubUri, contents, kind: 'stub' };
}

function createPartialTypeStubSource(
    partialStubRoot: Uri,
    options: PartialTypeStubGenerationOptions
): TypeStubGenerationPlan['source'] {
    const importNameParts = options.importName.split('.');
    const relativeImportParts = importNameParts.slice(1);
    const isPackage = options.targetFileUri.stripAllExtensions().fileName === '__init__';
    const relativeOutputPathParts = isPackage ? relativeImportParts : relativeImportParts.slice(0, -1);

    return {
        targetImportPath: options.targetFileUri,
        targetIsSingleFile: importNameParts.length === 1 && !isPackage,
        outputPath: partialStubRoot.resolvePaths(...relativeOutputPathParts),
    };
}

function createPartialStubMarker(fs: ReadOnlyFileSystem, partialStubRoot: Uri): readonly GeneratedTypeStubFile[] {
    const markerUri = partialStubRoot.pytypedUri;
    if (!fs.existsSync(markerUri)) {
        return [{ uri: markerUri, contents: 'partial\n', kind: 'partialMarker' }];
    }

    const contents = fs.statSync(markerUri).isFile() ? fs.readFileSync(markerUri, 'utf8') : undefined;
    if (contents !== 'partial\n' && contents !== 'partial\r\n') {
        throw new TypeStubGenerationConflictError(
            `Existing py.typed file '${markerUri.toUserVisibleString()}' is incompatible with partial stub generation`,
            markerUri
        );
    }

    return [];
}

export interface ResolvedTypeStubTargetWithSources extends ResolvedTypeStubTarget {
    sourceFileUris: readonly Uri[];
}

interface TypeStubGenerationService {
    readonly fs: ReadOnlyFileSystem;
    readonly backgroundAnalysisProgram: {
        setAllowedThirdPartyImports(imports: string[]): void;
        setTrackedFiles(files: Uri[]): void;
        generateTypeStubFiles(
            plan: TypeStubGenerationPlan,
            token: CancellationToken
        ): Promise<TypeStubGenerationResult>;
    };
    getImportResolver(): ImportResolver;
    getConfigOptions(): ConfigOptions;
    dispose(): void;
}
