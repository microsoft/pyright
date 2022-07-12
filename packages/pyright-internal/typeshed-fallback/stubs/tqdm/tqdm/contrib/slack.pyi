from _typeshed import Incomplete
from typing import Generic, TypeVar

from ..auto import tqdm as tqdm_auto
from .utils_worker import MonoWorker

class SlackIO(MonoWorker):
    client: Incomplete
    text: Incomplete
    message: Incomplete
    def __init__(self, token, channel) -> None: ...
    def write(self, s): ...

_T = TypeVar("_T")

class tqdm_slack(Generic[_T], tqdm_auto[_T]):
    sio: Incomplete
    def __init__(self, *args, **kwargs) -> None: ...
    def display(self, *, msg: str | None = ..., pos: int | None = ..., close: bool = ..., bar_style: Incomplete = ..., check_delay: bool = ...) -> None: ...  # type: ignore[override]
    def clear(self, *args, **kwargs) -> None: ...

def tsrange(*args, **kwargs) -> tqdm_slack[int]: ...

tqdm = tqdm_slack
trange = tsrange
