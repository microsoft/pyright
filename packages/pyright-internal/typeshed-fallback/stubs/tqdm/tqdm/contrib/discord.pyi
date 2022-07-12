from _typeshed import Incomplete
from typing import Generic, TypeVar

from ..auto import tqdm as tqdm_auto
from .utils_worker import MonoWorker

class DiscordIO(MonoWorker):
    text: Incomplete
    message: Incomplete
    def __init__(self, token, channel_id) -> None: ...
    def write(self, s): ...

_T = TypeVar("_T")

class tqdm_discord(Generic[_T], tqdm_auto[_T]):
    dio: Incomplete
    def __init__(self, *args, **kwargs) -> None: ...
    def display(
        self,
        msg: str | None = ...,
        pos: int | None = ...,
        close: bool = ...,
        bar_style: Incomplete = ...,
        check_delay: bool = ...,
    ) -> None: ...
    def clear(self, *args, **kwargs) -> None: ...

def tdrange(*args, **kwargs) -> tqdm_discord[int]: ...

tqdm = tqdm_discord
trange = tdrange
