# This sample tests the reporting of a function or class decorated with
# @type_check_only when used in a value expression.

from __future__ import annotations

from typing import TYPE_CHECKING, type_check_only

if TYPE_CHECKING:
    from typing import _TypedDict

a1: function
a2: _TypedDict

# This should generate an error.
v1 = function

# This should generate an error, but it doesn't because
# of a typeshed issue.
v2 = isinstance(1, ellipsis)

# This should generate an error.
v3 = _TypedDict


if TYPE_CHECKING:

    class ClassA:
        @type_check_only
        def method1(self):
            pass

    @type_check_only
    def func1() -> None: ...


# This should generate an error.
ClassA().method1()

# This should generate an error.
func1()
