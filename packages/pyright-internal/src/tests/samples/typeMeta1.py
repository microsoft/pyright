# This sample tests the handling of the TypeMetadata class.

# pyright: reportMissingModuleSource=false

from typing_extensions import TypeMetadata


class NotTypeMeta: ...


class TM1(TypeMetadata): ...


# This should generate an error.
v1: int @ []

# This should generate an error.
v2: list[int] @ [1]

# This should generate an error.
v3: int @ NotTypeMeta()

# This should generate an error.
v4: int @ TM1

v5: int @ TM1()
