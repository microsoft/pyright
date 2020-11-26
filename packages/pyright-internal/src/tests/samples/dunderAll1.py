# This sample tests the reportUnsupportedDunderAll diagnostic rule.

# pyright: reportMissingModuleSource=false

from typing import Any
import mock

__all__: Any

__all__ = ("test", "hello")
__all__ = ["test", "hello"]
__all__.append("foo")
__all__.extend(["foo"])
__all__.remove("foo")
__all__ += ["bar"]
__all__ += mock.__all__
__all__.extend(mock.__all__)


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
__all__ += mock.AsyncMock
__all__.extend(mock.AsyncMock)
__all__.something()
