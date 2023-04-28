import { Range, TextDocumentContentChangeEvent } from 'vscode-languageserver';
import { FileEditAction } from '../common/editAction';

export function createFileEditActions(filePath: string, edits: TextDocumentContentChangeEvent[]): FileEditAction[] {
    return edits.map((edit) => {
        const range = (edit as any).range as Range;
        if (range) {
            return {
                range,
                replacementText: edit.text,
                filePath,
            };
        } else {
            return {
                range: {
                    start: { line: 0, character: 0 },
                    end: { line: 0, character: 0 },
                },
                replacementText: edit.text,
                filePath,
            };
        }
    });
}
