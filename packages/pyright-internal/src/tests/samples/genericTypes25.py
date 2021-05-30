# This sample tests type narrowing of generic constrained types.

from typing import AnyStr, Generic, List, Optional, Sequence, TypeVar, Union


Command = Union[AnyStr, Sequence[AnyStr]]


def version1(cmd: Command) -> List[str]:
    if isinstance(cmd, bytes):
        return [str(cmd, "utf-8")]
    if isinstance(cmd, str):
        return [cmd]

    ret: List[str] = []
    for itm in cmd:
        if isinstance(itm, str):
            ret.append(itm)
        else:
            ret.append(str(itm, "utf-8"))
    return ret


T = TypeVar("T", str, int, float, bool)


class Item(Generic[T]):
    value: Optional[T]

    def __init__(self, source: Optional[T]) -> None:
        self.value = source

    def read(self) -> Optional[T]:
        if self.value is None:
            raise RuntimeError(f"Item is required!")

        return self.value
