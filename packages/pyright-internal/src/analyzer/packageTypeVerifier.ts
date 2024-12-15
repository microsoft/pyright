/*
 * packageTypeVerifier.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Validates the public symbols exported by a package to ensure
 * that the types are complete.
 */

import { CommandLineOptions } from '../common/commandLineOptions';
import { ConfigOptions, ExecutionEnvironment } from '../common/configOptions';
import { NullConsole } from '../common/console';
import { assert } from '../common/debug';
import { Diagnostic, DiagnosticAddendum, DiagnosticCategory } from '../common/diagnostic';
import { FullAccessHost } from '../common/fullAccessHost';
import { Host } from '../common/host';
import { getFileExtension, stripFileExtension } from '../common/pathUtils';
import { ServiceProvider } from '../common/serviceProvider';
import { getEmptyRange, Range } from '../common/textRange';
import { Uri } from '../common/uri/uri';
import { tryStat } from '../common/uri/uriUtils';
import { DeclarationType, FunctionDeclaration, VariableDeclaration } from './declaration';
import { createImportedModuleDescriptor, ImportResolver } from './importResolver';
import {
    AlternateSymbolNameMap,
    getEmptyReport,
    ModuleInfo,
    PackageTypeReport,
    SymbolCategory,
    SymbolInfo,
    TypeKnownStatus,
} from './packageTypeReport';
import { Program } from './program';
import { getPyTypedInfo, PyTypedInfo } from './pyTypedUtils';
import { ScopeType } from './scope';
import { getScopeForNode } from './scopeUtils';
import { Symbol, SymbolTable } from './symbol';
import { isDunderName, isPrivateOrProtectedName } from './symbolNameUtils';
import {
    ClassType,
    FunctionParam,
    FunctionType,
    FunctionTypeFlags,
    isClass,
    isFunction,
    isInstantiableClass,
    isModule,
    isTypeSame,
    isUnknown,
    ModuleType,
    OverloadedType,
    Type,
    TypeBase,
    TypeCategory,
} from './types';
import {
    doForEachSubtype,
    getFullNameOfType,
    isDescriptorInstance,
    isEllipsisType,
    isPartlyUnknown,
    partiallySpecializeType,
    specializeForBaseClass,
} from './typeUtils';

type PublicSymbolSet = Set<string>;

interface ModuleDirectoryInfo {
    moduleDirectory: Uri;
    isModuleSingleFile: boolean;
}

export class PackageTypeVerifier {
    private _configOptions: ConfigOptions;
    private _execEnv: ExecutionEnvironment;
    private _importResolver: ImportResolver;
    private _program: Program;

    constructor(
        private _serviceProvider: ServiceProvider,
        private _host: Host,
        commandLineOptions: CommandLineOptions,
        private _packageName: string,
        private _ignoreExternal = false
    ) {
        const host = new FullAccessHost(_serviceProvider);
        this._configOptions = new ConfigOptions(Uri.empty());
        const console = new NullConsole();

        // Make sure we have a default python platform and version.
        // Allow the command-line parameters to override the normal defaults.
        if (commandLineOptions.configSettings.pythonPlatform) {
            this._configOptions.defaultPythonPlatform = commandLineOptions.configSettings.pythonPlatform;
        } else {
            this._configOptions.ensureDefaultPythonPlatform(host, console);
        }

        if (commandLineOptions.configSettings.pythonVersion) {
            this._configOptions.defaultPythonVersion = commandLineOptions.configSettings.pythonVersion;
        } else {
            this._configOptions.ensureDefaultPythonVersion(host, console);
        }

        if (_ignoreExternal) {
            this._configOptions.evaluateUnknownImportsAsAny = true;
        }

        this._execEnv = this._configOptions.findExecEnvironment(Uri.file('.', _serviceProvider));
        this._importResolver = new ImportResolver(this._serviceProvider, this._configOptions, this._host);
        this._program = new Program(this._importResolver, this._configOptions, this._serviceProvider);
    }

    verify(): PackageTypeReport {
        const trimmedModuleName = this._packageName.trim();
        const moduleNameParts = trimmedModuleName.split('.');

        const packageDirectoryInfo = this._getDirectoryInfoForModule(moduleNameParts[0]);
        const moduleDirectoryInfo = this._getDirectoryInfoForModule(trimmedModuleName);

        const report = getEmptyReport(
            moduleNameParts[0],
            packageDirectoryInfo?.moduleDirectory ?? Uri.empty(),
            trimmedModuleName,
            moduleDirectoryInfo?.moduleDirectory ?? Uri.empty(),
            moduleDirectoryInfo?.isModuleSingleFile ?? false,
            this._ignoreExternal
        );
        const commonDiagnostics = report.generalDiagnostics;

        try {
            if (!trimmedModuleName) {
                commonDiagnostics.push(
                    new Diagnostic(
                        DiagnosticCategory.Error,
                        `Module name "${trimmedModuleName}" is invalid`,
                        getEmptyRange()
                    )
                );
            } else if (!report.moduleRootDirectoryUri) {
                commonDiagnostics.push(
                    new Diagnostic(
                        DiagnosticCategory.Error,
                        `Module "${trimmedModuleName}" cannot be resolved`,
                        getEmptyRange()
                    )
                );
            } else {
                let pyTypedInfo: PyTypedInfo | undefined;
                if (report.moduleRootDirectoryUri) {
                    pyTypedInfo = this._getDeepestPyTypedInfo(report.moduleRootDirectoryUri, moduleNameParts);
                }

                // If we couldn't find any "py.typed" info in the module path, search again
                // starting at the package root.
                if (!pyTypedInfo && report.packageRootDirectoryUri) {
                    pyTypedInfo = this._getDeepestPyTypedInfo(report.packageRootDirectoryUri, moduleNameParts);
                }

                if (!pyTypedInfo) {
                    commonDiagnostics.push(
                        new Diagnostic(DiagnosticCategory.Error, 'No py.typed file found', getEmptyRange())
                    );
                } else {
                    report.pyTypedPathUri = pyTypedInfo.pyTypedPath;

                    const publicModules = this._getListOfPublicModules(
                        report.moduleRootDirectoryUri,
                        report.isModuleSingleFile,
                        trimmedModuleName
                    );

                    // If the filter eliminated all modules, report an error.
                    if (publicModules.length === 0) {
                        commonDiagnostics.push(
                            new Diagnostic(
                                DiagnosticCategory.Error,
                                `Module "${trimmedModuleName}" cannot be resolved`,
                                getEmptyRange()
                            )
                        );
                    }

                    // Build a set of all public symbols exported by this package. We'll
                    // use this map to determine which diagnostics to report. We don't want
                    // to report diagnostics many times for types that include public types.
                    const publicSymbols = new Set<string>();
                    publicModules.forEach((moduleName) => {
                        this._getPublicSymbolsForModule(moduleName, publicSymbols, report.alternateSymbolNames);
                    });

                    publicModules.forEach((moduleName) => {
                        this._verifyTypesOfModule(moduleName, publicSymbols, report);
                    });
                }
            }
        } catch (e: any) {
            const message: string =
                (e.stack ? e.stack.toString() : undefined) ||
                (typeof e.message === 'string' ? e.message : undefined) ||
                JSON.stringify(e);
            commonDiagnostics.push(
                new Diagnostic(
                    DiagnosticCategory.Error,
                    `An internal error occurred while verifying types: "${message}"`,
                    getEmptyRange()
                )
            );
        }

        return report;
    }

