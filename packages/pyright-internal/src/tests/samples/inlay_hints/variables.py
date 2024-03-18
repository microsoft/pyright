from typing_extensions import TypeVar, ParamSpec

sss = str(1)  # inlay hint
foo = 1  # no inlay hint because Literal
T = TypeVar(name="T") # no inlay hint because typevar
U = TypeVar(name="U", bound=Function) # no inlay hint because typevar
P = ParamSpec(name="P") # no inlay hint because paramspec
_ = str(1)  # no inlay hint because underscore only variable
Foo = int  # inlay hint of "TypeAlias"
type Bar = str  # no inlay hint
