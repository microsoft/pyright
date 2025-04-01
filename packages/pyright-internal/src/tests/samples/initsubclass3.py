# This sample tests the case where an __init_subclass__ is overloaded.


from typing import overload


class BaseClass1:
    @overload
    def __init_subclass__(cls, x: str, y: str) -> None: ...

    @overload
    def __init_subclass__(cls, x: int, y: int) -> None: ...

    def __init_subclass__(cls, x: int | str, y: int | str) -> None: ...


class Subclass1A(BaseClass1, x=3, y=3): ...


class Subclass1B(BaseClass1, x="", y=""): ...


# This should generate three errors.
class Subclass1C(BaseClass1, x=1, y=""): ...
