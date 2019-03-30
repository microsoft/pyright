/*
* progress.ts
*
* Copyright (c) Microsoft Corporation.
* Licensed under the MIT license.
*
* Provides a way for the pyright language server to report progress
* back to the client and display it in the editor.
*/

import { Progress, ProgressLocation, window } from 'vscode';
import { Disposable, LanguageClient } from 'vscode-languageclient';

const AnalysisTimeoutInMs: number = 60000;

export class ProgressReporting implements Disposable {
    private _progress: Progress<{ message?: string; increment?: number }> | undefined;
    private _progressTimeout: NodeJS.Timer | undefined;
    private _resolveProgress?: (value?: void | PromiseLike<void>) => void;

    constructor(languageClient: LanguageClient) {
        languageClient.onReady().then(() => {
            languageClient.onNotification('pyright/beginProgress', async () => {
                let progressPromise = new Promise<void>(resolve => {
                    this._resolveProgress = resolve;
                });

                window.withProgress({
                    location: ProgressLocation.Window,
                    title: ''
                }, progress => {
                    this._progress = progress;
                    return progressPromise;
                });

                this._primeTimeoutTimer();
            });

            languageClient.onNotification('pyright/reportProgress', (message: string) => {
                if (this._progress) {
                    this._progress.report({ message });
                    this._primeTimeoutTimer();
                }
            });

            languageClient.onNotification('pyright/endProgress', () => {
                this._clearProgress();
            });
        });
    }

    public dispose() {
        this._clearProgress();
    }

    private _clearProgress(): void {
        if (this._resolveProgress) {
            this._resolveProgress();
            this._resolveProgress = undefined;
        }

        if (this._progressTimeout) {
            clearTimeout(this._progressTimeout);
            this._progressTimeout = undefined;
        }
    }

    private _primeTimeoutTimer(): void {
        if (this._progressTimeout) {
            clearTimeout(this._progressTimeout);
            this._progressTimeout = undefined;
        }

        this._progressTimeout = setTimeout(() => this._handleTimeout(), AnalysisTimeoutInMs);
    }

    private _handleTimeout(): void {
        this._clearProgress();
    }
}
