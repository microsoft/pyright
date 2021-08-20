# This sample tests that parentheses are allowed in with statements
# if using Python 3.9 and later.

from tempfile import TemporaryFile

# This should generate an error
with (TemporaryFile() as a, TemporaryFile() as b):
    pass

# This should generate an error
with (TemporaryFile() as c, ):
    pass

# This should generate an error
with (TemporaryFile() as d):
    pass

with (TemporaryFile()):
    pass

# This should generate an error
with (TemporaryFile(), TemporaryFile()):
    pass

