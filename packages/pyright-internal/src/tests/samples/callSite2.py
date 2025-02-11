# This sample tests pyright's ability to perform return type
# analysis of functions based on call-site arguments.

from .callSite1 import add, add2, async_call

v1 = add(1, 2)
reveal_type(v1, expected_text="Literal[3]")

v2 = add("hi", "there")
reveal_type(v2, expected_text="Literal['hithere']")

v3 = add2(1, 2)
reveal_type(v3, expected_text="Unknown")

v4 = async_call(1)
reveal_type(v4, expected_text="CoroutineType[Any, Any, Unknown]")
