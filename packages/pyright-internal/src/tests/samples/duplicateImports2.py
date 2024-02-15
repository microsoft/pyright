# should report error on imports with duplicated aliases
import typing as foo, collections.abc as foo

# should report error on duplicated imports in different statements
from dataclasses import dataclass
from dataclasses import dataclass

# prevent unusedCodes
_ = foo
_ = dataclass