from enum import IntEnum, IntFlag

class ApplyLocation(IntEnum):
    WORKDIR: int
    INDEX: int
    BOTH: int

class AttrCheck(IntFlag):
    FILE_THEN_INDEX: int
    INDEX_THEN_FILE: int
    INDEX_ONLY: int
    NO_SYSTEM: int
    INCLUDE_HEAD: int
    INCLUDE_COMMIT: int

class BlameFlag(IntFlag):
    NORMAL: int
    TRACK_COPIES_SAME_FILE: int
    TRACK_COPIES_SAME_COMMIT_MOVES: int
    TRACK_COPIES_SAME_COMMIT_COPIES: int
    TRACK_COPIES_ANY_COMMIT_COPIES: int
    FIRST_PARENT: int
    USE_MAILMAP: int
    IGNORE_WHITESPACE: int

class BlobFilter(IntFlag):
    CHECK_FOR_BINARY: int
    NO_SYSTEM_ATTRIBUTES: int
    ATTRIBUTES_FROM_HEAD: int
    ATTRIBUTES_FROM_COMMIT: int

class BranchType(IntFlag):
    LOCAL: int
    REMOTE: int
    ALL: int

class CheckoutNotify(IntFlag):
    NONE: int
    CONFLICT: int
    DIRTY: int
    UPDATED: int
    UNTRACKED: int
    IGNORED: int
    ALL: int

class CheckoutStrategy(IntFlag):
    NONE: int
    SAFE: int
    FORCE: int
    RECREATE_MISSING: int
    ALLOW_CONFLICTS: int
    REMOVE_UNTRACKED: int
    REMOVE_IGNORED: int
    UPDATE_ONLY: int
    DONT_UPDATE_INDEX: int
    NO_REFRESH: int
    SKIP_UNMERGED: int
    USE_OURS: int
    USE_THEIRS: int
    DISABLE_PATHSPEC_MATCH: int
    SKIP_LOCKED_DIRECTORIES: int
    DONT_OVERWRITE_IGNORED: int
    CONFLICT_STYLE_MERGE: int
    CONFLICT_STYLE_DIFF3: int
    DONT_REMOVE_EXISTING: int
    DONT_WRITE_INDEX: int
    DRY_RUN: int
    CONFLICT_STYLE_ZDIFF3: int

class ConfigLevel(IntEnum):
    PROGRAMDATA: int
    SYSTEM: int
    XDG: int
    GLOBAL: int
    LOCAL: int
    APP: int
    HIGHEST_LEVEL: int

class CredentialType(IntFlag):
    USERPASS_PLAINTEXT: int
    SSH_KEY: int
    SSH_CUSTOM: int
    DEFAULT: int
    SSH_INTERACTIVE: int
    USERNAME: int
    SSH_MEMORY: int

class DeltaStatus(IntEnum):
    UNMODIFIED: int
    ADDED: int
    DELETED: int
    MODIFIED: int
    RENAMED: int
    COPIED: int
    IGNORED: int
    UNTRACKED: int
    TYPECHANGE: int
    UNREADABLE: int
    CONFLICTED: int

class DescribeStrategy(IntEnum):
    DEFAULT: int
    TAGS: int
    ALL: int

class DiffFind(IntFlag):
    FIND_BY_CONFIG: int
    FIND_RENAMES: int
    FIND_RENAMES_FROM_REWRITES: int
    FIND_COPIES: int
    FIND_COPIES_FROM_UNMODIFIED: int
    FIND_REWRITES: int
    BREAK_REWRITES: int
    FIND_AND_BREAK_REWRITES: int
    FIND_FOR_UNTRACKED: int
    FIND_ALL: int
    FIND_IGNORE_LEADING_WHITESPACE: int
    FIND_IGNORE_WHITESPACE: int
    FIND_DONT_IGNORE_WHITESPACE: int
    FIND_EXACT_MATCH_ONLY: int
    BREAK_REWRITES_FOR_RENAMES_ONLY: int
    FIND_REMOVE_UNMODIFIED: int

class DiffFlag(IntFlag):
    BINARY: int
    NOT_BINARY: int
    VALID_ID: int
    EXISTS: int
    VALID_SIZE: int

