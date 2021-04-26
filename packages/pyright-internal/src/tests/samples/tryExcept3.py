# This sample verifies that the exception type validation
# handles the case where the exception type is a Type[X] object.

from typing import Type

exc: Type[Exception] = Exception


try:
    1 / 0
except exc:
    print("exc")
