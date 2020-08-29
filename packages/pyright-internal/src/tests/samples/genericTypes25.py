# This sample tests type narrowing of generic constrained types.

from typing import AnyStr, List, Sequence, Union


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
