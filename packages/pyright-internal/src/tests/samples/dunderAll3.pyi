# This sample tests that __all__ manipulations in a stub file are not
# flagged as invalid stub statements.

# pyright: reportInvalidStubStatement=true

import typing

a: int
b: int

__all__ = ["a", "b"]
__all__ += ["b"]
__all__.extend(["a", "b"])
__all__.extend(typing.__all__)
__all__.append("a")
__all__.remove("a")
