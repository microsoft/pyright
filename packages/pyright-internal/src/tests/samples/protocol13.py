# This sample tests the handling of protocol class methods that
# include named-only parameters that match to positional parameters
# within class that is being tested for protocol compatibility.

from typing import Optional, Protocol


class CollectionProtocol(Protocol):
    def watch(
        self,
        *,
        max_time: Optional[int] = ...,
        key: Optional[str] = ...,
    ) -> None:
        ...


class Collection:
    def watch(self, key: Optional[str] = None, max_time: Optional[int] = None) -> None:
        ...


# This should not generate an error even though the "keys" and
# "max_time" parameters in Collection.watch are not marked as
# name-only parameters and are not in the same order.
col: CollectionProtocol = Collection()