class DiffOption(IntFlag):
    NORMAL: int
    REVERSE: int
    INCLUDE_IGNORED: int
    RECURSE_IGNORED_DIRS: int
    INCLUDE_UNTRACKED: int
    RECURSE_UNTRACKED_DIRS: int
    INCLUDE_UNMODIFIED: int
    INCLUDE_TYPECHANGE: int
    INCLUDE_TYPECHANGE_TREES: int
    IGNORE_FILEMODE: int
    IGNORE_SUBMODULES: int
    IGNORE_CASE: int
    INCLUDE_CASECHANGE: int
    DISABLE_PATHSPEC_MATCH: int
    SKIP_BINARY_CHECK: int
    ENABLE_FAST_UNTRACKED_DIRS: int
    UPDATE_INDEX: int
    INCLUDE_UNREADABLE: int
    INCLUDE_UNREADABLE_AS_UNTRACKED: int
    INDENT_HEURISTIC: int
    IGNORE_BLANK_LINES: int
    FORCE_TEXT: int
    FORCE_BINARY: int
    IGNORE_WHITESPACE: int
    IGNORE_WHITESPACE_CHANGE: int
    IGNORE_WHITESPACE_EOL: int
    SHOW_UNTRACKED_CONTENT: int
    SHOW_UNMODIFIED: int
    PATIENCE: int
    MINIMAL: int
    SHOW_BINARY: int

class DiffStatsFormat(IntFlag):
    NONE: int
    FULL: int
    SHORT: int
    NUMBER: int
    INCLUDE_SUMMARY: int

class Feature(IntFlag):
    THREADS: int
    HTTPS: int
    SSH: int
    NSEC: int

class FetchPrune(IntEnum):
    UNSPECIFIED: int
    PRUNE: int
    NO_PRUNE: int

class FileMode(IntFlag):
    UNREADABLE: int
    TREE: int
    BLOB: int
    BLOB_EXECUTABLE: int
    LINK: int
    COMMIT: int

class FileStatus(IntFlag):
    CURRENT: int
    INDEX_NEW: int
    INDEX_MODIFIED: int
    INDEX_DELETED: int
    INDEX_RENAMED: int
    INDEX_TYPECHANGE: int
    WT_NEW: int
    WT_MODIFIED: int
    WT_DELETED: int
    WT_TYPECHANGE: int
    WT_RENAMED: int
    WT_UNREADABLE: int
    IGNORED: int
    CONFLICTED: int

class FilterFlag(IntFlag):
    DEFAULT: int
    ALLOW_UNSAFE: int
    NO_SYSTEM_ATTRIBUTES: int
    ATTRIBUTES_FROM_HEAD: int
    ATTRIBUTES_FROM_COMMIT: int

class FilterMode(IntEnum):
    TO_WORKTREE: int
    SMUDGE: int
    TO_ODB: int
    CLEAN: int

class MergeAnalysis(IntFlag):
    NONE: int
    NORMAL: int
    UP_TO_DATE: int
    FASTFORWARD: int
    UNBORN: int

class MergeFavor(IntEnum):
    NORMAL: int
    OURS: int
    THEIRS: int
    UNION: int

class MergeFileFlag(IntFlag):
    DEFAULT: int
    STYLE_MERGE: int
    STYLE_DIFF3: int
    SIMPLIFY_ALNUM: int
    IGNORE_WHITESPACE: int
    IGNORE_WHITESPACE_CHANGE: int
    IGNORE_WHITESPACE_EOL: int
    DIFF_PATIENCE: int
    DIFF_MINIMAL: int
    STYLE_ZDIFF3: int
    ACCEPT_CONFLICTS: int

class MergeFlag(IntFlag):
    FIND_RENAMES: int
    FAIL_ON_CONFLICT: int
    SKIP_REUC: int
    NO_RECURSIVE: int
    VIRTUAL_BASE: int

class MergePreference(IntFlag):
    NONE: int
    NO_FASTFORWARD: int
    FASTFORWARD_ONLY: int

class ObjectType(IntEnum):
    ANY: int
    INVALID: int
    COMMIT: int
    TREE: int
    BLOB: int
    TAG: int
    OFS_DELTA: int
    REF_DELTA: int

