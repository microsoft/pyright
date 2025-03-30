# This sample tests the handling of bound and constrained type parameters
# as specified in PEP 695 type parameter statements.


class ClassA[**P, R: str]: ...


A1 = ClassA[..., str]

# This should generate an error because str isn't a valid
# specialization for a ParamSpec.
A2 = ClassA[str, str]

A3 = ClassA[[str], str]

# This should generate an error because int doesn't conform
# to the bound.
A4 = ClassA[..., int]


class StrSubclass(str): ...


A5 = ClassA[..., StrSubclass]


class ClassB[X: (int, str), Y](dict[Y, X]): ...


B1 = ClassB[int, int]

# This should generate an error because float doesn't conform
# to the constraint.
B2 = ClassB[float, float]


class ClassC[*Ts]: ...


C1 = ClassC[str, str]

C2 = ClassC[*tuple[str, ...]]

# This should generate an error because ... isn't valid.
C3 = ClassC[...]

C4 = ClassC[*tuple[()]]
