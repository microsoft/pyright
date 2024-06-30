# This sample tests that __future__ imports are found
# only at the beginning of a file.

"""Doc String"""

"Extension"
from __future__ import annotations  # This should generate an error


def func():
    from __future__ import annotations  # This should generate an error