    static getSymbolCategoryString(symbolType: SymbolCategory): string {
        switch (symbolType) {
            case SymbolCategory.Class:
                return 'class';

            case SymbolCategory.Function:
                return 'function';

            case SymbolCategory.Method:
                return 'method';

            case SymbolCategory.Constant:
                return 'constant';

            case SymbolCategory.Variable:
                return 'variable';

            case SymbolCategory.Module:
                return 'module';

            case SymbolCategory.TypeAlias:
                return 'type alias';

            case SymbolCategory.TypeVar:
                return 'type variable';

            case SymbolCategory.Indeterminate:
                return 'symbol';
        }
    }

    private _getDeepestPyTypedInfo(rootDirectory: Uri, packageNameParts: string[]) {
        let subNameParts = Array.from(packageNameParts);

        // Find the deepest py.typed file that corresponds to the requested submodule.
        while (subNameParts.length >= 1) {
            const packageSubdir = rootDirectory.combinePaths(...subNameParts.slice(1));
            const pyTypedInfo = getPyTypedInfo(this._serviceProvider.fs(), packageSubdir);
            if (pyTypedInfo) {
                return pyTypedInfo;
            }

            subNameParts = subNameParts.slice(0, subNameParts.length - 1);
        }

        return undefined;
    }

    private _resolveImport(moduleName: string) {
        return this._importResolver.resolveImport(
            Uri.empty(),
            this._execEnv,
            createImportedModuleDescriptor(moduleName)
        );
    }

    private _getPublicSymbolsForModule(
        moduleName: string,
        publicSymbols: PublicSymbolSet,
        alternateSymbolNames: AlternateSymbolNameMap
    ) {
        const importResult = this._resolveImport(moduleName);

        if (importResult.isImportFound) {
            const modulePath = importResult.resolvedUris[importResult.resolvedUris.length - 1];
            this._program.addTrackedFiles([modulePath], /* isThirdPartyImport */ true, /* isInPyTypedPackage */ true);

            const sourceFile = this._program.getBoundSourceFile(modulePath);

            if (sourceFile) {
                const module: ModuleInfo = {
                    name: moduleName,
                    uri: modulePath,
                    isExported: true,
                };

                const parseTree = sourceFile.getParserOutput()!.parseTree;
                const moduleScope = getScopeForNode(parseTree)!;

                this._getPublicSymbolsInSymbolTable(
                    publicSymbols,
                    alternateSymbolNames,
                    module,
                    module.name,
                    moduleScope.symbolTable,
                    ScopeType.Module
                );
            }
        }
    }

    private _getPublicSymbolsInSymbolTable(
        publicSymbols: PublicSymbolSet,
        alternateSymbolNames: AlternateSymbolNameMap,
        module: ModuleInfo,
        scopeName: string,
        symbolTable: SymbolTable,
        scopeType: ScopeType
    ) {
        symbolTable.forEach((symbol, name) => {
            if (
                !isPrivateOrProtectedName(name) &&
                !symbol.isIgnoredForProtocolMatch() &&
                !this._isSymbolTypeImplied(scopeType, name)
            ) {
                const fullName = `${scopeName}.${name}`;

                if (!symbol.isExternallyHidden() && !symbol.isPrivateMember() && !symbol.isPrivatePyTypedImport()) {
                    const symbolType = this._program.getTypeOfSymbol(symbol);
                    publicSymbols.add(fullName);

                    const typedDecls = symbol.getTypedDeclarations();

                    if (typedDecls.length > 0) {
                        // Is this a class declared within this module or class?
                        // If so, add the symbols declared within it.
                        const classDecl = typedDecls.find((decl) => decl.type === DeclarationType.Class);
                        if (classDecl) {
                            if (isInstantiableClass(symbolType)) {
                                this._getPublicSymbolsInSymbolTable(
                                    publicSymbols,
                                    alternateSymbolNames,
                                    module,
                                    fullName,
                                    ClassType.getSymbolTable(symbolType),
                                    ScopeType.Class
                                );
                            }
                        }
                    }

                    // Is this the re-export of an import? If so, record the alternate name.
                    const importDecl = symbol.getDeclarations().find((decl) => decl.type === DeclarationType.Alias);
                    if (importDecl && importDecl.type === DeclarationType.Alias) {
                        const typeName = getFullNameOfType(this._program.getTypeOfSymbol(symbol));
                        if (typeName) {
                            this._addAlternateSymbolName(alternateSymbolNames, typeName, fullName);
                        }
                    }
                }
            }
        });
    }

    private _addAlternateSymbolName(map: AlternateSymbolNameMap, name: string, altName: string) {
        if (name !== altName) {
            let altNameList = map.get(name);

            if (!altNameList) {
                altNameList = [];
                map.set(name, altNameList);
            }

            // Add the alternate name if it's unique.
            if (!altNameList.some((name) => name === altName)) {
                altNameList.push(altName);
            }
        }
    }

