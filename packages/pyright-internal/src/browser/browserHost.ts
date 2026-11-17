import { CaseSensitivityDetector } from '../common/caseSensitivityDetector';

export class BrowserCaseSensitivityDetector implements CaseSensitivityDetector {
    isCaseSensitive(_uri: string): boolean {
        return true;
    }
}
