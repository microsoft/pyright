# This sample tests a case where type evaluation for a type guard
# within a loop may trigger a false positive "type depends on itself"
# error message.

# For details, see https://github.com/microsoft/pyright/issues/9139.

from enum import StrEnum


class MyEnum(StrEnum):
    A = "A"


for _ in range(2):
    x: dict[MyEnum, int] = {}

    if MyEnum.A in x:
        ...

    for _ in x.values():
        ...
