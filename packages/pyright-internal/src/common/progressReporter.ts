/*
 * progressReporter.ts
 *
 * Implements progress reporter.
 */

export interface ProgressReporter {
    isEnabled(data: any): boolean;
    begin(): void;
    report(message: string): void;
    end(): void;
}

export class ProgressReportTracker implements ProgressReporter {
    // Tracks whether we're currently displaying progress.
    private _isDisplayingProgress = false;

    constructor(private _reporter: ProgressReporter) {}

    isEnabled(data: any): boolean {
        if (this._isDisplayingProgress) {
            return true;
        }

        return this._reporter.isEnabled(data) ?? false;
    }

    begin(): void {
        if (this._isDisplayingProgress) {
            return;
        }

        this._isDisplayingProgress = true;
        this._reporter.begin();
    }

    report(message: string): void {
        if (!this._isDisplayingProgress) {
            return;
        }

        this._reporter.report(message);
    }

    end(): void {
        if (!this._isDisplayingProgress) {
            return;
        }

        this._isDisplayingProgress = false;
        this._reporter.end();
    }
}
