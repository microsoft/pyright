/*
 * packageTypeVerifier.ts
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT license.
 * Author: Eric Traut
 *
 * Validates the public symbols exported by a package to ensure
 * that the types are complete.
 */

import { ConfigOptions, ExecutionEnvironment } from '../common/configOptions';
import { assert } from '../common/debug';
import { Diagnostic, DiagnosticAddendum, DiagnosticCategory } from '../common/diagnostic';
import { FileSystem } from '../common/fileSystem';
import { FullAccessHost } from '../common/fullAccessHost';
import { combinePaths, getDirectoryPath, getFileExtension, stripFileExtension, tryStat } from '../common/pathUtils';
import { getEmptyRange, Range } from '../common/textRange';
import { DeclarationType, FunctionDeclaration, VariableDeclaration } from './declaration';
import { ImportedModuleDescriptor, ImportResolver } from './importResolver';
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
import { getPyTypedInfo } from './pyTypedUtils';
import { ScopeType } from './scope';
import { getScopeForNode } from './scopeUtils';
import { Symbol, SymbolTable } from './symbol';
import { isDunderName, isPrivateOrProtectedName } from './symbolNameUtils';
import {
    ClassType,
    FunctionType,
    isInstantiableClass,
    isModule,
    isUnknown,
    ModuleType,
    Type,
    TypeBase,
    TypeCategory,
} from './types';
import { doForEachSubtype, getFullNameOfType, isEllipsisType, isPartlyUnknown } from './typeUtils';

type PublicSymbolMap = Map<string, string>;

export class PackageTypeVerifier {
    private _configOptions: ConfigOptions;
    private _execEnv: ExecutionEnvironment;
    private _importResolver: ImportResolver;
    private _program: Program;

    constructor(private _fileSystem: FileSystem) {
        this._configOptions = new ConfigOptions('');
        this._execEnv = this._configOptions.findExecEnvironment('.');
        this._importResolver = new ImportResolver(
            this._fileSystem,
            this._configOptions,
            new FullAccessHost(this._fileSystem)
        );
        this._program = new Program(this._importResolver, this._configOptions);
    }

