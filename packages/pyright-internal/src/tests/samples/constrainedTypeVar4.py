# This sample tests type narrowing of generic constrained types.

from typing import AnyStr, Generic, Sequence, TypeVar


Command = AnyStr | Sequence[AnyStr]


def func1(cmd: Command) -> list[str]:
    if isinstance(cmd, bytes):
        return [str(cmd, "utf-8")]
    if isinstance(cmd, str):
        return [cmd]

    ret: list[str] = []
    for itm in cmd:
        if isinstance(itm, str):
            ret.append(itm)
        else:
            ret.append(str(itm, "utf-8"))
    return ret


T = TypeVar("T", str, int, float, bool)


class Item(Generic[T]):
    value: T | None

    def __init__(self, source: T | None) -> None:
        self.value = source

    def read(self) -> T | None:
        if self.value is None:
            raise RuntimeError(f"Item is required!")

        return self.value
