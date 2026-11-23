from typing import Any, overload, reveal_type


@overload
def choose(value: list[int]) -> list[int]: ...
@overload
def choose(value: list[str]) -> list[str]: ...
def choose(value: Any) -> Any:
    return value


def positive(value: list[Any]):
    before: int = "bad"
    ret = choose(value)
    alias = ret
    strings: list[str] = alias
    ret.append("ok")
    ret.append(cold())
    ret.extend([1, "mixed"])
    bad: list[bytes] = ret
    ret.append(3.14)
    ret.nonexistent()
    after: int = "bad"
    reveal_type(alias)


def cold():
    from os import getpid

    return getpid() / 2


after_file: str = 1
