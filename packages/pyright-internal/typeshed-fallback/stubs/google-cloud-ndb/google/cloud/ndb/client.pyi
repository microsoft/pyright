from typing import Any

DATASTORE_API_HOST: Any

class Client:
    SCOPE: Any
    namespace: Any
    host: Any
    client_info: Any
    secure: Any
    stub: Any
    def __init__(self, project: Any | None = ..., namespace: Any | None = ..., credentials: Any | None = ...) -> None: ...
    def context(
        self,
        namespace=...,
        cache_policy: Any | None = ...,
        global_cache: Any | None = ...,
        global_cache_policy: Any | None = ...,
        global_cache_timeout_policy: Any | None = ...,
        legacy_data: bool = ...,
    ) -> None: ...
