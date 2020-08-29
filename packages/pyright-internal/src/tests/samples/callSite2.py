# This sample tests pyright's ability to perform return type
# analysis of functions based on call-site arguments.

# pyright: strict

from .callSite1 import add

must_be_int = add(1, 2)
result1: int = must_be_int

must_be_str = add('hi', 'there')
result2: str = must_be_str


