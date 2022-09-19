"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
exports.__esModule = true;
/* eslint-disable @typescript-eslint/no-unused-vars */
// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.
var fs = require("fs");
var path = require("path");
var ts = require("typescript");
/**
 * A TypeScript language service host
 */
var TypeScriptLanguageServiceHost = /** @class */ (function () {
    function TypeScriptLanguageServiceHost(files, compilerOptions) {
        this._files = files;
        this._compilerOptions = compilerOptions;
    }
    TypeScriptLanguageServiceHost.prototype.readFile = function (path, encoding) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        return fs.readFileSync(path, { encoding: encoding }).toString();
    };
    TypeScriptLanguageServiceHost.prototype.fileExists = function (path) {
        return fs.existsSync(path);
    };
    // --- language service host ---------------
    TypeScriptLanguageServiceHost.prototype.getCompilationSettings = function () {
        return this._compilerOptions;
    };
    TypeScriptLanguageServiceHost.prototype.getScriptFileNames = function () {
        return this._files;
    };
    TypeScriptLanguageServiceHost.prototype.getScriptVersion = function (_fileName) {
        return '1';
    };
    TypeScriptLanguageServiceHost.prototype.getProjectVersion = function () {
        return '1';
    };
    TypeScriptLanguageServiceHost.prototype.getScriptSnapshot = function (fileName) {
        if (this._files.includes(fileName)) {
            return ts.ScriptSnapshot.fromString(fs.readFileSync(fileName).toString());
        }
        else {
            return ts.ScriptSnapshot.fromString('');
        }
    };
    TypeScriptLanguageServiceHost.prototype.getScriptKind = function (_fileName) {
        return ts.ScriptKind.TS;
    };
    TypeScriptLanguageServiceHost.prototype.getCurrentDirectory = function () {
        return '';
    };
    TypeScriptLanguageServiceHost.prototype.getDefaultLibFileName = function (_options) {
        return 'defaultLib:lib.d.ts';
    };
    TypeScriptLanguageServiceHost.prototype.isDefaultLibFileName = function (fileName) {
        return fileName === this.getDefaultLibFileName(this._compilerOptions);
    };
    return TypeScriptLanguageServiceHost;
}());
function findNode(sourceFile, position) {
    var found;
    sourceFile.forEachChild(visit);
    function visit(node) {
        if (node.pos === position) {
            found = node;
            return;
        }
        else if (node.pos > position) {
            return;
        }
        ts.forEachChild(node, visit);
    }
    return found;
}
var fileDescriptor = 0;
function writeOutput(line) {
    if (fileDescriptor === 0) {
        fileDescriptor = fs.openSync("./TELEMETRY.md", 'w');
    }
    fs.writeFileSync(fileDescriptor, line + "\n");
}
var MultineLineRegex = /(?:\/\*)((.|[\r\n])*?)(?:\*\/)/g;
var StarRemovalRegex = /(?:\*)((.|[\r\n])*?)(.*)/g;
var NormalRemovalRegex = /(?:\/\/)((.|[\r\n])*?)(.*)/g;
function extractLinesFromComments(comment) {
    // Strip out comment on each line
    MultineLineRegex.lastIndex = -1;
    var multineLineMatch = MultineLineRegex.exec(comment);
    if (multineLineMatch && multineLineMatch.length > 1) {
        // Scrape off the * on the front
        var withStars = multineLineMatch[1].toString();
        // Go through the star removal regex, adding up the lines
        StarRemovalRegex.lastIndex = -1;
        var m = null;
        var result = '';
        while ((m = StarRemovalRegex.exec(withStars)) !== null) {
            // This is necessary to avoid infinite loops with zero-width matches
            if (m.index === StarRemovalRegex.lastIndex) {
                StarRemovalRegex.lastIndex++;
            }
            if (m && m.length > 3) {
                result = result + "\n" + m[3];
            }
        }
        return result;
    }
    // Otherwise should be regular comments
    NormalRemovalRegex.lastIndex = -1;
    var regularCommentMatch = NormalRemovalRegex.test(comment);
    if (regularCommentMatch) {
        NormalRemovalRegex.lastIndex = -1;
        var m = null;
        var result = '';
        while ((m = NormalRemovalRegex.exec(comment)) !== null) {
            // This is necessary to avoid infinite loops with zero-width matches
            if (m.index === NormalRemovalRegex.lastIndex) {
                NormalRemovalRegex.lastIndex++;
            }
            if (m && m.length > 3) {
                result = result + "\n" + m[3];
            }
        }
        return result;
    }
    // No comments found
    return '';
}
function computeDescription(host, indexNode, grandParent, indexSourceFile) {
    if (grandParent && grandParent.pos < indexNode.pos - 10) {
        var lineOfRef = indexSourceFile.getLineAndCharacterOfPosition(indexNode.pos);
        var lineOfGrandParent = indexSourceFile.getLineAndCharacterOfPosition(grandParent.pos);
        if (lineOfRef.line > lineOfGrandParent.line + 1) {
            var snapshot = host.getScriptSnapshot("./" + indexSourceFile.fileName);
            var startLinePos = indexSourceFile.getPositionOfLineAndCharacter(lineOfGrandParent.line + 1, 0);
            var endLinePos = indexSourceFile.getPositionOfLineAndCharacter(lineOfRef.line, 0);
            var comment = snapshot.getText(startLinePos, endLinePos);
            return extractLinesFromComments(comment);
        }
    }
    return '';
}
function computeLocations(program, host, references, indexNode) {
    var locations = [];
    references.forEach(function (r) {
        var refSourceFile = program === null || program === void 0 ? void 0 : program.getSourceFile(r.fileName);
        if (refSourceFile) {
            var refNode = findNode(refSourceFile, r.textSpan.start);
            if (refNode && refNode.pos !== indexNode.pos) {
                var snapshot = host.getScriptSnapshot("./" + refSourceFile.fileName);
                // Grab 3 lines in each direction around this refnode for the location
                var lineAndChar = refSourceFile.getLineAndCharacterOfPosition(refNode.pos);
                var startPos = refSourceFile.getPositionOfLineAndCharacter(Math.max(lineAndChar.line - 3, 0), 0);
                var endPos = refSourceFile.getLineEndOfPosition(refSourceFile.getPositionOfLineAndCharacter(lineAndChar.line + 3, 0));
                locations.push({
                    file: refSourceFile.fileName,
                    line: lineAndChar.line,
                    char: lineAndChar.character,
                    code: snapshot.getText(startPos, endPos)
                });
            }
        }
    });
    return locations;
}
function computeProperties(host, indexNode, indexSourceFile) {
    var properties = [];
    var greatGrandParent = indexNode.parent.parent.parent;
    if (greatGrandParent) {
        // Should have 4 children if any properties. 3rd one is the
        // type for the class
        var thirdChild = greatGrandParent.getChildAt(2, indexSourceFile);
        // If this is a type declaration, we have properties
        if (thirdChild && ts.isTypeLiteralNode(thirdChild)) {
            var snapshot_1 = host.getScriptSnapshot("./" + indexSourceFile.fileName);
            // Pull them apart
            thirdChild.members.forEach(function (m) {
                var lastToken = m.getLastToken(indexSourceFile);
                var name = snapshot_1.getText(m.pos, lastToken.end);
                var description = "";
                properties.push({ name: name, description: description });
            });
        }
    }
    return properties;
}
function generateTelemetryEntry(program, host, eventDefinition, indexNode, indexSourceFile, references) {
    var _a;
    // First compute event name. Should be in the form:
    // EnumMember = 'EVENT_NAME'
    var match = /\s*\w+\s*=\s*'(\w+.+)'/.exec(eventDefinition);
    var eventName = match ? match[1].toString() : eventDefinition;
    // Then compute description using the grandparent node (comments are ignored, so grandparent
    // should be the previous ; on the previous entry)
    var grandParent = (_a = indexNode.parent) === null || _a === void 0 ? void 0 : _a.parent;
    var description = computeDescription(host, indexNode, grandParent, indexSourceFile);
    // Then compute all of the locations that the reference telemetry is used
    var locations = computeLocations(program, host, references, indexNode);
    // Compute properties that are listed in the index node
    var properties = computeProperties(host, indexNode, indexSourceFile);
    // Return the telemetry entry
    return {
        name: eventName,
        description: description,
        locations: locations,
        properties: properties
    };
}
function writeTelemetryEntry(entry) {
    writeOutput("<details>");
    writeOutput("  <summary>" + entry.name + "</summary>\n");
    writeOutput("## Description\n");
    if (entry.description.length <= 2) {
        writeOutput("\nNo description provided\n");
    }
    else {
        writeOutput("\n" + entry.description + "\n");
    }
    writeOutput("## Properties\n");
    if (!entry.properties || entry.properties.length < 1) {
        writeOutput("\nNo properties for event\n");
    }
    else {
        entry.properties.forEach(function (p) {
            if (p.description && p.description.length > 2) {
                writeOutput("- " + p.name + " : ");
                writeOutput("  - " + p.description);
            }
            else {
                writeOutput("- " + p.name);
            }
        });
    }
    writeOutput("\n## Locations Used");
    if (!entry.locations || entry.locations.length < 1) {
        writeOutput("\nEvent can be removed. Not referenced anywhere\n");
    }
    else {
        entry.locations.forEach(function (l) {
            var link = "https://github.com/microsoft/vscode-jupyter/tree/main/" + l.file;
            writeOutput("\n[" + l.file + "](" + link + ")");
            writeOutput('```typescript');
            writeOutput(l.code.replace(/\r\n/g, '\n'));
            writeOutput('```\n');
        });
    }
    writeOutput("</details>");
}
/** Generate documentation for all classes in a set of .ts files */
function generateDocumentation(file, options) {
    var host = new TypeScriptLanguageServiceHost([file], options);
    var languageService = ts.createLanguageService(host, undefined, ts.LanguageServiceMode.Semantic);
    var program = languageService.getProgram();
    // Visit every sourceFile in the program
    if (program) {
        for (var _i = 0, _a = program.getSourceFiles(); _i < _a.length; _i++) {
            var sourceFile = _a[_i];
            if (!sourceFile.isDeclarationFile) {
                // Walk the tree to search for functions
                ts.forEachChild(sourceFile, visit.bind(undefined, sourceFile));
            }
        }
    }
    /** visit nodes finding exported classes */
    function visit(sourceFile, node) {
        var _a;
        console.log("Visiting " + ((_a = node.name) === null || _a === void 0 ? void 0 : _a.escapedText));
        if (ts.isFunctionDeclaration(node) && node.name) {
            if (node.name.escapedText === 'createTypeEvaluator') {
                // Recurse into the subfunctions
                ts.forEachChild(node, visit.bind(undefined, sourceFile));
            }
            else if (node.parent &&
                ts.isFunctionDeclaration(node.parent) &&
                node.parent.name &&
                node.parent.name.escapedText === 'createTypeEvaluator') {
                // We're in one of the sub parts. Start documenting
                console.log("Sub function " + node.name.escapedText);
            }
        }
    }
    /** True if this is visible outside this file, false otherwise */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    function isNodeExported(node) {
        return ((ts.getCombinedModifierFlags(node) & ts.ModifierFlags.Export) !== 0 ||
            (!!node.parent && node.parent.kind === ts.SyntaxKind.SourceFile));
    }
    // Write our header first
    writeOutput('# TypeEvaluator function blames\n');
    writeOutput('Expand each section to see more information about that function.\n');
    // Close our file
    fs.closeSync(fileDescriptor);
}
function generateTypeEvaluatorMd() {
    return __awaiter(this, void 0, void 0, function () {
        var file;
        return __generator(this, function (_a) {
            file = path.resolve(__filename, '../../../packages/pyright-internal/src/analyzer/typeEvaluator.ts');
            generateDocumentation(file, {
                target: ts.ScriptTarget.ES5,
                module: ts.ModuleKind.CommonJS
            });
            return [2 /*return*/];
        });
    });
}
generateTypeEvaluatorMd();
//# sourceMappingURL=generateTypeEvaluatorMd.js.map