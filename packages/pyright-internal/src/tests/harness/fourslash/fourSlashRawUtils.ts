import { FourSlashData, FourSlashFile, RawContentMapping, RawToken } from './fourSlashTypes';

export function getRawTokenText(rawText: string, token: RawToken): string {
    return rawText.slice(token.start, token.end);
}

export function reconstructRawTextFromTokens(data: FourSlashData): string {
    if (!data.rawText || !data.rawTokens) {
        return '';
    }

    return data.rawTokens.map((t) => data.rawText!.slice(t.start, t.end)).join('');
}

export function getFileAtRawOffset(data: FourSlashData, rawOffset: number): FourSlashFile | undefined {
    const tokenIndex = findTokenIndexAtOrAfter(data.rawTokens ?? [], rawOffset);

    for (const file of data.files) {
        const ranges = file.rawData?.tokenRanges;
        if (!ranges) {
            continue;
        }

        for (const r of ranges) {
            if (tokenIndex >= r.startToken && tokenIndex < r.endToken) {
                return file;
            }
        }
    }

    return undefined;
}

export function tryConvertRawOffsetToContentOffset(file: FourSlashFile, rawOffset: number): number | undefined {
    const mapping = file.rawData?.rawToContent;
    if (!mapping) {
        return undefined;
    }

    return tryConvertRawOffsetToContentOffsetWithMapping(mapping, rawOffset);
}

export function tryConvertContentOffsetToRawOffset(file: FourSlashFile, contentOffset: number): number | undefined {
    const mapping = file.rawData?.contentToRaw;
    if (!mapping) {
        return undefined;
    }

    return tryConvertContentOffsetToRawOffsetWithMapping(mapping, contentOffset);
}

export function tryConvertRawOffsetToContentOffsetWithMapping(
    mapping: RawContentMapping,
    rawOffset: number
): number | undefined {
    const seg = findItemContainingOffset(
        mapping.segments,
        rawOffset,
        (s) => s.rawStart,
        (s) => s.rawEnd
    );
    if (!seg) {
        const last = mapping.segments[mapping.segments.length - 1];
        if (last && rawOffset === last.rawEnd) {
            // Allow EOF raw offsets for the mapped content (end-exclusive).
            return last.contentEnd;
        }

        return undefined;
    }

    return seg.contentStart + (rawOffset - seg.rawStart);
}

export function tryConvertContentOffsetToRawOffsetWithMapping(
    mapping: RawContentMapping,
    contentOffset: number
): number | undefined {
    const seg = findItemContainingOffset(
        mapping.segments,
        contentOffset,
        (s) => s.contentStart,
        (s) => s.contentEnd
    );
    if (!seg) {
        const segments = mapping.segments;
        if (segments.length === 0) {
            return undefined;
        }

        const last = segments[segments.length - 1];
        if (contentOffset === last.contentEnd) {
            // Allow EOF content offsets.
            return last.rawEnd;
        }

        const insertionIndex = upperBoundIndex(segments, contentOffset, (s) => s.contentStart);
        const prev = insertionIndex - 1;
        if (prev >= 0 && segments[prev].contentEnd === contentOffset) {
            // Allow mapping at a segment boundary (use the left segment).
            return segments[prev].rawEnd;
        }

        return undefined;
    }

    return seg.rawStart + (contentOffset - seg.contentStart);
}

export function findTokenIndexAtOrAfter(rawTokens: RawToken[], rawOffset: number): number {
    if (rawOffset <= 0) {
        return 0;
    }
    if (rawTokens.length === 0) {
        return 0;
    }
    if (rawOffset >= rawTokens[rawTokens.length - 1].end) {
        return rawTokens.length;
    }

    const insertionIndex = lowerBoundIndex(rawTokens, rawOffset, (t) => t.start);

    // If the token at insertionIndex starts exactly at the offset, it's a direct hit.
    if (insertionIndex < rawTokens.length) {
        const token = rawTokens[insertionIndex];
        if (rawOffset >= token.start && rawOffset < token.end) {
            return insertionIndex;
        }
    }

    // Otherwise, the token immediately before may still contain the offset.
    const prev = insertionIndex - 1;
    if (prev >= 0 && rawOffset < rawTokens[prev].end) {
        return prev;
    }

    // No containing token; return insertion index.
    return insertionIndex;
}

export function lowerBoundIndex<T>(items: readonly T[], value: number, keySelector: (item: T) => number): number {
    let low = 0;
    let high = items.length;

    while (low < high) {
        const mid = (low + high) >> 1;
        if (value <= keySelector(items[mid])) {
            high = mid;
        } else {
            low = mid + 1;
        }
    }

    return low;
}

export function upperBoundIndex<T>(items: readonly T[], value: number, keySelector: (item: T) => number): number {
    let low = 0;
    let high = items.length;

    while (low < high) {
        const mid = (low + high) >> 1;
        if (value < keySelector(items[mid])) {
            high = mid;
        } else {
            low = mid + 1;
        }
    }

    return low;
}

export function findItemContainingOffset<T>(
    items: readonly T[],
    offset: number,
    getStart: (item: T) => number,
    getEnd: (item: T) => number
): T | undefined {
    // Find the last item whose start is <= offset (i.e. upperBound(start) - 1),
    // then validate the offset is strictly before its end.
    const insertionIndex = upperBoundIndex(items, offset, getStart);
    const candidateIndex = insertionIndex - 1;
    if (candidateIndex < 0) {
        return undefined;
    }

    const candidate = items[candidateIndex];
    return offset < getEnd(candidate) ? candidate : undefined;
}