    private _verifyTypesOfModule(moduleName: string, publicSymbols: PublicSymbolSet, report: PackageTypeReport) {
        const importResult = this._resolveImport(moduleName);
        if (!importResult.isImportFound) {
            report.generalDiagnostics.push(
                new Diagnostic(DiagnosticCategory.Error, `Could not resolve module "${moduleName}"`, getEmptyRange())
            );
        } else if (importResult.isStubPackage) {
            report.generalDiagnostics.push(
                new Diagnostic(
                    DiagnosticCategory.Error,
                    `No inlined types found for module "${moduleName}" because stub package was present`,
                    getEmptyRange()
                )
            );
        } else {
            const modulePath = importResult.resolvedUris[importResult.resolvedUris.length - 1];

            const module: ModuleInfo = {
                name: moduleName,
                uri: modulePath,
                isExported: true,
            };

            report.modules.set(modulePath.key, module);
            this._program.addTrackedFiles([modulePath], /* isThirdPartyImport */ true, /* isInPyTypedPackage */ true);

            const sourceFile = this._program.getBoundSourceFile(modulePath);

            if (sourceFile) {
                const parseTree = sourceFile.getParserOutput()!.parseTree;
                const moduleScope = getScopeForNode(parseTree)!;

                this._getTypeKnownStatusForSymbolTable(
                    report,
                    module.name,
                    moduleScope.symbolTable,
                    ScopeType.Module,
                    publicSymbols
                );
            } else {
                report.generalDiagnostics.push(
                    new Diagnostic(DiagnosticCategory.Error, `Could not bind file "${modulePath}"`, getEmptyRange())
                );
            }
        }
    }

    // Scans the directory structure for a list of public modules
    // within the package.
    private _getListOfPublicModules(moduleRoot: Uri, isModuleSingleFile: boolean, moduleName: string): string[] {
        const publicModules: string[] = [];
        this._addPublicModulesRecursive(moduleRoot, isModuleSingleFile, moduleName, publicModules);

        // Make sure modules are unique. There may be duplicates if a ".py" and ".pyi"
        // exist for some modules.
        const uniqueModules: string[] = [];
        const moduleMap = new Map<string, string>();

        publicModules.forEach((module) => {
            if (!moduleMap.has(module)) {
                uniqueModules.push(module);
                moduleMap.set(module, module);
            }
        });

        return uniqueModules;
    }

    private _addPublicModulesRecursive(
        dirPath: Uri,
        isModuleSingleFile: boolean,
        modulePath: string,
        publicModules: string[]
    ) {
        const dirEntries = this._serviceProvider.fs().readdirEntriesSync(dirPath);

        dirEntries.forEach((entry) => {
            let isFile = entry.isFile();
            let isDirectory = entry.isDirectory();
            if (entry.isSymbolicLink()) {
                const stat = tryStat(this._serviceProvider.fs(), dirPath.combinePaths(entry.name));
                if (stat) {
                    isFile = stat.isFile();
                    isDirectory = stat.isDirectory();
                }
            }

            if (isFile) {
                const fileExtension = getFileExtension(entry.name);

                if (fileExtension === '.py' || fileExtension === '.pyi') {
                    const nameWithoutExtension = stripFileExtension(entry.name);

                    if (nameWithoutExtension === '__init__') {
                        if (!isModuleSingleFile) {
                            publicModules.push(modulePath);
                        }
                    } else {
                        if (
                            !isPrivateOrProtectedName(nameWithoutExtension) &&
                            this._isLegalModulePartName(nameWithoutExtension)
                        ) {
                            if (isModuleSingleFile) {
                                if (modulePath.endsWith(`.${nameWithoutExtension}`)) {
                                    publicModules.push(modulePath);
                                }
                            } else {
                                publicModules.push(`${modulePath}.${nameWithoutExtension}`);
                            }
                        }
                    }
                }
            } else if (isDirectory && !isModuleSingleFile) {
                if (!isPrivateOrProtectedName(entry.name) && this._isLegalModulePartName(entry.name)) {
                    this._addPublicModulesRecursive(
                        dirPath.combinePaths(entry.name),
                        isModuleSingleFile,
                        `${modulePath}.${entry.name}`,
                        publicModules
                    );
                }
            }
        });
    }

    private _isLegalModulePartName(name: string): boolean {
        // PEP8 indicates that all module names should be lowercase
        // with underscores. It doesn't talk about non-ASCII
        // characters, but it appears that's the convention.
        return !!name.match(/[a-z_]+/);
    }

    private _shouldIgnoreType(report: PackageTypeReport, fullTypeName: string) {
        // If we're ignoring unknown types from other packages, see if we should skip.
        return report.ignoreExternal && !fullTypeName.startsWith(report.packageName);
    }

