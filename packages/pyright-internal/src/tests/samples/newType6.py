# This sample ensures that types created with NewType are treated
# as though they're final and cannot be subclassed. The runtime
# enforces this.

from typing import NewType


MyStr = NewType("MyStr", str)


# This should generate an error.
class A(MyStr): ...
