# This sample verifies that a lone overload is reported
# as an error.

from typing import overload

@overload
def foo() -> None: ...
