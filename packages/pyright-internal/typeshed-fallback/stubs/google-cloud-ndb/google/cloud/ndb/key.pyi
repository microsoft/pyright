from typing import Any

UNDEFINED: Any

class Key:
    def __new__(cls, *path_args, **kwargs): ...
    def __hash__(self): ...
    def __eq__(self, other): ...
    def __ne__(self, other): ...
    def __lt__(self, other): ...
    def __le__(self, other): ...
    def __gt__(self, other): ...
    def __ge__(self, other): ...
    def __getnewargs__(self): ...
    def parent(self): ...
    def root(self): ...
    def namespace(self): ...
    def project(self): ...
    app: Any
    def id(self): ...
    def string_id(self): ...
    def integer_id(self): ...
    def pairs(self): ...
    def flat(self): ...
    def kind(self): ...
    def reference(self): ...
    def serialized(self): ...
    def urlsafe(self): ...
    def to_legacy_urlsafe(self, location_prefix): ...
    def get(
        self,
        read_consistency: Any | None = ...,
        read_policy: Any | None = ...,
        transaction: Any | None = ...,
        retries: Any | None = ...,
        timeout: Any | None = ...,
        deadline: Any | None = ...,
        use_cache: Any | None = ...,
        use_global_cache: Any | None = ...,
        use_datastore: Any | None = ...,
        global_cache_timeout: Any | None = ...,
        use_memcache: Any | None = ...,
        memcache_timeout: Any | None = ...,
        max_memcache_items: Any | None = ...,
        force_writes: Any | None = ...,
        _options: Any | None = ...,
    ): ...
    def get_async(
        self,
        read_consistency: Any | None = ...,
        read_policy: Any | None = ...,
        transaction: Any | None = ...,
        retries: Any | None = ...,
        timeout: Any | None = ...,
        deadline: Any | None = ...,
        use_cache: Any | None = ...,
        use_global_cache: Any | None = ...,
        use_datastore: Any | None = ...,
        global_cache_timeout: Any | None = ...,
        use_memcache: Any | None = ...,
        memcache_timeout: Any | None = ...,
        max_memcache_items: Any | None = ...,
        force_writes: Any | None = ...,
        _options: Any | None = ...,
    ): ...
    def delete(
        self,
        retries: Any | None = ...,
        timeout: Any | None = ...,
        deadline: Any | None = ...,
        use_cache: Any | None = ...,
        use_global_cache: Any | None = ...,
        use_datastore: Any | None = ...,
        global_cache_timeout: Any | None = ...,
        use_memcache: Any | None = ...,
        memcache_timeout: Any | None = ...,
        max_memcache_items: Any | None = ...,
        force_writes: Any | None = ...,
        _options: Any | None = ...,
    ): ...
    def delete_async(
        self,
        retries: Any | None = ...,
        timeout: Any | None = ...,
        deadline: Any | None = ...,
        use_cache: Any | None = ...,
        use_global_cache: Any | None = ...,
        use_datastore: Any | None = ...,
        global_cache_timeout: Any | None = ...,
        use_memcache: Any | None = ...,
        memcache_timeout: Any | None = ...,
        max_memcache_items: Any | None = ...,
        force_writes: Any | None = ...,
        _options: Any | None = ...,
    ): ...
    @classmethod
    def from_old_key(cls, old_key) -> None: ...
    def to_old_key(self) -> None: ...
