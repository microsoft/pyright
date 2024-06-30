# This sample tests the handling of protocol class methods that
# include keyword-only parameters that match to positional parameters
# within class that is being tested for protocol compatibility.

from typing import Protocol


class CollectionProtocol(Protocol):
    def watch(self, *, max_time: int | None = ..., key: str | None = ...) -> None: ...


class Collection:
    def watch(self, key: str | None = None, max_time: int | None = None) -> None: ...


# This should not generate an error even though the "keys" and
# "max_time" parameters in Collection.watch are not marked as
# keyword-only parameters and are not in the same order.
col: CollectionProtocol = Collection()
