# This sample verifies that the parser correctly generates errors
# for syntax that is disallowed within type annotation expressions.

# This should generate an error because tuples
# are not allowed in type expressions.
from typing import List

from typing_extensions import Literal


var1: (int, )

# This should generate an error because lists
# are not allowed in type expressions.
var2: [int]

# This should generate an error because dicts
# are not allowed in type expressions.
var3: {int: str}

# This should generate an error because numeric
# literals are not allowed in type expressions.
var4: 3

# This should generate an error because complex
# expression statements are not allowed in type
# expressions.
var5: 3 + 4
var6: -3
var7: int or str

# This should generate an error because function
# calls are not allowed.
var10: type(int)

# These should each generate an error because True
# False and __debug__ should not be allowed.
var11: True
var12: False
var13: __debug__


# These should be fine.
var14: 'int'
var15: List['int']
var16: Literal[1, 2, 3]
var17: Literal['1', 2, True]

