import contextlib
import enum
import sys
from collections.abc import Callable, Iterable, Iterator
from typing import Any, ClassVar
from typing_extensions import Self

from pynput._util import AbstractListener

class KeyCode:
    _PLATFORM_EXTENSIONS: ClassVar[Iterable[str]]  # undocumented
    vk: int | None
    char: str | None
    is_dead: bool | None
    combining: str | None
    def __init__(self, vk: str | None = None, char: str | None = None, is_dead: bool = False, **kwargs: str) -> None: ...
    def __eq__(self, other: object) -> bool: ...
    def __hash__(self) -> int: ...
    def join(self, key: Self) -> Self: ...
    @classmethod
    def from_vk(cls, vk: int, **kwargs: Any) -> Self: ...
    @classmethod
    def from_char(cls, char: str, **kwargs: Any) -> Self: ...
    @classmethod
    def from_dead(cls, char: str, **kwargs: Any) -> Self: ...

class Key(enum.Enum):
    alt = 0
    alt_l = alt
    alt_r = alt
    alt_gr = alt
    backspace = alt
    caps_lock = alt
    cmd = alt
    cmd_l = alt
    cmd_r = alt
    ctrl = alt
    ctrl_l = alt
    ctrl_r = alt
    delete = alt
    down = alt
    end = alt
    enter = alt
    esc = alt
    f1 = alt
    f2 = alt
    f3 = alt
    f4 = alt
    f5 = alt
    f6 = alt
    f7 = alt
    f8 = alt
    f9 = alt
    f10 = alt
    f11 = alt
    f12 = alt
    f13 = alt
    f14 = alt
    f15 = alt
    f16 = alt
    f17 = alt
    f18 = alt
    f19 = alt
    f20 = alt
    if sys.platform == "win32":
        f21 = alt
        f22 = alt
        f23 = alt
        f24 = alt
    home = alt
    left = alt
    page_down = alt
    page_up = alt
    right = alt
    shift = alt
    shift_l = alt
    shift_r = alt
    space = alt
    tab = alt
    up = alt
    media_play_pause = alt
    media_volume_mute = alt
    media_volume_down = alt
    media_volume_up = alt
    media_previous = alt
    media_next = alt
    insert = alt
    menu = alt
    num_lock = alt
    pause = alt
    print_screen = alt
    scroll_lock = alt

class Controller:
    _KeyCode: ClassVar[type[KeyCode]]  # undocumented
    _Key: ClassVar[type[Key]]  # undocumented

    if sys.platform == "linux":
        CTRL_MASK: ClassVar[int]
        SHIFT_MASK: ClassVar[int]

    class InvalidKeyException(Exception): ...
    class InvalidCharacterException(Exception): ...

    def __init__(self) -> None: ...
    def press(self, key: str | Key | KeyCode) -> None: ...
    def release(self, key: str | Key | KeyCode) -> None: ...
    def tap(self, key: str | Key | KeyCode) -> None: ...
    def touch(self, key: str | Key | KeyCode, is_press: bool) -> None: ...
    @contextlib.contextmanager
    def pressed(self, *args: str | Key | KeyCode) -> Iterator[None]: ...
    def type(self, string: str) -> None: ...
    @property
    def modifiers(self) -> contextlib.AbstractContextManager[Iterator[set[Key]]]: ...
    @property
    def alt_pressed(self) -> bool: ...
    @property
    def alt_gr_pressed(self) -> bool: ...
    @property
    def ctrl_pressed(self) -> bool: ...
    @property
    def shift_pressed(self) -> bool: ...

class Listener(AbstractListener):
    def __init__(
        self,
        on_press: Callable[[Key | KeyCode | None], None] | None = None,
        on_release: Callable[[Key | KeyCode | None], None] | None = None,
        suppress: bool = False,
        **kwargs: Any,
    ) -> None: ...
    def canonical(self, key: Key | KeyCode) -> Key | KeyCode: ...
