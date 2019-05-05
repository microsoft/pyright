# This file validates type constraints that involve
# conditional binary expressions.

from typing import TypeVar, Generic, Optional

class Foo:
    def bar(self):
        return

a: Optional[Foo] = None
b: Optional[Foo] = None

if not a or not b:
    a.bar()
    b.bar()
else:
    a.bar()
    b.bar()

if not (not a or not b):
    a.bar()
    b.bar()
else:
    a.bar()
    b.bar()

if not a and not b:
    # This should be flagged as an error
    a.bar()
    # This should be flagged as an error
    b.bar()
else:
    a.bar()
    b.bar()

if not (not a and not b):
    a.bar()
    b.bar()
else:
    # This should be flagged as an error
    a.bar()
    # This should be flagged as an error
    b.bar()

if a or b:
    a.bar()
    b.bar() 
else:
    # This should be flagged as an error
    a.bar()
    # This should be flagged as an error
    b.bar()
