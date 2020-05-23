# This sample tests various aliases of the typing module
# when used with Literal.

import typing
import typing as t
import typing as typ

a: typing.Literal[True] = True
b: t.Literal["Hello"] = "Hello"

# This will generate an error because the special-case
# logic in the parser is limited to "typing" and "t".
c: typ.Literal[True] = True



