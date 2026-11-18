# This sample tests diagnostics after negative membership checks with class aliases.

from typing import final


@final
class IntList(list[int]):
    pass


class Other:
    @classmethod
    def only_other(cls) -> int:
        return 42


def check(cls: type[IntList] | type[Other]) -> int:
    if cls not in (IntList[()],):
        # This should generate an error because IntList can reach this branch.
        return cls.only_other()
    return 0


check(IntList)
