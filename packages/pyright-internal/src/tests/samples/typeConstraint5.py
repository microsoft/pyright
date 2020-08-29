# This sample tests the type constraint logic for "continue"
# statements within a loop.

from typing import List, Optional

def foo(args: List[Optional[int]]):
    for arg in args:
        if arg is None:
            continue

        # This should not generate an error because
        # arg is known to be an int at this point.
        print(arg.bit_length())
    
