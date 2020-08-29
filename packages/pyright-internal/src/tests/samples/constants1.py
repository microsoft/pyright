# This sample tests that the type checker flags certain values
# that cannot be deleted or assigned to.

# This should generate an error
True = 3

# This should generate an error
False = 4

# This should generate an error
None = True

# This should generate an error
__debug__ = 4

# This should generate an error
del True

# This should generate an error
del None

# This should generate an error
-3 = 2

# This should generate an error
[4] = [2]

# This should generate an error
[True] = [3]

# This should generate an error
(True) = 3

# This should generate an error
del -3

# This should generate an error
3 + 4 = 2

# This should generate an error
del 3 + 4

# This should generate an error
del -(4)

# This should generate an error
del __debug__

# This should generate an error
del {}

# This should generate an error
... = 3

# This should generate an error
del ...

# This should generate an error
(...) = 3

# This should generate an error
del ...


