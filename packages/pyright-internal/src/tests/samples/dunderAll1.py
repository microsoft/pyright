# This sample tests the reportUnsupportedDunderAll diagnostic rule.

# pyright: reportMissingModuleSource=false

from typing import Any

test = 3
hello = 3
bar = 3

__all__: Any

__all__ = ("test", "hello")
__all__ = ["test", "hello"]
__all__.append("foo")
__all__.extend(["foo"])
__all__.remove("foo")
__all__ += ["bar"]


my_string = "foo"

# The following should all generate diagnostics if reportUnsupportedDunderAll
# is enabled.
__all__ = ("test", my_string)
__all__ = ["test", my_string]
__all__ = "test"
__all__.append(my_string)
__all__.extend([my_string])
__all__.remove(my_string)
__all__ += [my_string]
__all__.something()
