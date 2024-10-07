# This sample tests certain uses of Any that should be flagged as illegal.

import typing
from typing import Any, cast

# This should generate an error because Any is not valid for isinstance.
isinstance(0, Any)

# This should generate an error because Any is not valid for isinstance.
isinstance(0, typing.Any)

v1 = cast(Any, 0)
v2 = cast(typing.Any, 0)


class A(Any): ...


class B(typing.Any): ...


# This should generate an error because Any is not callable.
Any()

# This should generate an error because Any is not callable.
typing.Any()


def func1() -> int:
    # This should generate an error because Any cannot be used as a value.
    return Any


def func2() -> int:
    # This should generate an error because Any cannot be used as a value.
    return typing.Any


v3: type[Any] = type(Any)

# This should generate an error.
v4: type[type] = type(Any)

# This should generate an error.
v5: type = Any