    private _getTypeKnownStatusForSymbolTable(
        report: PackageTypeReport,
        scopeName: string,
        symbolTable: SymbolTable,
        scopeType: ScopeType,
        publicSymbols: PublicSymbolSet,
        overrideSymbolCallback?: (name: string, symbol: Symbol) => Type | undefined
    ): TypeKnownStatus {
        if (this._shouldIgnoreType(report, scopeName)) {
            return TypeKnownStatus.Known;
        }

        let knownStatus = TypeKnownStatus.Known;

        symbolTable.forEach((symbol, name) => {
            if (
                !isPrivateOrProtectedName(name) &&
                !symbol.isExternallyHidden() &&
                !symbol.isPrivateMember() &&
                !symbol.isPrivatePyTypedImport() &&
                !symbol.isIgnoredForProtocolMatch() &&
                !this._isSymbolTypeImplied(scopeType, name)
            ) {
                const fullName = `${scopeName}.${name}`;

                // If the symbol was already cached, update its reference count
                // and skip the rest.
                const cachedSymbolInfo = report.symbols.get(fullName);
                if (cachedSymbolInfo) {
                    cachedSymbolInfo.referenceCount++;
                    return;
                }

                let symbolType = this._program.getTypeOfSymbol(symbol);

                let usesAmbiguousOverride = false;
                let baseSymbolType: Type | undefined;
                let childSymbolType: Type | undefined;

                if (overrideSymbolCallback) {
                    const baseSymbolType = overrideSymbolCallback(name, symbol);

                    if (baseSymbolType) {
                        childSymbolType = symbolType;

                        // If the inferred type is ambiguous or the declared base class type is
                        // not the same type as the inferred type, mark it as ambiguous because
                        // different type checkers will get different results.
                        if (TypeBase.isAmbiguous(childSymbolType) || !isTypeSame(baseSymbolType, childSymbolType)) {
                            // If the base type is known to be a descriptor with a setter,
                            // assume that the child class is simply writing to the base class's setter.
                            if (!isDescriptorInstance(baseSymbolType, /* requireSetter */ true)) {
                                usesAmbiguousOverride = true;
                            }
                        }

                        symbolType = baseSymbolType;
                    }
                }

                const typedDecls = symbol.getTypedDeclarations();
                const primaryDecl = typedDecls.length > 0 ? typedDecls[typedDecls.length - 1] : undefined;
                let symbolInfo: SymbolInfo;

                if (primaryDecl?.type === DeclarationType.Class && isInstantiableClass(symbolType)) {
                    symbolInfo = this._getSymbolForClass(report, symbolType, publicSymbols);
                } else if (primaryDecl?.type === DeclarationType.Alias && isModule(symbolType)) {
                    symbolInfo = this._getSymbolForModule(report, symbolType, publicSymbols);
                } else {
                    const decls = symbol.getDeclarations();
                    const primaryDecl = decls.length > 0 ? decls[decls.length - 1] : undefined;
                    const declRange = primaryDecl?.range || getEmptyRange();
                    const declPath = primaryDecl?.uri || Uri.empty();
                    const symbolCategory = this._getSymbolCategory(symbol, symbolType);
                    const isExported = publicSymbols.has(fullName);

                    // If the only reference to this symbol is a "__slots__" entry, we will
                    // skip it when considering type completeness.
                    if (
                        decls.length === 1 &&
                        primaryDecl?.type === DeclarationType.Variable &&
                        primaryDecl.isDefinedBySlots
                    ) {
                        return;
                    }

                    symbolInfo = {
                        category: symbolCategory,
                        name,
                        fullName,
                        fileUri: declPath,
                        isExported,
                        typeKnownStatus: TypeKnownStatus.Known,
                        referenceCount: 1,
                        diagnostics: [],
                        scopeType,
                    };

                    this._addSymbol(report, symbolInfo);

                    if (primaryDecl) {
                        let resolvedDecl = primaryDecl;
                        if (resolvedDecl.type === DeclarationType.Alias) {
                            resolvedDecl =
                                this._program.evaluator?.resolveAliasDeclaration(
                                    resolvedDecl,
                                    /* resolveLocalNames */ true
                                ) ?? resolvedDecl;
                        }

                        if (resolvedDecl.type === DeclarationType.Class && isClass(symbolType)) {
                            this._reportMissingClassDocstring(symbolInfo, symbolType, report);
                        }

                        if (resolvedDecl.type === DeclarationType.Function && isFunction(symbolType)) {
                            this._reportMissingFunctionDocstring(symbolInfo, symbolType, declRange, declPath, report);
                        }
                    }

                    if (!this._isSymbolTypeImplied(scopeType, name)) {
                        this._getSymbolTypeKnownStatus(
                            report,
                            symbolInfo,
                            symbolType,
                            declRange,
                            declPath,
                            publicSymbols
                        );
                    }
                }

                if (usesAmbiguousOverride) {
                    const decls = symbol.getDeclarations();
                    const primaryDecl = decls.length > 0 ? decls[decls.length - 1] : undefined;
                    const declRange = primaryDecl?.range || getEmptyRange();
                    const declPath = primaryDecl?.uri || Uri.empty();

                    const extraInfo = new DiagnosticAddendum();
                    if (baseSymbolType) {
                        extraInfo.addMessage(
                            `Type declared in base class is "${this._program.printType(baseSymbolType)}"`
                        );
                    }

                    if (childSymbolType) {
                        extraInfo.addMessage(
                            `Type inferred in child class is "${this._program.printType(childSymbolType)}"`
                        );

                        if (TypeBase.isAmbiguous(childSymbolType)) {
                            extraInfo.addMessage(
                                'Inferred child class type is missing type annotation and could be inferred differently by type checkers'
                            );
                        }
                    }

                    this._addSymbolError(
                        symbolInfo,
                        `Ambiguous base class override` + extraInfo.getString(),
                        declRange,
                        declPath
                    );
                    symbolInfo.typeKnownStatus = this._updateKnownStatusIfWorse(
                        symbolInfo.typeKnownStatus,
                        TypeKnownStatus.Ambiguous
                    );
                }

                knownStatus = this._updateKnownStatusIfWorse(knownStatus, symbolInfo.typeKnownStatus);
            }
        });

        return knownStatus;
    }

    private _reportMissingClassDocstring(symbolInfo: SymbolInfo, type: ClassType, report: PackageTypeReport) {
        if (type.shared.docString) {
            return;
        }

        this._addSymbolWarning(
            symbolInfo,
            `No docstring found for class "${symbolInfo.fullName}"`,
            getEmptyRange(),
            Uri.empty()
        );

        report.missingClassDocStringCount++;
    }

    private _reportMissingFunctionDocstring(
        symbolInfo: SymbolInfo | undefined,
        type: FunctionType,
        declRange: Range | undefined,
        declFileUri: Uri | undefined,
        report: PackageTypeReport
    ) {
        if (
            type.shared.parameters.find((_, index) => {
                const defaultType = FunctionType.getParamDefaultType(type, index);
                return defaultType && isEllipsisType(defaultType);
            })
        ) {
            if (symbolInfo) {
                this._addSymbolWarning(
                    symbolInfo,
                    `One or more default values in function "${symbolInfo.fullName}" is specified as "..."`,
                    declRange ?? getEmptyRange(),
                    declFileUri ?? Uri.empty()
                );
            }

            report.missingDefaultParamCount++;
        }

        if (type.shared.docString) {
            return;
        }

        // Don't require docstrings for dunder methods.
        if (symbolInfo && isDunderName(symbolInfo.name)) {
            return;
        }

        // Don't require docstrings for overloads.
        if (FunctionType.isOverloaded(type)) {
            return;
        }

        if (symbolInfo) {
            this._addSymbolWarning(
                symbolInfo,
                `No docstring found for function "${symbolInfo.fullName}"`,
                declRange ?? getEmptyRange(),
                declFileUri ?? Uri.empty()
            );
        }

        report.missingFunctionDocStringCount++;
    }

