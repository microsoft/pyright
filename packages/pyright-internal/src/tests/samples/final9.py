# This sample is imported by final10.py. It defines module-scope "Final"
# variables whose initializer values are statically known.

import sys
from typing import Final

IS_WIN: Final[bool] = sys.platform == "win32"
IS_WIN_INFERRED: Final = sys.platform == "win32"
MAYBE_WIN: bool = sys.platform == "win32"

ITEMS: Final[list[int]] = []


class Base: ...


class Sentinel(Base): ...


NO_INFO: Final[Base] = Sentinel()


class ClassWithFinal:
    class_final: Final[int] = 1
    class_var: int = 1
