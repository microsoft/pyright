import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { CaseSensitivityDetector } from './caseSensitivityDetector';
import { ConsoleInterface } from './console';
import { FileWatcherProvider } from './fileWatcher';
import { RealFileSystem } from './realFileSystem';

interface CacheMetadata {
    version: string;           // Pyright version
    pythonVersion?: string;    // Python version
    timestamp: number;         // Cache creation time
    fileCount: number;         // Number of cached files
    configHash: string;        // Hash of pyright config
}

interface FileCacheEntry {
    contentHash: string;       // SHA256 of file content
    mtime: number;             // File modification time
    size: number;              // File size in bytes
    data: any;                 // Serialized parse/analysis data
    dependencies: string[];    // List of dependent file paths
}

export class PersistentCacheFileSystem extends RealFileSystem {
    private _cacheDir: string;
    private _memoryCache: Map<string, FileCacheEntry>;
    private _metadata!: CacheMetadata;
    private _cacheHits: number = 0;
    private _cacheMisses: number = 0;
    private _enabled: boolean;

    constructor(
        caseSensitiveDetector: CaseSensitivityDetector,
        console: ConsoleInterface,
        fileWatcherProvider: FileWatcherProvider,
        cacheDir: string = '.pyright_cache',
        enabled: boolean = true
    ) {
        super(caseSensitiveDetector, console, fileWatcherProvider);
        this._cacheDir = path.resolve(cacheDir);
        this._memoryCache = new Map();
        this._enabled = enabled;

        if (this._enabled) {
            this._initializeCache();
        }
    }

    getCachedData(filePath: string): any | null {
        if (!this._enabled) {
            return null;
        }

        const cacheKey = this._getCacheKey(filePath);

        // Check memory cache first
        if (this._memoryCache.has(cacheKey)) {
            const entry = this._memoryCache.get(cacheKey)!;
            if (this._isEntryValid(filePath, entry)) {
                this._cacheHits++;
                return entry.data;
            } else {
                this._memoryCache.delete(cacheKey);
            }
        }

        // Check disk cache
        const cachePath = path.join(this._cacheDir, 'files', cacheKey + '.json');
        if (fs.existsSync(cachePath)) {
            try {
                const entry: FileCacheEntry = JSON.parse(fs.readFileSync(cachePath, 'utf8'));

                if (this._isEntryValid(filePath, entry)) {
                    this._memoryCache.set(cacheKey, entry);
                    this._cacheHits++;
                    return entry.data;
                } else {
                    // Invalid cache entry, delete it
                    fs.unlinkSync(cachePath);
                }
            } catch (e) {
                // Corrupted cache entry, try to delete it
                try {
                    fs.unlinkSync(cachePath);
                } catch {
                    // Ignore if we can't delete
                }
            }
        }

        this._cacheMisses++;
        return null;
    }

    setCachedData(filePath: string, data: any, dependencies: string[] = []): void {
        if (!this._enabled) {
            return;
        }

        const cacheKey = this._getCacheKey(filePath);

        try {
            const stats = fs.statSync(filePath);
            const contentHash = this._getFileHash(filePath);

            const entry: FileCacheEntry = {
                contentHash,
                mtime: stats.mtimeMs,
                size: stats.size,
                data,
                dependencies,
            };

            // Store in memory cache
            this._memoryCache.set(cacheKey, entry);

            // Store in disk cache
            const cacheFilesDir = path.join(this._cacheDir, 'files');
            if (!fs.existsSync(cacheFilesDir)) {
                fs.mkdirSync(cacheFilesDir, { recursive: true });
            }

            const cachePath = path.join(cacheFilesDir, cacheKey + '.json');
            fs.writeFileSync(cachePath, JSON.stringify(entry, null, 2));
        } catch (e) {
            // Ignore cache write errors (console logging removed)
        }
    }

    saveMetadata(): void {
        if (!this._enabled) {
            return;
        }

        this._metadata.timestamp = Date.now();
        this._metadata.fileCount = this._memoryCache.size;

        const metaPath = path.join(this._cacheDir, 'metadata.json');
        fs.writeFileSync(metaPath, JSON.stringify(this._metadata, null, 2));

        // Save statistics
        const statsPath = path.join(this._cacheDir, 'stats.json');
        fs.writeFileSync(
            statsPath,
            JSON.stringify(
                {
                    cacheHits: this._cacheHits,
                    cacheMisses: this._cacheMisses,
                    hitRate: this._cacheHits / (this._cacheHits + this._cacheMisses) || 0,
                    totalFiles: this._metadata.fileCount,
                    timestamp: Date.now(),
                },
                null,
                2
            )
        );
    }