    // Determines whether the type for the symbol in question is fully known.
    // If not, it adds diagnostics to the symbol information and updates the
    // typeKnownStatus field.
    private _getSymbolTypeKnownStatus(
        report: PackageTypeReport,
        symbolInfo: SymbolInfo,
        type: Type,
        declRange: Range,
        declFileUri: Uri,
        publicSymbols: PublicSymbolSet
    ): TypeKnownStatus {
        let knownStatus = TypeKnownStatus.Known;

        const aliasInfo = type.props?.typeAliasInfo;
        if (aliasInfo?.typeArgs) {
            aliasInfo.typeArgs.forEach((typeArg, index) => {
                if (isUnknown(typeArg)) {
                    this._addSymbolError(
                        symbolInfo,
                        `Type argument ${index + 1} for type alias "${aliasInfo!.shared.name}" has unknown type`,
                        declRange,
                        declFileUri
                    );
                    knownStatus = TypeKnownStatus.Unknown;
                } else if (isPartlyUnknown(typeArg)) {
                    this._addSymbolError(
                        symbolInfo,
                        `Type argument ${index + 1} for type alias "${
                            aliasInfo!.shared.name
                        }" has partially unknown type`,
                        declRange,
                        declFileUri
                    );
                    knownStatus = TypeKnownStatus.PartiallyUnknown;
                }
            });
        }

        if (TypeBase.isAmbiguous(type) && !isUnknown(type)) {
            const ambiguousDiag = new DiagnosticAddendum();
            ambiguousDiag.addMessage(`Inferred type is "${this._program.printType(type)}"`);
            this._addSymbolError(
                symbolInfo,
                'Type is missing type annotation and could be inferred differently by type checkers' +
                    ambiguousDiag.getString(),
                declRange,
                declFileUri
            );
            knownStatus = this._updateKnownStatusIfWorse(knownStatus, TypeKnownStatus.Ambiguous);
        }

        switch (type.category) {
            case TypeCategory.Unbound:
            case TypeCategory.Any:
            case TypeCategory.Never:
            case TypeCategory.TypeVar:
                break;

            case TypeCategory.Unknown: {
                this._addSymbolError(
                    symbolInfo,
                    `Type unknown for ${PackageTypeVerifier.getSymbolCategoryString(symbolInfo.category)} "${
                        symbolInfo.fullName
                    }"`,
                    declRange,
                    declFileUri
                );
                knownStatus = this._updateKnownStatusIfWorse(knownStatus, TypeKnownStatus.Unknown);
                break;
            }

            case TypeCategory.Union: {
                doForEachSubtype(type, (subtype) => {
                    knownStatus = this._updateKnownStatusIfWorse(
                        knownStatus,
                        this._getSymbolTypeKnownStatus(
                            report,
                            symbolInfo,
                            subtype,
                            declRange,
                            declFileUri,
                            publicSymbols
                        )
                    );
                });
                break;
            }

            case TypeCategory.Overloaded: {
                for (const overload of OverloadedType.getOverloads(type)) {
                    knownStatus = this._updateKnownStatusIfWorse(
                        knownStatus,
                        this._getSymbolTypeKnownStatus(
                            report,
                            symbolInfo,
                            overload,
                            declRange,
                            declFileUri,
                            publicSymbols
                        )
                    );
                }
                break;
            }

            case TypeCategory.Function: {
                if (!this._shouldIgnoreType(report, type.shared.fullName)) {
                    knownStatus = this._updateKnownStatusIfWorse(
                        knownStatus,
                        this._getFunctionTypeKnownStatus(
                            report,
                            type,
                            publicSymbols,
                            symbolInfo,
                            declRange,
                            declFileUri,
                            undefined /* diag */
                        )
                    );
                }

                break;
            }

            case TypeCategory.Class: {
                // Properties require special handling.
                if (TypeBase.isInstance(type) && ClassType.isPropertyClass(type)) {
                    const propMethodInfo: [string, (c: ClassType) => FunctionType | undefined][] = [
                        ['fget', (c) => c.priv.fgetInfo?.methodType],
                        ['fset', (c) => c.priv.fsetInfo?.methodType],
                        ['fdel', (c) => c.priv.fdelInfo?.methodType],
                    ];

                    const propertyClass = type;

                    propMethodInfo.forEach((info) => {
                        const methodAccessor = info[1];
                        let accessType = methodAccessor(propertyClass);

                        if (!accessType) {
                            return;
                        }

                        if (isFunction(accessType)) {
                            // The processing for fget, fset and fdel mark the methods as "static" so they
                            // work properly when accessed directly from the property object. We need
                            // to remove this flag here so the method is seen as an instance method rather than
                            // static. Otherwise we'll incorrectly report that "self" is not annotated.
                            accessType = FunctionType.cloneWithNewFlags(
                                accessType,
                                accessType.shared.flags & ~FunctionTypeFlags.StaticMethod
                            );
                        }

                        knownStatus = this._updateKnownStatusIfWorse(
                            knownStatus,
                            this._getSymbolTypeKnownStatus(
                                report,
                                symbolInfo,
                                accessType,
                                getEmptyRange(),
                                Uri.empty(),
                                publicSymbols
                            )
                        );
                    });

                    break;
                }

                if (!this._shouldIgnoreType(report, type.shared.fullName)) {
                    // Don't bother type-checking built-in types.
                    if (!ClassType.isBuiltIn(type)) {
                        const symbolInfo = this._getSymbolForClass(report, type, publicSymbols);
                        knownStatus = this._updateKnownStatusIfWorse(knownStatus, symbolInfo.typeKnownStatus);
                    }
                }

                // Analyze type arguments if present to make sure they are known.
                if (type.priv.typeArgs) {
                    type.priv.typeArgs!.forEach((typeArg, index) => {
                        if (isUnknown(typeArg)) {
                            this._addSymbolError(
                                symbolInfo,
                                `Type argument ${index + 1} for class "${type.shared.name}" has unknown type`,
                                declRange,
                                declFileUri
                            );
                            knownStatus = this._updateKnownStatusIfWorse(knownStatus, TypeKnownStatus.Unknown);
                        } else if (isPartlyUnknown(typeArg)) {
                            const diag = new DiagnosticAddendum();
                            diag.addMessage(`Type is ${this._program.printType(typeArg)}`);
                            this._addSymbolError(
                                symbolInfo,
                                `Type argument ${index + 1} for class "${
                                    type.shared.name
                                }" has partially unknown type` + diag.getString(),
                                declRange,
                                declFileUri
                            );
                            knownStatus = this._updateKnownStatusIfWorse(knownStatus, TypeKnownStatus.PartiallyUnknown);
                        }
                    });
                }

                break;
            }

            case TypeCategory.Module: {
                if (!this._shouldIgnoreType(report, type.priv.moduleName)) {
                    const moduleSymbol = this._getSymbolForModule(report, type, publicSymbols);
                    if (moduleSymbol.typeKnownStatus !== TypeKnownStatus.Known) {
                        this._addSymbolError(
                            symbolInfo,
                            `Module "${moduleSymbol.fullName}" is partially unknown`,
                            declRange,
                            declFileUri
                        );
                        knownStatus = this._updateKnownStatusIfWorse(knownStatus, moduleSymbol.typeKnownStatus);
                    }
                }

                break;
            }
        }

        // Downgrade the symbol's type known status info.
        symbolInfo.typeKnownStatus = this._updateKnownStatusIfWorse(symbolInfo.typeKnownStatus, knownStatus);

        return knownStatus;
    }

