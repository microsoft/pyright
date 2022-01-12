import sys
from typing_extensions import Literal

if sys.version_info >= (3, 9):
    cmp_op: tuple[Literal["<"], Literal["<="], Literal["=="], Literal["!="], Literal[">"], Literal[">="]]
else:
    cmp_op: tuple[
        Literal["<"],
        Literal["<="],
        Literal["=="],
        Literal["!="],
        Literal[">"],
        Literal[">="],
        Literal["in"],
        Literal["not in"],
        Literal["is"],
        Literal["is not"],
        Literal["exception match"],
        Literal["BAD"],
    ]
hasconst: list[int]
hasname: list[int]
hasjrel: list[int]
hasjabs: list[int]
haslocal: list[int]
hascompare: list[int]
hasfree: list[int]
opname: list[str]

opmap: dict[str, int]
HAVE_ARGUMENT: int
EXTENDED_ARG: int

if sys.version_info >= (3, 8):
    def stack_effect(__opcode: int, __oparg: int | None = ..., *, jump: bool | None = ...) -> int: ...

else:
    def stack_effect(__opcode: int, __oparg: int | None = ...) -> int: ...

hasnargs: list[int]
