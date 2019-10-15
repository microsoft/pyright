# This file validates type constraints that involve
# conditional binary expressions.

class Foo:
    def bar(self):
        return

maybe = True

a = None if maybe else Foo()
b = None if maybe else Foo()

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
