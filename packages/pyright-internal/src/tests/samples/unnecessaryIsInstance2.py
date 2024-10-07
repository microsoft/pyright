# This sample tests for isinstance calls that never evaluate to true.

from typing import final


class ABase: ...


@final
class AFinal(ABase): ...


class BBase: ...


@final
class BFinal(BBase): ...


def func1(a: AFinal, b: BFinal):
    # This should generate an error if reportUnnecessaryIsinstance is true.
    if isinstance(a, BBase):
        reveal_type(a)

    # This should generate an error if reportUnnecessaryIsinstance is true.
    if isinstance(a, BBase):
        reveal_type(a)


def func2(a: ABase, b: BBase):
    if isinstance(a, BBase):
        reveal_type(a)

    if isinstance(b, ABase):
        reveal_type(b)
