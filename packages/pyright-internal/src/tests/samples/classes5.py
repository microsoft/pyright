# This sample tests the reportIncompatibleVariableOverride
# configuration option.

from typing import ClassVar, Final, List, Optional, Protocol, Type, Union


class ParentClass1:
    cv1: ClassVar[int] = 0
    cv2: ClassVar[int] = 0
    cv3: ClassVar[int] = 0
    cv4: ClassVar[int] = 0

    var1: int
    var2: str
    var3: Union[int, str]
    var4: int
    var5: int
    var6: int
    var7: List[float]
    var8: List[int]
    var9: int

    _var1: int
    __var1: int

    def __init__(self):
        self.var10: int = 0
        self.var11: int = 0
        self.var12 = 0


class Subclass1(ParentClass1):
    # This should generate an error.
    cv1 = ""

    # This should generate an error if reportIncompatibleVariableOverride
    # is enabled.
    cv2: int = 3

    cv3 = 3

    cv4: Final = 3

    # This should generate an error if reportIncompatibleVariableOverride is
    # enabled because the type is incompatible.
    var1: str

    var2: str

    var3: int

    # This should generate an error.
    var4 = ""

    var5 = 5

    # This should generate an error if reportIncompatibleVariableOverride is
    # enabled because a property cannot override a variable.
    @property
    def var6(self) -> int:
        return 3

    # This should not generate an error because the inherited (expected)
    # type of var7 is List[float], so the expression "[3, 4, 5]" should
    # be inferred as List[float] rather than List[int].
    var7 = [3, 4, 5]

    # This should generate an error because floats are not allowed
    # in a List[int].
    var8 = [3.3, 45.6, 5.9]

    # This should generate an error if reportIncompatibleVariableOverride is
    # enabled.
    var9: ClassVar[int] = 3

    # This should generate an error if reportIncompatibleVariableOverride
    # is enabled.
    _var1: str

    # This should not generate an error because it's a private name.
    __var1: str

    def __init__(self):
        # This should generate an error if reportIncompatibleVariableOverride
        # is enabled.
        self.var10: str = ""

        # This should generate an error.
        self.var11 = ""

        self.var12 = ""


class ParentClass2:
    cv_decl_1: float
    cv_decl_2: float
    cv_decl_3: float
    cv_decl_4: float
    cv_decl_5: float
    cv_decl_6: float

    cv_infer_1 = 1.0
    cv_infer_2 = 1.0
    cv_infer_3 = 1.0
    cv_infer_4 = 1.0
    cv_infer_5 = 1.0
    cv_infer_6 = 1.0

    def __init__(self):
        self.iv_decl_1: float
        self.iv_decl_2: float
        self.iv_decl_3: float

        self.iv_infer_1 = 1.0
        self.iv_infer_2 = 1.0
        self.iv_infer_3 = 1.0


class SublassDeclared2(ParentClass2):
    cv_decl_1: int

    # This should generate an error if reportIncompatibleVariableOverride
    # is enabled.
    cv_decl_2: str

    # This should generate an error if reportIncompatibleVariableOverride
    # is enabled.
    cv_decl_3: Optional[float]

    cv_infer_1: int
    cv_infer_2: str
    cv_infer_3: Optional[float]

    def __init__(self):
        self.cv_decl_4: int

        # This should generate an error if reportIncompatibleVariableOverride
        # is enabled.
        self.cv_decl_5: str

        # This should generate an error if reportIncompatibleVariableOverride
        # is enabled.
        self.cv_decl_6: Optional[float]

        self.cv_infer_4: int
        self.cv_infer_5: str
        self.cv_infer_6: Optional[float]

        self.iv_decl_1: int

        # This should generate an error if reportIncompatibleVariableOverride
        # is enabled.
        self.iv_decl_2: str

        # This should generate an error if reportIncompatibleVariableOverride
        # is enabled.
        self.iv_decl_3: Optional[float]

        self.iv_infer_1: int
        self.iv_infer_2: str
        self.iv_infer_3: Optional[float]


class SublassInferred2(ParentClass2):
    cv_decl_1 = 1

    # This should generate an error.
    cv_decl_2 = ""

    # This should generate an error.
    cv_decl_3 = None

    cv_infer_1 = 3
    cv_infer_2 = ""
    cv_infer_3 = None

    def __init__(self):
        self.cv_decl_4 = 1

        # This should generate an error.
        self.cv_decl_5 = ""

        # This should generate an error.
        self.cv_decl_6 = None

        self.cv_infer_4 = 1
        self.cv_infer_5 = ""
        self.cv_infer_6 = None

        self.iv_decl_1 = 1

        # This should generate an error.
        self.iv_decl_2 = ""

        # This should generate an error.
        self.iv_decl_3 = None

        self.iv_infer_1 = 1
        self.iv_infer_2 = ""
        self.iv_infer_3 = None


class SublassTuple1(ParentClass2):
    cv_decl_1, cv_decl_2, cv_decl_3 = (3, 4.5, 6.0)


class SublassTuple2(ParentClass2):
    # This should generate an error.
    cv_decl_1, cv_decl_2, cv_decl_3 = (3, 4.5, None)


class ConfigBase:
    ...


class ParentClass3(Protocol):
    Config1: ClassVar[Type[ConfigBase]]
    Config2: ClassVar[Type[ConfigBase]]


class ChildClass3(ParentClass3):
    class Config1(ConfigBase):
        ...

    # This should generate an error if reportIncompatibleVariableOverride
    # is enabled.
    class Config2:
        ...