    private _getFunctionTypeKnownStatus(
        report: PackageTypeReport,
        type: FunctionType,
        publicSymbols: PublicSymbolSet,
        symbolInfo?: SymbolInfo,
        declRange?: Range,
        declFileUri?: Uri,
        diag?: DiagnosticAddendum
    ): TypeKnownStatus {
        let knownStatus = TypeKnownStatus.Known;

        // If the file path wasn't provided, try to get it from the type.
        if (type.shared.declaration && !declFileUri) {
            declFileUri = type.shared.declaration.uri;
        }

        type.shared.parameters.forEach((param, index) => {
            const paramType = FunctionType.getParamType(type, index);

            // Skip nameless parameters like "*" and "/".
            if (param.name) {
                if (!FunctionParam.isTypeDeclared(param)) {
                    // Allow params (like "self" and "cls") to skip declarations because
                    // we're able to synthesize these.
                    const isSynthesized =
                        index === 0 &&
                        symbolInfo?.scopeType === ScopeType.Class &&
                        (FunctionType.isClassMethod(type) ||
                            FunctionType.isInstanceMethod(type) ||
                            FunctionType.isConstructorMethod(type));

                    if (!isSynthesized) {
                        if (symbolInfo) {
                            this._addSymbolError(
                                symbolInfo,
                                `Type annotation for parameter "${param.name}" is missing`,
                                declRange ?? getEmptyRange(),
                                declFileUri ?? Uri.empty()
                            );
                        }
                        diag?.createAddendum().addMessage(`Type annotation for parameter "${param.name}" is missing`);
                        knownStatus = this._updateKnownStatusIfWorse(knownStatus, TypeKnownStatus.Unknown);
                    }
                } else if (isUnknown(paramType)) {
                    if (symbolInfo) {
                        this._addSymbolError(
                            symbolInfo,
                            `Type of parameter "${param.name}" is unknown`,
                            declRange ?? getEmptyRange(),
                            declFileUri ?? Uri.empty()
                        );
                        diag?.createAddendum().addMessage(`Type of parameter "${param.name}" is unknown`);
                    }
                    knownStatus = this._updateKnownStatusIfWorse(knownStatus, TypeKnownStatus.Unknown);
                } else {
                    const extraInfo = new DiagnosticAddendum();
                    const paramKnownStatus = this._getTypeKnownStatus(
                        report,
                        paramType,
                        publicSymbols,
                        extraInfo.createAddendum()
                    );

                    if (paramKnownStatus !== TypeKnownStatus.Known) {
                        extraInfo.addMessage(`Parameter type is "${this._program.printType(paramType)}"`);

                        if (symbolInfo) {
                            this._addSymbolError(
                                symbolInfo,
                                `Type of parameter "${param.name}" is partially unknown` + extraInfo.getString(),
                                declRange ?? getEmptyRange(),
                                declFileUri ?? Uri.empty()
                            );
                        }

                        if (diag) {
                            const subDiag = diag.createAddendum();
                            subDiag.addMessage(`Type of parameter "${param.name}" is partially unknown`);
                            subDiag.addAddendum(extraInfo);
                        }

                        knownStatus = this._updateKnownStatusIfWorse(knownStatus, paramKnownStatus);
                    }
                }
            }
        });

        if (type.shared.declaredReturnType) {
            if (isUnknown(type.shared.declaredReturnType)) {
                if (symbolInfo) {
                    this._addSymbolError(
                        symbolInfo,
                        `Return type is unknown`,
                        declRange ?? getEmptyRange(),
                        declFileUri ?? Uri.empty()
                    );
                }
                knownStatus = this._updateKnownStatusIfWorse(knownStatus, TypeKnownStatus.Unknown);
            } else {
                const extraInfo = new DiagnosticAddendum();
                const returnTypeKnownStatus = this._getTypeKnownStatus(
                    report,
                    type.shared.declaredReturnType,
                    publicSymbols,
                    extraInfo.createAddendum()
                );

                if (returnTypeKnownStatus !== TypeKnownStatus.Known) {
                    extraInfo.addMessage(`Return type is "${this._program.printType(type.shared.declaredReturnType)}"`);

                    if (symbolInfo) {
                        this._addSymbolError(
                            symbolInfo,
                            `Return type is partially unknown` + extraInfo.getString(),
                            declRange ?? getEmptyRange(),
                            declFileUri ?? Uri.empty()
                        );
                    }

                    if (diag) {
                        const subDiag = diag.createAddendum();
                        subDiag.addMessage(`Return type is partially unknown`);
                        subDiag.addAddendum(extraInfo);
                    }

                    knownStatus = this._updateKnownStatusIfWorse(knownStatus, returnTypeKnownStatus);
                }
            }
        } else {
            // Init methods have an implied return type.
            if (type.shared.name !== '__init__') {
                if (symbolInfo) {
                    this._addSymbolError(
                        symbolInfo,
                        `Return type annotation is missing`,
                        declRange ?? getEmptyRange(),
                        declFileUri ?? Uri.empty()
                    );
                }
                diag?.createAddendum().addMessage(`Return type annotation is missing`);
                knownStatus = this._updateKnownStatusIfWorse(knownStatus, TypeKnownStatus.Unknown);
            }
        }

        if (symbolInfo) {
            symbolInfo.typeKnownStatus = this._updateKnownStatusIfWorse(symbolInfo.typeKnownStatus, knownStatus);
        }

        return knownStatus;
    }

