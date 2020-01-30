/*
* fourslashrunner.test.ts
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
*/
import * as path from "path";
import * as io from "./harness/io";
import { normalizeSlashes } from "../common/pathUtils";
import { runFourSlashTest } from "./harness/fourslash/runner";
import { srcFolder } from "./harness/vfs/factory";

describe("fourslash tests", () => {
    const testFiles: string[] = [];

    const basePath = path.resolve(path.dirname(module.filename), "fourslash/");
    for (const file of io.IO.listFiles(basePath, /.*\.fourslash\.ts$/i, { recursive: true })) {
        testFiles.push(file);
    }

    testFiles.forEach(file => {
        describe(file, () => {
            const fn = normalizeSlashes(file);
            const justName = fn.replace(/^.*[\\/]/, "");

            it("fourslash test " + justName + " runs correctly", () => {
                runFourSlashTest(srcFolder, fn);
            });
        });
    });
});