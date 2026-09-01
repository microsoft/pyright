# This sample tests the implicit __class__ closure in a lambda defined in a
# class body.

# pyright: strict, reportUnknownLambdaType=false

from typing import Callable


class A:
    get_class = lambda: __class__


# This should not create an implicit __class__ binding because the lambda is
# defined outside of a class body.
get_class: Callable[[], type] = lambda: __class__
