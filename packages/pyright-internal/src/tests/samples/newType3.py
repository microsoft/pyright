# This sample tests that the type checker is properly synthesizing
# a constructor for a NewType.

from typing import NewType


UserId = NewType("UserId", int)

# This should generate an error because the constructor
# requires a single int.
var1 = UserId()

var2 = UserId(2)

# This should generate an error because the constructor
# requires a single int.
var3 = UserId("2")

# This should generate an error because the constructor
# requires a single int.
var4 = UserId(2, 3)


def require_user_id(a: UserId): ...


require_user_id(var2)

# this should generate an error.
require_user_id(2)

var5 = 4 + var2
var6 = var2 * 2
