# This sample tests various aliases of the typing module
# when used with Literal.

import typing
import typing as t
import typing as typ

a: typing.Literal[True] = True
b: t.Literal["Hello"] = "Hello"
c: typ.Literal[True, "Hello"] = True