    verify(packageName: string, ignoreExternal = false): PackageTypeReport {
        const trimmedPackageName = packageName.trim();
        const packageNameParts = trimmedPackageName.split('.');

        const report = getEmptyReport(
            packageNameParts[0],
            this._getDirectoryForPackage(packageNameParts[0]) || '',
            ignoreExternal
        );
        const commonDiagnostics = report.generalDiagnostics;

        try {
            if (!trimmedPackageName) {
                commonDiagnostics.push(
                    new Diagnostic(
                        DiagnosticCategory.Error,
                        `Package name "${trimmedPackageName}" is invalid`,
                        getEmptyRange()
                    )
                );
            } else if (!report.rootDirectory) {
                commonDiagnostics.push(
                    new Diagnostic(
                        DiagnosticCategory.Error,
                        `Package "${trimmedPackageName}" cannot be resolved`,
                        getEmptyRange()
                    )
                );
            } else {
                const pyTypedInfo = getPyTypedInfo(this._fileSystem, report.rootDirectory);
                if (!pyTypedInfo) {
                    commonDiagnostics.push(
                        new Diagnostic(DiagnosticCategory.Error, 'No py.typed file found', getEmptyRange())
                    );
                } else {
                    report.pyTypedPath = pyTypedInfo.pyTypedPath;

                    const publicModules = this._getListOfPublicModules(
                        report.rootDirectory,
                        packageNameParts[0],
                        trimmedPackageName
                    );

                    // If the filter eliminated all modules, report an error.
                    if (publicModules.length === 0) {
                        commonDiagnostics.push(
                            new Diagnostic(
                                DiagnosticCategory.Error,
                                `Module "${trimmedPackageName}" cannot be resolved`,
                                getEmptyRange()
                            )
                        );
                    }

                    // Build a map of all public symbols exported by this package. We'll
                    // use this map to determine which diagnostics to report. We don't want
                    // to report diagnostics many times for types that include public types.
                    const publicSymbolMap = new Map<string, string>();
                    publicModules.forEach((moduleName) => {
                        this._getPublicSymbolsForModule(moduleName, publicSymbolMap, report.alternateSymbolNames);
                    });

                    publicModules.forEach((moduleName) => {
                        this._verifyTypesForModule(moduleName, publicSymbolMap, report);
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

    private _resolveImport(moduleName: string) {
        const moduleDescriptor: ImportedModuleDescriptor = {
            leadingDots: 0,
            nameParts: moduleName.split('.'),
            importedSymbols: [],
        };
        return this._importResolver.resolveImport('', this._execEnv, moduleDescriptor);
    }

    private _getPublicSymbolsForModule(
        moduleName: string,
        symbolMap: PublicSymbolMap,
        alternateSymbolNames: AlternateSymbolNameMap
    ) {
        const importResult = this._resolveImport(moduleName);

        if (importResult.isImportFound) {
            const modulePath = importResult.resolvedPaths[importResult.resolvedPaths.length - 1];
            this._program.addTrackedFiles([modulePath], /* isThirdPartyImport */ true, /* isInPyTypedPackage */ true);

            const sourceFile = this._program.getBoundSourceFile(modulePath);

            if (sourceFile) {
                const module: ModuleInfo = {
                    name: moduleName,
                    path: modulePath,
                    isExported: true,
                };

                const parseTree = sourceFile.getParseResults()!.parseTree;
                const moduleScope = getScopeForNode(parseTree)!;

                this._getPublicSymbolsInSymbolTable(
                    symbolMap,
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
        symbolMap: PublicSymbolMap,
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
                    const symbolType = this._program.getTypeForSymbol(symbol);
                    symbolMap.set(fullName, fullName);

                    const typedDecls = symbol.getTypedDeclarations();

                    if (typedDecls.length > 0) {
                        // Is this a class declared within this module or class?
                        // If so, add the symbols declared within it.
                        const classDecl = typedDecls.find((decl) => decl.type === DeclarationType.Class);
                        if (classDecl) {
                            if (isInstantiableClass(symbolType)) {
                                this._getPublicSymbolsInSymbolTable(
                                    symbolMap,
                                    alternateSymbolNames,
                                    module,
                                    fullName,
                                    symbolType.details.fields,
                                    ScopeType.Class
                                );
                            }
                        }
                    }

                    // Is this the re-export of an import? If so, record the alternate name.
                    const importDecl = symbol.getDeclarations().find((decl) => decl.type === DeclarationType.Alias);
                    if (importDecl && importDecl.type === DeclarationType.Alias) {
                        const typeName = getFullNameOfType(this._program.getTypeForSymbol(symbol));
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

    private _verifyTypesForModule(moduleName: string, publicSymbolMap: PublicSymbolMap, report: PackageTypeReport) {
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
            const modulePath = importResult.resolvedPaths[importResult.resolvedPaths.length - 1];

            const module: ModuleInfo = {
                name: moduleName,
                path: modulePath,
                isExported: true,
            };

            report.modules.set(modulePath, module);
            this._program.addTrackedFiles([modulePath], /* isThirdPartyImport */ true, /* isInPyTypedPackage */ true);

            const sourceFile = this._program.getBoundSourceFile(modulePath);

            if (sourceFile) {
                const parseTree = sourceFile.getParseResults()!.parseTree;
                const moduleScope = getScopeForNode(parseTree)!;

                this._verifySymbolsInSymbolTable(
                    report,
                    module.name,
                    moduleScope.symbolTable,
                    ScopeType.Module,
                    publicSymbolMap
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
    private _getListOfPublicModules(rootPath: string, packageName: string, moduleFilter: string): string[] {
        let publicModules: string[] = [];
        this._addPublicModulesRecursive(rootPath, packageName, publicModules);

        // Make sure modules are unique. There may be duplicates if a ".py" and ".pyi"
        // exist for some modules.
        const uniqueModules: string[] = [];
        const moduleMap = new Map<string, string>();

        // Apply the filter to limit to only specified submodules.
        publicModules = publicModules.filter((module) => module.startsWith(moduleFilter));

        publicModules.forEach((module) => {
            if (!moduleMap.has(module)) {
                uniqueModules.push(module);
                moduleMap.set(module, module);
            }
        });

        return uniqueModules;
    }

    private _addPublicModulesRecursive(dirPath: string, modulePath: string, publicModules: string[]) {
        const dirEntries = this._fileSystem.readdirEntriesSync(dirPath);

        dirEntries.forEach((entry) => {
            let isFile = entry.isFile();
            let isDirectory = entry.isDirectory();
            if (entry.isSymbolicLink()) {
                const stat = tryStat(this._fileSystem, combinePaths(dirPath, entry.name));
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
                        publicModules.push(modulePath);
                    } else {
                        if (
                            !isPrivateOrProtectedName(nameWithoutExtension) &&
                            this._isLegalModulePartName(nameWithoutExtension)
                        ) {
                            publicModules.push(`${modulePath}.${nameWithoutExtension}`);
                        }
                    }
                }
            } else if (isDirectory) {
                if (!isPrivateOrProtectedName(entry.name) && this._isLegalModulePartName(entry.name)) {
                    this._addPublicModulesRecursive(
                        combinePaths(dirPath, entry.name),
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

    private _verifySymbolsInSymbolTable(
        report: PackageTypeReport,
        scopeName: string,
        symbolTable: SymbolTable,
        scopeType: ScopeType,
        publicSymbolMap: PublicSymbolMap
    ): boolean {
        if (this._shouldIgnoreType(report, scopeName)) {
            return true;
        }

        let isKnown = true;

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

                const symbolType = this._program.getTypeForSymbol(symbol);

                const typedDecls = symbol.getTypedDeclarations();
                const primaryDecl = typedDecls.length > 0 ? typedDecls[typedDecls.length - 1] : undefined;
                let symbolInfo: SymbolInfo;

                if (primaryDecl?.type === DeclarationType.Class && isInstantiableClass(symbolType)) {
                    symbolInfo = this._getSymbolForClass(report, symbolType, publicSymbolMap);
                } else if (primaryDecl?.type === DeclarationType.Alias && isModule(symbolType)) {
                    symbolInfo = this._getSymbolForModule(report, symbolType, publicSymbolMap);
                } else {
                    const decls = symbol.getDeclarations();
                    const primaryDecl = decls.length > 0 ? decls[decls.length - 1] : undefined;
                    const declRange = primaryDecl?.range || getEmptyRange();
                    const declPath = primaryDecl?.path || '';
                    const symbolCategory = this._getSymbolCategory(symbol, symbolType);
                    const isExported = publicSymbolMap.has(fullName);

                    symbolInfo = {
                        category: symbolCategory,
                        name,
                        fullName,
                        filePath: module.path,
                        isExported,
                        typeKnownStatus: TypeKnownStatus.Known,
                        referenceCount: 1,
                        diagnostics: [],
                    };

                    this._addSymbol(report, symbolInfo);

                    if (!this._isSymbolTypeImplied(scopeType, name)) {
                        this._validateSymbolType(report, symbolInfo, symbolType, declRange, declPath, publicSymbolMap);
                    }
                }

                if (symbolInfo.typeKnownStatus !== TypeKnownStatus.Known) {
                    isKnown = false;
                }
            }
        });

        return isKnown;
    }

    // Determines whether the type for the symbol in question is fully known.
    // If not, it adds diagnostics to the symbol information and updates the
    // typeKnownStatus field.
    private _validateSymbolType(
        report: PackageTypeReport,
        symbolInfo: SymbolInfo,
        type: Type,
        declRange: Range,
        declFilePath: string,
        publicSymbolMap: PublicSymbolMap
    ): boolean {
        switch (type.category) {
            case TypeCategory.Unbound:
            case TypeCategory.Any:
            case TypeCategory.None:
            case TypeCategory.Never:
            case TypeCategory.TypeVar:
                return true;

            case TypeCategory.Unknown: {
                this._addSymbolError(
                    symbolInfo,
                    `Type unknown for ${PackageTypeVerifier.getSymbolCategoryString(symbolInfo.category)} "${
                        symbolInfo.fullName
                    }"`,
                    declRange,
                    declFilePath
                );
                symbolInfo.typeKnownStatus = TypeKnownStatus.Unknown;
                return false;
            }

            case TypeCategory.Union: {
                let isKnown = true;
                doForEachSubtype(type, (subtype) => {
                    if (
                        !this._validateSymbolType(report, symbolInfo, subtype, declRange, declFilePath, publicSymbolMap)
                    ) {
                        isKnown = false;
                    }
                });

                if (!isKnown) {
                    symbolInfo.typeKnownStatus = TypeKnownStatus.PartiallyUnknown;
                }

                return isKnown;
            }

            case TypeCategory.OverloadedFunction: {
                let isKnown = true;
                for (const overload of type.overloads) {
                    if (
                        !this._validateSymbolType(
                            report,
                            symbolInfo,
                            overload,
                            declRange,
                            declFilePath,
                            publicSymbolMap
                        )
                    ) {
                        isKnown = false;
                    }
                }

                if (!isKnown) {
                    symbolInfo.typeKnownStatus = TypeKnownStatus.PartiallyUnknown;
                }
                return isKnown;
            }

            case TypeCategory.Function: {
                if (!this._shouldIgnoreType(report, type.details.fullName)) {
                    if (
                        !this._validateFunctionType(report, type, publicSymbolMap, symbolInfo, declRange, declFilePath)
                    ) {
                        symbolInfo.typeKnownStatus = TypeKnownStatus.PartiallyUnknown;
                        return false;
                    }
                }

                return true;
            }

            case TypeCategory.Class: {
                // Properties require special handling.
                if (TypeBase.isInstance(type) && ClassType.isPropertyClass(type)) {
                    let isTypeKnown = true;
                    const accessors = ['fget', 'fset', 'fdel'];
                    const propertyClass = type;

                    accessors.forEach((accessorName) => {
                        const accessSymbol = propertyClass.details.fields.get(accessorName);
                        const accessType = accessSymbol ? this._program.getTypeForSymbol(accessSymbol) : undefined;

                        if (!accessType) {
                            return;
                        }

                        if (
                            !this._validateSymbolType(
                                report,
                                symbolInfo,
                                accessType,
                                getEmptyRange(),
                                '',
                                publicSymbolMap
                            )
                        ) {
                            isTypeKnown = false;
                        }
                    });

                    return isTypeKnown;
                }

                let isKnown = true;

                if (!this._shouldIgnoreType(report, type.details.fullName)) {
                    // Don't bother type-checking built-in types.
                    if (!ClassType.isBuiltIn(type)) {
                        // Reference the class.
                        this._getSymbolForClass(report, type, publicSymbolMap);
                    }

                    // Analyze type arguments if present to make sure they are known.
                    if (type.typeArguments) {
                        type.typeArguments!.forEach((typeArg, index) => {
                            if (isUnknown(typeArg)) {
                                this._addSymbolError(
                                    symbolInfo,
                                    `Type argument ${index} has unknown type`,
                                    declRange,
                                    declFilePath
                                );
                                isKnown = false;
                            } else if (isPartlyUnknown(typeArg)) {
                                const diag = new DiagnosticAddendum();
                                diag.addMessage(
                                    `Type is ${this._program.printType(typeArg, /* expandTypeAlias */ false)}`
                                );
                                this._addSymbolError(
                                    symbolInfo,
                                    `Type argument ${index} has partially unknown type` + diag.getString(),
                                    declRange,
                                    declFilePath
                                );
                                isKnown = false;
                            }
                        });
                    }
                }

                if (!isKnown) {
                    symbolInfo.typeKnownStatus = TypeKnownStatus.PartiallyUnknown;
                }

                return isKnown;
            }

            case TypeCategory.Module: {
                let isKnown = true;

                if (!this._shouldIgnoreType(report, type.moduleName)) {
                    const moduleSymbol = this._getSymbolForModule(report, type, publicSymbolMap);
                    if (moduleSymbol.typeKnownStatus !== TypeKnownStatus.Known) {
                        this._addSymbolError(
                            symbolInfo,
                            `Module "${moduleSymbol.fullName}" is partially unknown`,
                            declRange,
                            declFilePath
                        );
                        isKnown = false;
                    }
                }

                if (!isKnown) {
                    symbolInfo.typeKnownStatus = TypeKnownStatus.PartiallyUnknown;
                }

                return isKnown;
            }
        }
    }

    private _validateFunctionType(
        report: PackageTypeReport,
        type: FunctionType,
        publicSymbolMap: PublicSymbolMap,
        symbolInfo?: SymbolInfo,
        declRange?: Range,
        declFilePath?: string,
        diag?: DiagnosticAddendum
    ): boolean {
        let isKnown = true;

        // If the file path wasn't provided, try to get it from the type.
        if (type.details.declaration && !declFilePath) {
            declFilePath = type.details.declaration.path;
        }

        type.details.parameters.forEach((param, index) => {
            // Skip nameless parameters like "*" and "/".
            if (param.name) {
                if (!param.hasDeclaredType) {
                    // Allow params (like "self" and "cls") to skip declarations because
                    // we're able to synthesize these.
                    const isSynthesized =
                        index === 0 &&
                        (FunctionType.isClassMethod(type) ||
                            FunctionType.isInstanceMethod(type) ||
                            FunctionType.isConstructorMethod(type));

                    if (!isSynthesized) {
                        if (symbolInfo) {
                            this._addSymbolError(
                                symbolInfo,
                                `Type annotation for parameter "${param.name}" is missing`,
                                declRange || getEmptyRange(),
                                declFilePath || ''
                            );
                        }
                        if (diag) {
                            diag.createAddendum().addMessage(
                                `Type annotation for parameter "${param.name}" is missing`
                            );
                        }
                        isKnown = false;
                    }
                } else if (isUnknown(param.type)) {
                    if (symbolInfo) {
                        this._addSymbolError(
                            symbolInfo,
                            `Type of parameter "${param.name}" is unknown`,
                            declRange || getEmptyRange(),
                            declFilePath || ''
                        );
                        if (diag) {
                            diag.createAddendum().addMessage(`Type of parameter "${param.name}" is unknown`);
                        }
                    }
                    isKnown = false;
                } else {
                    const extraInfo = new DiagnosticAddendum();
                    if (!this._isTypeKnown(report, param.type, publicSymbolMap, extraInfo.createAddendum())) {
                        extraInfo.addMessage(
                            `Parameter type is "${this._program.printType(param.type, /* expandTypeAlias */ false)}"`
                        );
                        if (symbolInfo) {
                            this._addSymbolError(
                                symbolInfo,
                                `Type of parameter "${param.name}" is partially unknown` + extraInfo.getString(),
                                declRange || getEmptyRange(),
                                declFilePath || ''
                            );
                        }
                        if (diag) {
                            const subDiag = diag.createAddendum();
                            subDiag.addMessage(`Type of parameter "${param.name}" is partially unknown`);
                            subDiag.addAddendum(extraInfo);
                        }
                        isKnown = false;
                    }
                }
            }
        });

        if (type.details.declaredReturnType) {
            if (isUnknown(type.details.declaredReturnType)) {
                if (symbolInfo) {
                    this._addSymbolError(
                        symbolInfo,
                        `Return type is unknown`,
                        declRange || getEmptyRange(),
                        declFilePath || ''
                    );
                }
                isKnown = false;
            } else {
                const extraInfo = new DiagnosticAddendum();
                if (
                    !this._isTypeKnown(
                        report,
                        type.details.declaredReturnType,
                        publicSymbolMap,
                        extraInfo.createAddendum()
                    )
                ) {
                    extraInfo.addMessage(
                        `Return type is "${this._program.printType(
                            type.details.declaredReturnType,
                            /* expandTypeAlias */ false
                        )}"`
                    );
                    if (symbolInfo) {
                        this._addSymbolError(
                            symbolInfo,
                            `Return type is partially unknown` + extraInfo.getString(),
                            declRange || getEmptyRange(),
                            declFilePath || ''
                        );
                    }
                    if (diag) {
                        const subDiag = diag.createAddendum();
                        subDiag.addMessage(`Return type is partially unknown`);
                        subDiag.addAddendum(extraInfo);
                    }
                    isKnown = false;
                }
            }
        } else {
            // Init methods have an implied return type.
            if (type.details.name !== '__init__') {
                if (symbolInfo) {
                    this._addSymbolError(
                        symbolInfo,
                        `Return type annotation is missing`,
                        declRange || getEmptyRange(),
                        declFilePath || ''
                    );
                }
                if (diag) {
                    diag.createAddendum().addMessage(`Return type annotation is missing`);
                }
                isKnown = false;
            }
        }

        if (!type.details.docString) {
            // Don't require docstrings for dunder methods.
            if (symbolInfo?.isExported && !isDunderName(symbolInfo.name)) {
                if (symbolInfo) {
                    this._addSymbolWarning(
                        symbolInfo,
                        `No docstring found for function "${symbolInfo.fullName}"`,
                        declRange || getEmptyRange(),
                        declFilePath || ''
                    );
                }

                report.missingFunctionDocStringCount++;
            }
        }

        if (type.details.parameters.find((param) => param.defaultType && isEllipsisType(param.defaultType))) {
            if (symbolInfo) {
                this._addSymbolWarning(
                    symbolInfo,
                    `One or more default values in function "${symbolInfo.fullName}" is specified as "..."`,
                    declRange || getEmptyRange(),
                    declFilePath || ''
                );
            }

            report.missingDefaultParamCount++;
        }

        if (!isKnown && symbolInfo) {
            symbolInfo.typeKnownStatus = TypeKnownStatus.PartiallyUnknown;
        }

        return isKnown;
    }

    private _getSymbolForClass(
        report: PackageTypeReport,
        type: ClassType,
        publicSymbolMap: PublicSymbolMap
    ): SymbolInfo {
        // See if this type is already analyzed.
        const cachedType = report.symbols.get(type.details.fullName);
        if (cachedType) {
            cachedType.referenceCount++;
            return cachedType;
        }

        const symbolInfo: SymbolInfo = {
            category: SymbolCategory.Class,
            name: type.details.name,
            fullName: type.details.fullName,
            filePath: type.details.filePath,
            isExported: publicSymbolMap.has(type.details.fullName),
            typeKnownStatus: TypeKnownStatus.Known,
            referenceCount: 1,
            diagnostics: [],
        };

        this._addSymbol(report, symbolInfo);

        // Determine whether the class has a proper doc string.
        if (symbolInfo.isExported && !type.details.docString) {
            this._addSymbolWarning(
                symbolInfo,
                `No docstring found for class "${type.details.fullName}"`,
                getEmptyRange(),
                ''
            );

            report.missingClassDocStringCount++;
        }

        if (
            !this._verifySymbolsInSymbolTable(
                report,
                type.details.fullName,
                type.details.fields,
                ScopeType.Class,
                publicSymbolMap
            )
        ) {
            symbolInfo.typeKnownStatus = TypeKnownStatus.PartiallyUnknown;
        }

        // Add information for the metaclass.
        if (type.details.effectiveMetaclass) {
            if (!isInstantiableClass(type.details.effectiveMetaclass)) {
                this._addSymbolError(symbolInfo, `Type of metaclass unknown`, getEmptyRange(), '');
                symbolInfo.typeKnownStatus = TypeKnownStatus.PartiallyUnknown;
            } else {
                const diag = new DiagnosticAddendum();
                if (!this._isTypeKnown(report, type.details.effectiveMetaclass, publicSymbolMap, diag)) {
                    this._addSymbolError(
                        symbolInfo,
                        `Type of metaclass "${type.details.effectiveMetaclass}" is partially unknown` +
                            diag.getString(),
                        getEmptyRange(),
                        ''
                    );
                    symbolInfo.typeKnownStatus = TypeKnownStatus.PartiallyUnknown;
                }
            }
        }

        // Add information for base classes.
        type.details.baseClasses.forEach((baseClass) => {
            if (!isInstantiableClass(baseClass)) {
                this._addSymbolError(symbolInfo, `Type of base class unknown`, getEmptyRange(), '');
                symbolInfo.typeKnownStatus = TypeKnownStatus.PartiallyUnknown;
            } else {
                // Handle "tuple" specially. Even though it's a generic class, it
                // doesn't require a type argument.
                if (ClassType.isBuiltIn(baseClass, 'tuple')) {
                    return;
                }

                const diag = new DiagnosticAddendum();
                if (!this._isTypeKnown(report, baseClass, publicSymbolMap, diag)) {
                    this._addSymbolError(
                        symbolInfo,
                        `Type of base class "${baseClass.details.fullName}" is partially unknown` + diag.getString(),
                        getEmptyRange(),
                        ''
                    );
                    symbolInfo.typeKnownStatus = TypeKnownStatus.PartiallyUnknown;
                }
            }
        });

        return symbolInfo;
    }

    private _getSymbolForModule(
        report: PackageTypeReport,
        type: ModuleType,
        publicSymbolMap: PublicSymbolMap
    ): SymbolInfo {
        // See if this type is already analyzed.
        const cachedType = report.symbols.get(type.moduleName);
        if (cachedType) {
            cachedType.referenceCount++;
            return cachedType;
        }

        const symbolInfo: SymbolInfo = {
            category: SymbolCategory.Module,
            name: type.moduleName,
            fullName: type.moduleName,
            filePath: type.filePath,
            isExported: publicSymbolMap.has(type.moduleName),
            typeKnownStatus: TypeKnownStatus.Known,
            referenceCount: 1,
            diagnostics: [],
        };

        this._addSymbol(report, symbolInfo);

        if (
            !this._verifySymbolsInSymbolTable(report, type.moduleName, type.fields, ScopeType.Module, publicSymbolMap)
        ) {
            symbolInfo.typeKnownStatus = TypeKnownStatus.PartiallyUnknown;
        }

        return symbolInfo;
    }

    private _isTypeKnown(
        report: PackageTypeReport,
        type: Type,
        publicSymbolMap: PublicSymbolMap,
        diag: DiagnosticAddendum
    ): boolean {
        switch (type.category) {
            case TypeCategory.Unbound:
            case TypeCategory.Any:
            case TypeCategory.None:
            case TypeCategory.Never:
            case TypeCategory.TypeVar:
                return true;

            case TypeCategory.Unknown: {
                return false;
            }

            case TypeCategory.Union: {
                let isKnown = true;
                doForEachSubtype(type, (subtype) => {
                    if (!this._isTypeKnown(report, subtype, publicSymbolMap, diag.createAddendum())) {
                        isKnown = false;
                    }
                });

                return isKnown;
            }

            case TypeCategory.OverloadedFunction: {
                let isKnown = true;
                for (const overload of type.overloads) {
                    if (!this._isTypeKnown(report, overload, publicSymbolMap, diag.createAddendum())) {
                        isKnown = false;
                    }
                }

                return isKnown;
            }

            case TypeCategory.Function: {
                if (!this._shouldIgnoreType(report, type.details.fullName)) {
                    return this._validateFunctionType(
                        report,
                        type,
                        publicSymbolMap,
                        /* symbolInfo */ undefined,
                        /* declRange */ undefined,
                        /* declFilePath */ undefined,
                        diag
                    );
                }

                return true;
            }

            case TypeCategory.Class: {
                let isKnown = true;

                if (!this._shouldIgnoreType(report, type.details.fullName)) {
                    // Don't bother type-checking built-in types.
                    if (!ClassType.isBuiltIn(type)) {
                        // Reference the class.
                        this._getSymbolForClass(report, type, publicSymbolMap);
                    }

                    // Analyze type arguments if present to make sure they are known.
                    if (type.typeArguments) {
                        type.typeArguments!.forEach((typeArg, index) => {
                            if (isUnknown(typeArg)) {
                                diag.addMessage(`Type argument ${index} has unknown type`);
                                isKnown = false;
                            } else if (isPartlyUnknown(typeArg)) {
                                diag.addMessage(`Type argument ${index} has partially unknown type`);
                                isKnown = false;
                            }
                        });
                    }
                }

                return isKnown;
            }

            case TypeCategory.Module: {
                let isKnown = true;

                if (!this._shouldIgnoreType(report, type.moduleName)) {
                    const moduleSymbol = this._getSymbolForModule(report, type, publicSymbolMap);
                    if (moduleSymbol.typeKnownStatus !== TypeKnownStatus.Known) {
                        isKnown = false;
                    }
                }

                return isKnown;
            }
        }
    }

    private _getSymbolCategory(symbol: Symbol, type: Type): SymbolCategory {
        if (type.typeAliasInfo) {
            return SymbolCategory.TypeAlias;
        }

        switch (type.category) {
            case TypeCategory.Function:
            case TypeCategory.OverloadedFunction: {
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

    private _getDirectoryForPackage(packageName: string): string | undefined {
        const moduleDescriptor: ImportedModuleDescriptor = {
            leadingDots: 0,
            nameParts: [packageName],
            importedSymbols: [],
        };

        const importResult = this._importResolver.resolveImport('', this._execEnv, moduleDescriptor);

        if (importResult.isImportFound) {
            const resolvedPath = importResult.resolvedPaths[importResult.resolvedPaths.length - 1];
            return getDirectoryPath(resolvedPath);
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

    private _addSymbolError(symbolInfo: SymbolInfo, message: string, declRange: Range, declFilePath: string) {
        symbolInfo.diagnostics.push({
            diagnostic: new Diagnostic(DiagnosticCategory.Error, message, declRange),
            filePath: declFilePath,
        });
    }

    private _addSymbolWarning(symbolInfo: SymbolInfo, message: string, declRange: Range, declFilePath: string) {
        symbolInfo.diagnostics.push({
            diagnostic: new Diagnostic(DiagnosticCategory.Warning, message, declRange),
            filePath: declFilePath,
        });
    }
}