    clearCache(): void {
        if (fs.existsSync(this._cacheDir)) {
            const filesDir = path.join(this._cacheDir, 'files');
            if (fs.existsSync(filesDir)) {
                const files = fs.readdirSync(filesDir);
                for (const file of files) {
                    try {
                        fs.unlinkSync(path.join(filesDir, file));
                    } catch {
                        // Ignore deletion errors
                    }
                }
            }
        }
        this._memoryCache.clear();
    }

    getStats() {
        return {
            cacheHits: this._cacheHits,
            cacheMisses: this._cacheMisses,
            hitRate: this._cacheHits / (this._cacheHits + this._cacheMisses) || 0,
            memoryEntries: this._memoryCache.size,
            cacheDir: this._cacheDir,
        };
    }

    private _initializeCache(): void {
        // Create cache directory if it doesn't exist
        if (!fs.existsSync(this._cacheDir)) {
            fs.mkdirSync(this._cacheDir, { recursive: true });
        }

        // Load or create metadata
        const metaPath = path.join(this._cacheDir, 'metadata.json');
        if (fs.existsSync(metaPath)) {
            try {
                this._metadata = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
                // Console logging removed to avoid accessing private parent property
            } catch (e) {
                // Console warning removed to avoid accessing private parent property
                this._metadata = this._createMetadata();
            }
        } else {
            this._metadata = this._createMetadata();
        }

        // Validate cache version
        if (!this._isCacheValid()) {
            // Console logging removed to avoid accessing private parent property
            this.clearCache();
            this._metadata = this._createMetadata();
        }
    }

    private _createMetadata(): CacheMetadata {
        return {
            version: this._getPyrightVersion(),
            pythonVersion: process.env.PYTHON_VERSION,
            timestamp: Date.now(),
            fileCount: 0,
            configHash: this._getConfigHash(),
        };
    }

    private _getPyrightVersion(): string {
        try {
            // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
            const packageJson = require('../../../package.json');
            return packageJson.version;
        } catch {
            return 'unknown';
        }
    }

    private _getConfigHash(): string {
        // Hash pyrightconfig.json if it exists
        const configPaths = ['pyrightconfig.json', 'pyproject.toml'];
        const configs: string[] = [];

        for (const configPath of configPaths) {
            if (fs.existsSync(configPath)) {
                configs.push(fs.readFileSync(configPath, 'utf8'));
            }
        }

        return crypto.createHash('sha256').update(configs.join('\n')).digest('hex');
    }

    private _isCacheValid(): boolean {
        const currentVersion = this._getPyrightVersion();
        const currentConfigHash = this._getConfigHash();

        return this._metadata.version === currentVersion && this._metadata.configHash === currentConfigHash;
    }

    private _getCacheKey(filePath: string): string {
        // Use relative path from cwd for portability across CI runs
        const cwd = process.cwd();
        const relativePath = path.relative(cwd, filePath);

        return crypto.createHash('sha256').update(relativePath).digest('hex');
    }

    private _getFileHash(filePath: string): string {
        try {
            const content = fs.readFileSync(filePath);
            return crypto.createHash('sha256').update(content).digest('hex');
        } catch {
            return '';
        }
    }

    private _isEntryValid(filePath: string, entry: FileCacheEntry): boolean {
        try {
            const stats = fs.statSync(filePath);

            // Fast check: mtime and size
            if (stats.mtimeMs !== entry.mtime || stats.size !== entry.size) {
                return false;
            }

            // Slower check: content hash (more reliable)
            const currentHash = this._getFileHash(filePath);
            if (currentHash !== entry.contentHash) {
                return false;
            }

            // Check if any dependencies changed
            for (const depPath of entry.dependencies) {
                if (!fs.existsSync(depPath)) {
                    return false;
                }

                const depCacheKey = this._getCacheKey(depPath);
                if (!this._memoryCache.has(depCacheKey)) {
                    const depData = this.getCachedData(depPath);
                    if (!depData) {
                        return false;
                    }
                }
            }

            return true;
        } catch {
            return false;
        }
    }
}
