from _typeshed import Incomplete

class DaemonApiMixin:
    def df(self): ...
    def events(
        self,
        since: Incomplete | None = None,
        until: Incomplete | None = None,
        filters: Incomplete | None = None,
        decode: Incomplete | None = None,
    ): ...
    def info(self): ...
    def login(
        self,
        username,
        password: Incomplete | None = None,
        email: Incomplete | None = None,
        registry: Incomplete | None = None,
        reauth: bool = False,
        dockercfg_path: Incomplete | None = None,
    ): ...
    def ping(self): ...
    def version(self, api_version: bool = True): ...
