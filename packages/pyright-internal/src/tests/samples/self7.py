# This sample tests the case where type[Self] is returned but Self
# is expected.

from typing import Self


class Foo:
    @classmethod
    def bar(cls) -> Self:
        # This should generate an error.
        return cls
