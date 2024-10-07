# This sample includes Python 2.x syntax that is illegal
# in Python 3.x. The Pyright parser should flag these as
# errors, but it should exhibit good recovery, preferably
# emitting one error per instance, not a cascade of errors.

# pyright: reportUnusedExpression=false

# This should generate an error.
print 3 + 3

# This should generate an error.
exec 3 + 4

try:
    bar = 3
# This should generate an error.
except NameError, 'error caused':
    pass

b = 3

# This should generate an error.
a = `b`

# This should generate an error.
def foo(a, (b, c), d):
    pass

# This should generate two errors.
raise NameError, a > 4, a < 4

