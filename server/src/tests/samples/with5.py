from contextlib import asynccontextmanager
from typing import Any, AsyncIterator, Optional

from typing_extensions import Literal


class DoesNotSuppress1:
    async def __aenter__(self) -> int:
        ...

    async def __aexit__(
        self, exctype: object, excvalue: object, traceback: object
    ) -> Optional[bool]:
        ...


class DoesNotSuppress2:
    async def __aenter__(self) -> int:
        ...

    async def __aexit__(
        self, exctype: object, excvalue: object, traceback: object
    ) -> Literal[False]:
        ...


class DoesNotSuppress3:
    async def __aenter__(self) -> int:
        ...

    async def __aexit__(
        self, exctype: object, excvalue: object, traceback: object
    ) -> Any:
        ...


class DoesNotSuppress4:
    async def __aenter__(self) -> int:
        ...

    async def __aexit__(
        self, exctype: object, excvalue: object, traceback: object
    ) -> None:
        ...


@asynccontextmanager
async def simple() -> AsyncIterator[int]:
    yield 3


def cond() -> bool:
    ...


async def test_no_suppress_1a() -> int:
    async with DoesNotSuppress1():
        return 3

    return "str"  # not an error because it's unreachable


async def test_no_suppress_1b() -> int:
    async with DoesNotSuppress1():
        if cond():
            return 3
        else:
            return 3

    return "str"  # not an error because it's unreachable


async def test_no_suppress_2() -> int:
    async with DoesNotSuppress2():
        return 3

    return "str"  # not an error because it's unreachable


async def test_no_suppress_3() -> int:
    async with DoesNotSuppress3():
        return 3

    return "str"  # not an error because it's unreachable


async def test_no_suppress_4() -> int:
    async with DoesNotSuppress4():
        return 3

    return "str"  # not an error because it's unreachable


async def test_no_suppress_5() -> int:
    async with simple():
        return 3

    return "str"  # not an error because it's unreachable
