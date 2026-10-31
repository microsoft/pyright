# This sample tests concrete transform results forwarded through an inherited mixin.

from typing import Generic, TypeVar


class Transformer:
    def fit(self, values):
        return self

    def transform(self, values):
        return values

    def fit_transform(self, values):
        return self.fit(values).transform(values)


class DenseTransformer(Transformer):
    def transform(self, values) -> list[int]:
        return [1, 2]


class SparseValues:
    def toarray(self) -> list[float]:
        return [1.0, 2.0]


class SparseTransformer(Transformer):
    def transform(self, values) -> SparseValues:
        return SparseValues()


class UnionTransformer(Transformer):
    def transform(self, values) -> list[int] | str:
        if isinstance(values, str):
            return values
        return [1, 2]


def transform_results(dense: DenseTransformer, sparse: SparseTransformer, union: UnionTransformer):
    reveal_type(dense.fit_transform([1]), expected_text="list[int]")
    reveal_type(sparse.fit_transform([1]), expected_text="SparseValues")
    reveal_type(dense.fit_transform([1]), expected_text="list[int]")
    sparse.fit_transform([1]).toarray()

    result = union.fit_transform([1])
    reveal_type(result, expected_text="list[int] | str")

    # This should generate an error because the declared str alternative must be retained.
    result.append(3)

    if isinstance(result, list):
        result.append(3)
    else:
        result.upper()

    reveal_type(sparse.fit_transform([1]), expected_text="SparseValues")
    reveal_type(dense.fit_transform([1]), expected_text="list[int]")


T = TypeVar("T")


class GenericTransformer(Transformer, Generic[T]):
    def __init__(self, value: T):
        self.value = value

    def transform(self, values) -> list[T]:
        return [self.value]


def generic_transform_results(first: GenericTransformer[int], second: GenericTransformer[str]):
    reveal_type(first.fit_transform([1]), expected_text="list[int]")
    reveal_type(second.fit_transform([1]), expected_text="list[str]")
    reveal_type(first.fit_transform([1]), expected_text="list[int]")
    reveal_type(second.fit_transform([1]), expected_text="list[str]")