class Option(IntEnum):
    GET_MWINDOW_SIZE: int
    SET_MWINDOW_SIZE: int
    GET_MWINDOW_MAPPED_LIMIT: int
    SET_MWINDOW_MAPPED_LIMIT: int
    GET_SEARCH_PATH: int
    SET_SEARCH_PATH: int
    SET_CACHE_OBJECT_LIMIT: int
    SET_CACHE_MAX_SIZE: int
    ENABLE_CACHING: int
    GET_CACHED_MEMORY: int
    GET_TEMPLATE_PATH: int
    SET_TEMPLATE_PATH: int
    SET_SSL_CERT_LOCATIONS: int
    SET_USER_AGENT: int
    ENABLE_STRICT_OBJECT_CREATION: int
    ENABLE_STRICT_SYMBOLIC_REF_CREATION: int
    SET_SSL_CIPHERS: int
    GET_USER_AGENT: int
    ENABLE_OFS_DELTA: int
    ENABLE_FSYNC_GITDIR: int
    GET_WINDOWS_SHAREMODE: int
    SET_WINDOWS_SHAREMODE: int
    ENABLE_STRICT_HASH_VERIFICATION: int
    SET_ALLOCATOR: int
    ENABLE_UNSAVED_INDEX_SAFETY: int
    GET_PACK_MAX_OBJECTS: int
    SET_PACK_MAX_OBJECTS: int
    DISABLE_PACK_KEEP_FILE_CHECKS: int
    GET_OWNER_VALIDATION: int
    SET_OWNER_VALIDATION: int

class ReferenceFilter(IntEnum):
    ALL: int
    BRANCHES: int
    TAGS: int

class ReferenceType(IntFlag):
    INVALID: int
    DIRECT: int
    SYMBOLIC: int
    ALL: int
    OID: int
    LISTALL: int

class RepositoryInitFlag(IntFlag):
    BARE: int
    NO_REINIT: int
    NO_DOTGIT_DIR: int
    MKDIR: int
    MKPATH: int
    EXTERNAL_TEMPLATE: int
    RELATIVE_GITLINK: int

class RepositoryInitMode(IntEnum):
    SHARED_UMASK: int
    SHARED_GROUP: int
    SHARED_ALL: int

class RepositoryOpenFlag(IntFlag):
    DEFAULT: int
    NO_SEARCH: int
    CROSS_FS: int
    BARE: int
    NO_DOTGIT: int
    FROM_ENV: int

class RepositoryState(IntEnum):
    NONE: int
    MERGE: int
    REVERT: int
    REVERT_SEQUENCE: int
    CHERRYPICK: int
    CHERRYPICK_SEQUENCE: int
    BISECT: int
    REBASE: int
    REBASE_INTERACTIVE: int
    REBASE_MERGE: int
    APPLY_MAILBOX: int
    APPLY_MAILBOX_OR_REBASE: int

class ResetMode(IntEnum):
    SOFT: int
    MIXED: int
    HARD: int

class RevSpecFlag(IntFlag):
    SINGLE: int
    RANGE: int
    MERGE_BASE: int

class SortMode(IntFlag):
    NONE: int
    TOPOLOGICAL: int
    TIME: int
    REVERSE: int

class StashApplyProgress(IntEnum):
    NONE: int
    LOADING_STASH: int
    ANALYZE_INDEX: int
    ANALYZE_MODIFIED: int
    ANALYZE_UNTRACKED: int
    CHECKOUT_UNTRACKED: int
    CHECKOUT_MODIFIED: int
    DONE: int

class SubmoduleIgnore(IntEnum):
    UNSPECIFIED: int
    NONE: int
    UNTRACKED: int
    DIRTY: int
    ALL: int

class SubmoduleStatus(IntFlag):
    IN_HEAD: int
    IN_INDEX: int
    IN_CONFIG: int
    IN_WD: int
    INDEX_ADDED: int
    INDEX_DELETED: int
    INDEX_MODIFIED: int
    WD_UNINITIALIZED: int
    WD_ADDED: int
    WD_DELETED: int
    WD_MODIFIED: int
    WD_INDEX_MODIFIED: int
    WD_WD_MODIFIED: int
    WD_UNTRACKED: int
