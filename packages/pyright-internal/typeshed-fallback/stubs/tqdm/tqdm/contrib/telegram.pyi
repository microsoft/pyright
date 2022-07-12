from _typeshed import Incomplete
from typing import Generic, TypeVar

from ..auto import tqdm as tqdm_auto
from .utils_worker import MonoWorker

class TelegramIO(MonoWorker):
    API: str
    token: Incomplete
    chat_id: Incomplete
    session: Incomplete
    text: Incomplete
    def __init__(self, token, chat_id) -> None: ...
    @property
    def message_id(self): ...
    def write(self, s: str) -> Incomplete | None: ...
    def delete(self): ...

_T = TypeVar("_T")

class tqdm_telegram(Generic[_T], tqdm_auto[_T]):
    tgio: Incomplete
    def __init__(self, *args, **kwargs) -> None: ...
    def display(self, *, msg: str | None = ..., pos: int | None = ..., close: bool = ..., bar_style: Incomplete = ..., check_delay: bool = ...) -> None: ...  # type: ignore[override]
    def clear(self, *args, **kwargs) -> None: ...
    def close(self) -> None: ...

def ttgrange(*args, **kwargs) -> tqdm_telegram[int]: ...

tqdm = tqdm_telegram
trange = ttgrange
