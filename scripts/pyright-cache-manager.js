#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

class PyrightCacheManager {
    constructor(cacheDir = '.pyright_cache') {
        this.cacheDir = cacheDir;
    }

    getStats() {
        const statsPath = path.join(this.cacheDir, 'stats.json');
        const metaPath = path.join(this.cacheDir, 'metadata.json');

        if (!fs.existsSync(statsPath) || !fs.existsSync(metaPath)) {
            console.log('No cache found');
            return;
        }

        const stats = JSON.parse(fs.readFileSync(statsPath, 'utf8'));
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

        console.log('\n📊 Pyright Cache Statistics\n');
        console.log(`Version: ${meta.version}`);
        console.log(`Files Cached: ${meta.fileCount}`);
        console.log(`Cache Hits: ${stats.cacheHits}`);
        console.log(`Cache Misses: ${stats.cacheMisses}`);
        console.log(`Hit Rate: ${(stats.hitRate * 100).toFixed(2)}%`);
        console.log(`Last Updated: ${new Date(stats.timestamp).toLocaleString()}`);

        // Calculate cache size
        const cacheSize = this.getCacheSize();
        console.log(`Cache Size: ${this.formatBytes(cacheSize)}`);
    }

    getCacheSize() {
        if (!fs.existsSync(this.cacheDir)) return 0;

        let totalSize = 0;
        const walk = (dir) => {
            const files = fs.readdirSync(dir);
            for (const file of files) {
                const filePath = path.join(dir, file);
                const stats = fs.statSync(filePath);
                if (stats.isDirectory()) {
                    walk(filePath);
                } else {
                    totalSize += stats.size;
                }
            }
        };
        walk(this.cacheDir);
        return totalSize;
    }

    formatBytes(bytes) {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    }

    clear() {
        if (!fs.existsSync(this.cacheDir)) {
            console.log('No cache to clear');
            return;
        }

        const removeDir = (dir) => {
            if (fs.existsSync(dir)) {
                fs.readdirSync(dir).forEach(file => {
                    const filePath = path.join(dir, file);
                    if (fs.statSync(filePath).isDirectory()) {
                        removeDir(filePath);
                    } else {
                        fs.unlinkSync(filePath);
                    }
                });
                fs.rmdirSync(dir);
            }
        };

        removeDir(this.cacheDir);
        console.log('✅ Cache cleared successfully');
    }

    validate() {
        if (!fs.existsSync(this.cacheDir)) {
            console.log('❌ No cache found');
            return false;
        }

        const metaPath = path.join(this.cacheDir, 'metadata.json');
        if (!fs.existsSync(metaPath)) {
            console.log('❌ Cache metadata missing');
            return false;
        }

        try {
            const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));

            // Check version
            const packageJsonPath = path.join(__dirname, '../packages/pyright-internal/package.json');
            if (fs.existsSync(packageJsonPath)) {
                const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                if (meta.version !== packageJson.version) {
                    console.log(`⚠️  Cache version mismatch (cache: ${meta.version}, current: ${packageJson.version})`);
                    return false;
                }
            }

            // Check config hash
            const currentConfigHash = this.getConfigHash();
            if (meta.configHash !== currentConfigHash) {
                console.log('⚠️  Configuration changed since cache was created');
                return false;
            }

            console.log('✅ Cache is valid');
            return true;
        } catch (e) {
            console.log(`❌ Cache validation failed: ${e.message}`);
            return false;
        }
    }

    getConfigHash() {
        const configs = [];
        const configFiles = ['pyrightconfig.json', 'pyproject.toml'];

        for (const file of configFiles) {
            if (fs.existsSync(file)) {
                configs.push(fs.readFileSync(file, 'utf8'));
            }
        }

        return crypto.createHash('sha256')
            .update(configs.join('\n'))
            .digest('hex');
    }

    prune(maxAgeDays = 7) {
        if (!fs.existsSync(this.cacheDir)) {
            console.log('No cache to prune');
            return;
        }

        const filesDir = path.join(this.cacheDir, 'files');
        if (!fs.existsSync(filesDir)) return;

        const now = Date.now();
        const maxAge = maxAgeDays * 24 * 60 * 60 * 1000;
        let prunedCount = 0;

        const files = fs.readdirSync(filesDir);
        for (const file of files) {
            const filePath = path.join(filesDir, file);
            const stats = fs.statSync(filePath);

            if (now - stats.mtimeMs > maxAge) {
                fs.unlinkSync(filePath);
                prunedCount++;
            }
        }

        console.log(`🧹 Pruned ${prunedCount} old cache entries`);
    }

    export(outputPath) {
        if (!fs.existsSync(this.cacheDir)) {
            console.log('❌ No cache to export');
            return;
        }

        try {
            const tar = require('tar');
            tar.create(
                {
                    gzip: true,
                    file: outputPath,
                    cwd: path.dirname(this.cacheDir)
                },
                [path.basename(this.cacheDir)]
            ).then(() => {
                const size = fs.statSync(outputPath).size;
                console.log(`✅ Cache exported to ${outputPath} (${this.formatBytes(size)})`);
            }).catch(err => {
                console.error(`❌ Export failed: ${err.message}`);
            });
        } catch (e) {
            console.error(`❌ Export requires 'tar' package. Install with: npm install tar`);
        }
    }

    import(inputPath) {
        if (!fs.existsSync(inputPath)) {
            console.log(`❌ File not found: ${inputPath}`);
            return;
        }

        try {
            const tar = require('tar');
            tar.extract(
                {
                    file: inputPath,
                    cwd: path.dirname(this.cacheDir)
                }
            ).then(() => {
                console.log('✅ Cache imported successfully');
                this.validate();
            }).catch(err => {
                console.error(`❌ Import failed: ${err.message}`);
            });
        } catch (e) {
            console.error(`❌ Import requires 'tar' package. Install with: npm install tar`);
        }
    }
}

// CLI Interface
const manager = new PyrightCacheManager(process.env.PYRIGHT_CACHE_DIR || '.pyright_cache');

const command = process.argv[2];

switch (command) {
    case 'stats':
        manager.getStats();
        break;
    case 'clear':
        manager.clear();
        break;
    case 'validate':
        process.exit(manager.validate() ? 0 : 1);
        break;
    case 'prune':
        const days = parseInt(process.argv[3]) || 7;
        manager.prune(days);
        break;
    case 'export':
        const exportPath = process.argv[3] || 'pyright-cache.tar.gz';
        manager.export(exportPath);
        break;
    case 'import':
        const importPath = process.argv[3];
        if (!importPath) {
            console.log('Usage: node pyright-cache-manager.js import <path>');
            process.exit(1);
        }
        manager.import(importPath);
        break;
    default:
        console.log(`
Pyright Cache Manager

Usage: node pyright-cache-manager.js <command> [options]

Commands:
  stats              Show cache statistics
  clear              Clear all cached data
  validate           Validate cache integrity
  prune [days]       Remove cache entries older than N days (default: 7)
  export [path]      Export cache to tar.gz file (requires 'tar' package)
  import <path>      Import cache from tar.gz file (requires 'tar' package)

Environment Variables:
  PYRIGHT_CACHE_DIR  Cache directory path (default: .pyright_cache)
        `);
        process.exit(command ? 1 : 0);
}
