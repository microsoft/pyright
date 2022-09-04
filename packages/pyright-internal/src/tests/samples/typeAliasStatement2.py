# This sample tests that "type" statements (introduced in PEP 695)
# are illegal prior to Python 3.12.

# This should generate an error if less than Python 3.12.
type TA1[T1] = int