    private _getSymbolForClass(report: PackageTypeReport, type: ClassType, publicSymbols: PublicSymbolSet): SymbolInfo {
        // See if this type is already analyzed.
        const cachedType = report.symbols.get(type.shared.fullName);
        if (cachedType) {
            cachedType.referenceCount++;
            return cachedType;
        }

        const symbolInfo: SymbolInfo = {
            category: SymbolCategory.Class,
            name: type.shared.name,
            fullName: type.shared.fullName,
            fileUri: type.shared.fileUri,
            isExported: publicSymbols.has(type.shared.fullName),
            typeKnownStatus: TypeKnownStatus.Known,
            referenceCount: 1,
            diagnostics: [],
            scopeType: ScopeType.Class,
        };

        this._addSymbol(report, symbolInfo);

        // Determine whether the class has a proper doc string.
        this._reportMissingClassDocstring(symbolInfo, type, report);

        const symbolTableTypeKnownStatus = this._getTypeKnownStatusForSymbolTable(
            report,
            type.shared.fullName,
            ClassType.getSymbolTable(type),
            ScopeType.Class,
            publicSymbols,
            (name: string, symbol: Symbol) => {
                // If the symbol within this class is lacking a type declaration,
                // see if we can find a same-named symbol in a parent class with
                // a type declaration.
                if (symbol.hasTypedDeclarations()) {
                    return undefined;
                }

                for (const mroClass of type.shared.mro.slice(1)) {
                    if (isClass(mroClass)) {
                        const overrideSymbol = ClassType.getSymbolTable(mroClass).get(name);
                        if (overrideSymbol && overrideSymbol.hasTypedDeclarations()) {
                            const baseSymbolType = this._program.getTypeOfSymbol(overrideSymbol);
                            const baseClassType = specializeForBaseClass(type, mroClass);

                            return partiallySpecializeType(baseSymbolType, baseClassType, /* typeClass */ undefined);
                        }
                    }
                }

                return undefined;
            }
        );

        symbolInfo.typeKnownStatus = this._updateKnownStatusIfWorse(
            symbolInfo.typeKnownStatus,
            symbolTableTypeKnownStatus
        );

        // Add information for the metaclass.
        if (type.shared.effectiveMetaclass) {
            if (!isInstantiableClass(type.shared.effectiveMetaclass)) {
                this._addSymbolError(symbolInfo, `Type of metaclass unknown`, getEmptyRange(), Uri.empty());
                symbolInfo.typeKnownStatus = this._updateKnownStatusIfWorse(
                    symbolInfo.typeKnownStatus,
                    TypeKnownStatus.PartiallyUnknown
                );
            } else {
                const diag = new DiagnosticAddendum();
                const metaclassKnownStatus = this._getTypeKnownStatus(
                    report,
                    type.shared.effectiveMetaclass,
                    publicSymbols,
                    diag
                );

                if (metaclassKnownStatus !== TypeKnownStatus.Known) {
                    this._addSymbolError(
                        symbolInfo,
                        `Type of metaclass "${type.shared.effectiveMetaclass.shared.name}" is partially unknown` +
                            diag.getString(),
                        getEmptyRange(),
                        Uri.empty()
                    );
                    symbolInfo.typeKnownStatus = this._updateKnownStatusIfWorse(
                        symbolInfo.typeKnownStatus,
                        metaclassKnownStatus
                    );
                }
            }
        }

        // Add information for base classes.
        type.shared.baseClasses.forEach((baseClass) => {
            if (!isInstantiableClass(baseClass)) {
                this._addSymbolError(symbolInfo, `Type of base class unknown`, getEmptyRange(), Uri.empty());
                symbolInfo.typeKnownStatus = this._updateKnownStatusIfWorse(
                    symbolInfo.typeKnownStatus,
                    TypeKnownStatus.PartiallyUnknown
                );
            } else {
                // Handle "tuple" specially. Even though it's a generic class, it
                // doesn't require a type argument.
                if (ClassType.isBuiltIn(baseClass, 'tuple')) {
                    return;
                }

                const diag = new DiagnosticAddendum();
                const baseClassTypeStatus = this._getTypeKnownStatus(report, baseClass, publicSymbols, diag);

                if (baseClassTypeStatus !== TypeKnownStatus.Known) {
                    this._addSymbolError(
                        symbolInfo,
                        `Type of base class "${baseClass.shared.fullName}" is partially unknown` + diag.getString(),
                        getEmptyRange(),
                        Uri.empty()
                    );

                    symbolInfo.typeKnownStatus = this._updateKnownStatusIfWorse(
                        symbolInfo.typeKnownStatus,
                        baseClassTypeStatus
                    );
                }
            }
        });

        return symbolInfo;
    }

    private _getSymbolForModule(
        report: PackageTypeReport,
        type: ModuleType,
        publicSymbols: PublicSymbolSet
    ): SymbolInfo {
        // See if this type is already analyzed.
        const cachedType = report.symbols.get(type.priv.moduleName);
        if (cachedType) {
            cachedType.referenceCount++;
            return cachedType;
        }

        const symbolInfo: SymbolInfo = {
            category: SymbolCategory.Module,
            name: type.priv.moduleName,
            fullName: type.priv.moduleName,
            fileUri: type.priv.fileUri,
            isExported: publicSymbols.has(type.priv.moduleName),
            typeKnownStatus: TypeKnownStatus.Known,
            referenceCount: 1,
            diagnostics: [],
            scopeType: ScopeType.Module,
        };

        // Add the symbol for the module if the name isn't relative.
        if (!type.priv.moduleName.startsWith('.')) {
            this._addSymbol(report, symbolInfo);
        }

        const symbolTableTypeKnownStatus = this._getTypeKnownStatusForSymbolTable(
            report,
            type.priv.moduleName,
            type.priv.fields,
            ScopeType.Module,
            publicSymbols
        );

        symbolInfo.typeKnownStatus = this._updateKnownStatusIfWorse(
            symbolInfo.typeKnownStatus,
            symbolTableTypeKnownStatus
        );

        return symbolInfo;
    }

