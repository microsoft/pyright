from argparse import ArgumentParser, Namespace
from typing_extensions import override

from gunicorn.app.base import Application

from .._types import _WSGIAppType

class WSGIApplication(Application):
    app_uri: str | None

    @override
    def init(self, parser: ArgumentParser, opts: Namespace, args: list[str]) -> None: ...
    @override
    def load_config(self) -> None: ...
    def load_wsgiapp(self) -> _WSGIAppType: ...
    def load_pasteapp(self) -> _WSGIAppType: ...
    @override
    def load(self) -> _WSGIAppType: ...

def run(prog: str | None = None) -> None: ...
