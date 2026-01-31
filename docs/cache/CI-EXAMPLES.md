# Pyright Cache Configuration Examples

This directory contains example CI configurations for using Pyright's persistent caching feature.

## Files

- **github-actions.yml** - GitHub Actions workflow with smart caching
- **gitlab-ci.yml** - GitLab CI configuration
- **circleci.yml** - CircleCI configuration
- **jenkinsfile** - Jenkins pipeline configuration

## Usage

1. Copy the appropriate file to your project's CI configuration directory
2. Adjust paths and settings as needed for your project
3. Ensure `.pyright_cache` is added to your `.gitignore`:

```gitignore
# Pyright persistent cache
.pyright_cache/
```

## Key Features

All examples include:

- ✅ Smart cache key generation based on file hashes
- ✅ Cache validation before use
- ✅ Automatic cache invalidation on config changes
- ✅ Cache statistics reporting
- ✅ Only save cache on main branch (where applicable)

## Environment Variables

Set these in your CI environment:

```bash
PYRIGHT_CACHE=true                    # Enable caching
PYRIGHT_CACHE_DIR=.pyright_cache      # Cache directory
PYTHON_VERSION=3.11                   # Python version (optional)
```

## Cache Key Strategy

The cache key includes:
- OS/platform
- Configuration file hash
- Python source files hash (abbreviated)

This ensures cache is invalidated when:
- Configuration changes
- Source code changes significantly
- Running on different OS

## Performance Tips

1. **Use restore-keys**: Fallback to partial cache matches
2. **Save on main only**: Prevents cache pollution from PRs
3. **Validate before use**: Catch corrupted or stale caches
4. **Monitor hit rates**: Use `npm run pyright:cache:stats`

## Troubleshooting

If cache isn't working:

```bash
# Check cache status
npm run pyright:cache:stats

# Validate cache
npm run pyright:cache:validate

# Clear and rebuild
npm run pyright:cache:clear
npx pyright
```

## See Also

- [Main Documentation](./README.md) - Complete caching guide
- [Pyright Documentation](https://microsoft.github.io/pyright/)