    private _getTypeKnownStatus(
        report: PackageTypeReport,
        type: Type,
        publicSymbols: PublicSymbolSet,
        diag: DiagnosticAddendum
    ): TypeKnownStatus {
        let knownStatus = TypeKnownStatus.Known;

        const aliasInfo = type.props?.typeAliasInfo;
        if (aliasInfo?.typeArgs) {
            aliasInfo.typeArgs.forEach((typeArg, index) => {
                if (isUnknown(typeArg)) {
                    diag.addMessage(
                        `Type argument ${index + 1} for type alias "${aliasInfo!.shared.name}" has unknown type`
                    );
                    knownStatus = this._updateKnownStatusIfWorse(knownStatus, TypeKnownStatus.Unknown);
                } else if (isPartlyUnknown(typeArg)) {
                    diag.addMessage(
                        `Type argument ${index + 1} for type alias "${
                            aliasInfo!.shared.name
                        }" has partially unknown type`
                    );
                    knownStatus = this._updateKnownStatusIfWorse(knownStatus, TypeKnownStatus.PartiallyUnknown);
                }
            });
        }

        if (TypeBase.isAmbiguous(type)) {
            knownStatus = this._updateKnownStatusIfWorse(knownStatus, TypeKnownStatus.Ambiguous);
        }

        switch (type.category) {
            case TypeCategory.Unbound:
            case TypeCategory.Any:
            case TypeCategory.Never:
            case TypeCategory.TypeVar:
                break;

            case TypeCategory.Unknown: {
                knownStatus = this._updateKnownStatusIfWorse(knownStatus, TypeKnownStatus.Unknown);
                break;
            }

            case TypeCategory.Union: {
                doForEachSubtype(type, (subtype) => {
                    knownStatus = this._updateKnownStatusIfWorse(
                        knownStatus,
                        this._getTypeKnownStatus(report, subtype, publicSymbols, diag.createAddendum())
                    );
                });

                break;
            }

            case TypeCategory.Overloaded: {
                for (const overload of OverloadedType.getOverloads(type)) {
                    knownStatus = this._updateKnownStatusIfWorse(
                        knownStatus,
                        this._getTypeKnownStatus(report, overload, publicSymbols, diag.createAddendum())
                    );
                }

                break;
            }

            case TypeCategory.Function: {
                if (!this._shouldIgnoreType(report, type.shared.fullName)) {
                    knownStatus = this._updateKnownStatusIfWorse(
                        knownStatus,
                        this._getFunctionTypeKnownStatus(
                            report,
                            type,
                            publicSymbols,
                            /* symbolInfo */ undefined,
                            /* declRange */ undefined,
                            /* declFilePath */ undefined,
                            diag
                        )
                    );
                }

                break;
            }

            case TypeCategory.Class: {
                if (!this._shouldIgnoreType(report, type.shared.fullName)) {
                    // Don't bother type-checking built-in types.
                    if (!ClassType.isBuiltIn(type)) {
                        const symbolInfo = this._getSymbolForClass(report, type, publicSymbols);
                        knownStatus = this._updateKnownStatusIfWorse(knownStatus, symbolInfo.typeKnownStatus);
                    }
                }

                // Analyze type arguments if present to make sure they are known.
                if (type.priv.typeArgs) {
                    type.priv.typeArgs!.forEach((typeArg, index) => {
                        if (isUnknown(typeArg)) {
                            diag.addMessage(
                                `Type argument ${index + 1} for class "${type.shared.name}" has unknown type`
                            );
                            knownStatus = this._updateKnownStatusIfWorse(knownStatus, TypeKnownStatus.Unknown);
                        } else if (isPartlyUnknown(typeArg)) {
                            diag.addMessage(
                                `Type argument ${index + 1} for class "${type.shared.name}" has partially unknown type`
                            );
                            knownStatus = this._updateKnownStatusIfWorse(knownStatus, TypeKnownStatus.PartiallyUnknown);
                        }
                    });
                }

                break;
            }

            case TypeCategory.Module: {
                if (!this._shouldIgnoreType(report, type.priv.moduleName)) {
                    const moduleSymbol = this._getSymbolForModule(report, type, publicSymbols);
                    knownStatus = this._updateKnownStatusIfWorse(knownStatus, moduleSymbol.typeKnownStatus);
                }

                break;
            }
        }

        return knownStatus;
    }

    private _getSymbolCategory(symbol: Symbol, type: Type): SymbolCategory {
        if (type.props?.typeAliasInfo) {
            return SymbolCategory.TypeAlias;
        }

        switch (type.category) {
            case TypeCategory.Function:
            case TypeCategory.Overloaded: {
                const funcDecl = symbol
                    .getDeclarations()
                    .find((decl) => decl.type === DeclarationType.Function) as FunctionDeclaration;
                if (funcDecl && funcDecl.isMethod) {
                    return SymbolCategory.Method;
                }

                return SymbolCategory.Function;
            }

            case TypeCategory.Class: {
                if (TypeBase.isInstantiable(type)) {
                    return SymbolCategory.Class;
                }

                const varDecl = symbol
                    .getDeclarations()
                    .find((decl) => decl.type === DeclarationType.Variable) as VariableDeclaration;
                if (varDecl && (varDecl.isConstant || varDecl.isFinal)) {
                    return SymbolCategory.Constant;
                }
                return SymbolCategory.Variable;
            }

            case TypeCategory.Module: {
                return SymbolCategory.Module;
            }

            case TypeCategory.TypeVar: {
                return SymbolCategory.TypeVar;
            }

            default: {
                const varDecl = symbol
                    .getDeclarations()
                    .find((decl) => decl.type === DeclarationType.Variable) as VariableDeclaration;
                if (varDecl) {
                    if (varDecl.isConstant || varDecl.isFinal) {
                        return SymbolCategory.Constant;
                    } else {
                        return SymbolCategory.Variable;
                    }
                }

                return SymbolCategory.Indeterminate;
            }
        }
    }

    private _getDirectoryInfoForModule(moduleName: string): ModuleDirectoryInfo | undefined {
        const importResult = this._importResolver.resolveImport(
            Uri.empty(),
            this._execEnv,
            createImportedModuleDescriptor(moduleName)
        );

        if (importResult.isImportFound) {
            const resolvedPath = importResult.resolvedUris[importResult.resolvedUris.length - 1];

            // If it's a namespace package with no __init__.py(i), use the package
            // directory instead.
            const moduleDirectory = resolvedPath
                ? resolvedPath.getDirectory()
                : importResult.packageDirectory ?? Uri.empty();
            let isModuleSingleFile = false;
            if (resolvedPath && !resolvedPath.isEmpty() && stripFileExtension(resolvedPath.fileName) !== '__init__') {
                isModuleSingleFile = true;
            }

            return {
                moduleDirectory,
                isModuleSingleFile,
            };
        }

        return undefined;
    }

    private _isSymbolTypeImplied(scopeType: ScopeType, name: string) {
        if (scopeType === ScopeType.Class) {
            const knownClassSymbols = [
                '__class__',
                '__dict__',
                '__doc__',
                '__module__',
                '__qualname__',
                '__slots__',
                '__all__',
                '__weakref__',
            ];
            return knownClassSymbols.some((sym) => sym === name);
        } else if (scopeType === ScopeType.Module) {
            const knownModuleSymbols = [
                '__all__',
                '__author__',
                '__copyright__',
                '__email__',
                '__license__',
                '__title__',
                '__uri__',
                '__version__',
            ];
            return knownModuleSymbols.some((sym) => sym === name);
        }

        return false;
    }

    private _addSymbol(report: PackageTypeReport, symbolInfo: SymbolInfo) {
        assert(!report.symbols.has(symbolInfo.fullName));
        report.symbols.set(symbolInfo.fullName, symbolInfo);
    }

    private _addSymbolError(symbolInfo: SymbolInfo, message: string, declRange: Range, declUri: Uri) {
        symbolInfo.diagnostics.push({
            diagnostic: new Diagnostic(DiagnosticCategory.Error, message, declRange),
            uri: declUri,
        });
    }

    private _addSymbolWarning(symbolInfo: SymbolInfo, message: string, declRange: Range, declUri: Uri) {
        symbolInfo.diagnostics.push({
            diagnostic: new Diagnostic(DiagnosticCategory.Warning, message, declRange),
            uri: declUri,
        });
    }

    private _updateKnownStatusIfWorse(currentStatus: TypeKnownStatus, newStatus: TypeKnownStatus) {
        // Is the current status worse than the current status.
        return newStatus > currentStatus ? newStatus : currentStatus;
    }
}
