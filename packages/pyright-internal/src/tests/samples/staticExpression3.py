# This sample tests static expression forms with reversed operands:
# (tuple <= sys.version_info), (int <= sys.version_info[0]),
# ('str' == sys.platform), and ('str' == os.name).

import os
import sys

x: int

if (3, 9) <= sys.version_info:
    x = 1
else:
    x = "error!"

if 3 <= sys.version_info[0]:
    x = 1
else:
    x = "error!"

if "linux" == sys.platform:
    x = 1
else:
    x = "error!"

if "posix" == os.name:
    x = 1
else:
    x = "error!"
