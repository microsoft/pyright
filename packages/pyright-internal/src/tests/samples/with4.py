# This sample tests that parentheses are allowed in with statements
# if using Python 3.9 and later.

from tempfile import TemporaryFile

with (TemporaryFile() as a, TemporaryFile() as b):
    pass

with (TemporaryFile() as c, ):
    pass

with (TemporaryFile() as d):
    pass

with (TemporaryFile()):
    pass

