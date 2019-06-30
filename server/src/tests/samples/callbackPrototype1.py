# This sample tests support for callback protocols (defined in PEP 544).

from typing import Optional, List, Protocol

class Combiner(Protocol):
    def __call__(self, *vals: bytes,
                 maxlen: Optional[int] = None) -> List[bytes]:
        return []

def good_cb(*vals: bytes, maxlen: Optional[int] = None) -> List[bytes]:
    return []
def bad_cb1(*vals: bytes, maxlen: Optional[int], maxitems: Optional[int]) -> List[bytes]:
    return []
def bad_cb2(*vals: bytes) -> List[bytes]:
    return []
def bad_cb3(*vals: bytes, maxlen: Optional[str]) -> List[bytes]:
    return []

comb: Combiner = good_cb

# This should generate an error because maxitems is unmatched.
comb = bad_cb1

# This should generate an error because maxlen is unmatched.
comb = bad_cb2

# This should generate an error because maxlen is the wrong type.
comb = bad_cb3
