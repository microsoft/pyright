# This sample represents a typical tensor library that might use the type
# system to validate tensor shapes. It is used by other test cases.

from types import EllipsisType
from typing import Annotated, Any, Literal, Unpack, overload
from typing_extensions import (
    IntAdd,
    IntDiv,
    IntEq,
    IntGe,
    IntGt,
    IntLt,
    IntMul,
    IntNe,
    IntSub,
    LiteralInt,
    LiteralIntTuple,
    TupleBroadcast,
    TupleConcat,
    TupleIndex,
    TupleLen,
    TupleMultiIndex,
    TuplePermute,
    TupleReshape,
    TupleSplice,
    TupleSwap,
    Where,
)

class Size[S: tuple[LiteralInt, ...] = LiteralIntTuple](tuple[Unpack[S]]):
    def __getitem__[I: LiteralInt](self, key: I) -> TupleIndex[S, I]: ...  # pyright: ignore[reportIncompatibleMethodOverride]
    def elem_count(self) -> TupleLen[S]: ...

class Tensor[D, S: tuple[LiteralInt, ...] = LiteralIntTuple]:
    def __init__(self, value) -> None: ...
    @property
    def shape(self) -> Size[S]: ...
    @property
    def rank(self) -> TupleLen[S]: ...
    def transpose[I1: LiteralInt, I2: LiteralInt](
        self, dim0: I1, dim1: Annotated[I2, Where(TupleSwap[S, I1, I2])]
    ) -> Tensor[D, TupleSwap[S, I1, I2]]: ...
    def view[A: LiteralIntTuple](
        self, *args: Annotated[Unpack[A], Where(TupleReshape[S, A])]
    ) -> Tensor[D, TupleReshape[S, A]]: ...
    def cos(self) -> Tensor[D, S]: ...
    def sin(self) -> Tensor[D, S]: ...
    def add[S2: LiteralIntTuple](
        self, input: Annotated[Tensor[D, S2], Where(TupleBroadcast[S, S2])]
    ) -> Tensor[D, TupleBroadcast[S, S2]]: ...
    def __add__[
        S2: LiteralIntTuple,
    ](self, input: Annotated[Tensor[D, S2], Where(TupleBroadcast[S, S2])]) -> Tensor[D, TupleBroadcast[S, S2]]: ...
    def sub[S2: LiteralIntTuple](
        self, input: Annotated[Tensor[D, S2], Where(TupleBroadcast[S, S2])]
    ) -> Tensor[D, TupleBroadcast[S, S2]]: ...
    def __sub__[S2: LiteralIntTuple](
        self, input: Annotated[Tensor[D, S2], Where(TupleBroadcast[S, S2])]
    ) -> Tensor[D, TupleBroadcast[S, S2]]: ...
    def pow(self, exp: float) -> Tensor[D, S]: ...
    def __pow__(self, exp: float) -> Tensor[D, S]: ...
    def __getitem__[I: tuple[EllipsisType | LiteralInt | slice, ...]](
        self,
        index: I,
    ) -> Tensor[D, TupleMultiIndex[S, I]]: ...

@overload
def cat[
    D,
    S1: LiteralIntTuple,
    S2: LiteralIntTuple,
    I: LiteralInt,
](
    tensors: Annotated[tuple[Tensor[D, S1], Tensor[D, S2]], Where(TupleConcat[S1, S2, I])],
    dim: I = 0,
    *,
    out: Tensor[D, TupleConcat[S1, S2, I]] | None = ...,
) -> Tensor[D, TupleConcat[S1, S2, I]]: ...
@overload
def cat[
    D,
    S1: LiteralIntTuple,
    S2: LiteralIntTuple,
    S3: LiteralIntTuple,
    I: LiteralInt,
](
    tensors: Annotated[
        tuple[Tensor[D, S1], Tensor[D, S2], Tensor[D, S3]], Where(TupleConcat[TupleConcat[S1, S2, I], S3, I])
    ],
    dim: I = 0,
    *,
    out: Tensor[D, TupleConcat[TupleConcat[S1, S2, I], S3, I]] | None = ...,
) -> Tensor[D, TupleConcat[TupleConcat[S1, S2, I], S3, I]]: ...
@overload
def cat[
    D,
    S1: LiteralIntTuple,
    S2: LiteralIntTuple,
    S3: LiteralIntTuple,
    S4: LiteralIntTuple,
    I: LiteralInt,
](
    tensors: Annotated[
        tuple[Tensor[D, S1], Tensor[D, S2], Tensor[D, S3], Tensor[D, S4]],
        Where(TupleConcat[TupleConcat[TupleConcat[S1, S2, I], S3, I], S4, I]),
    ],
    dim: I = 0,
    *,
    out: Tensor[D, TupleConcat[TupleConcat[TupleConcat[S1, S2, I], S3, I], S4, I]] | None = ...,
) -> Tensor[D, TupleConcat[TupleConcat[TupleConcat[S1, S2, I], S3, I], S4, I]]: ...
@overload
def cat[D](tensors: tuple[Tensor[D], ...], dim: int = 0, *, out: Tensor[D] | None = ...) -> Tensor[D]: ...
def conv2d[
    D,
    N: LiteralInt,
    CIn: LiteralInt,
    HIn: LiteralInt,
    WIn: LiteralInt,
    COut: LiteralInt,
    K0: LiteralInt,
    K1: LiteralInt,
    G: LiteralInt,
    Gr: LiteralInt,
    S0: LiteralInt,
    P0: LiteralInt,
    D0: LiteralInt,
    S1: LiteralInt = S0,
    P1: LiteralInt = P0,
    D1: LiteralInt = D0,
](
    input: Tensor[D, tuple[N, CIn, HIn, WIn]],
    weight: Annotated[Tensor[D, tuple[COut, Gr, K0, K1]], Where(IntEq[Gr, IntDiv[CIn, G]])],
    bias: Tensor[D, tuple[COut]] | None = None,
    stride: S0 | tuple[S0, S1] = 1,
    padding: P0 | tuple[P0, P1] = 0,
    dilation: D0 | tuple[D0, D1] = 1,
    groups: G = 1,  # pyright: ignore[reportInvalidTypeVarUse]
) -> Tensor[
    D,
    tuple[
        N,
        COut,
        IntAdd[
            IntDiv[
                IntSub[
                    IntSub[IntAdd[HIn, IntMul[Literal[2], P0]], IntMul[D0, IntSub[K0, Literal[1]]]],
                    Literal[1],
                ],
                S0,
            ],
            Literal[1],
        ],
        IntAdd[
            IntDiv[
                IntSub[
                    IntSub[IntAdd[WIn, IntMul[Literal[2], P1]], IntMul[D1, IntSub[K1, Literal[1]]]],
                    Literal[1],
                ],
                S1,
            ],
            Literal[1],
        ],
    ],
]: ...
def index_select[
    D,
    S: LiteralIntTuple,
    I: LiteralInt,
    X: LiteralInt,
](
    input: Tensor[D, S],
    dim: Annotated[I, Where(TupleIndex[S, I])],
    index: Tensor[D, tuple[X]],
) -> Tensor[D, TupleSplice[S, I, Literal[1], tuple[X]]]: ...
def linspace[X: LiteralInt, D = float](
    start: float,
    end: float,
    steps: Annotated[X, Where(IntGt[X, Literal[0]])],
    *,
    out: Tensor[D, tuple[X]] | None = None,
) -> Tensor[D, tuple[X]]: ...
def logspace[X: LiteralInt, D = float](
    start: float,
    end: float,
    steps: Annotated[X, Where(IntGt[X, Literal[0]])],
    *,
    out: Tensor[D, tuple[X]] | None = None,
) -> Tensor[D, tuple[X]]: ...
def matmul[
    D,
    X1: LiteralInt,
    Y1: LiteralInt,
    X2: LiteralInt,
    Y2: LiteralInt,
](
    a: Tensor[D, tuple[X1, Y1]], b: Annotated[Tensor[D, tuple[X2, Y2]], Where(IntEq[X2, Y1])]
) -> Tensor[D, tuple[X1, Y2]]: ...
def permute[D, S: LiteralIntTuple, I: LiteralIntTuple](
    input: Tensor[D, S], dims: Annotated[I, Where(TuplePermute[S, I])]
) -> Tensor[D, TuplePermute[S, I]]: ...
@overload
def randn[S: LiteralIntTuple](*args: Unpack[S], dtype: None = None) -> Tensor[Any, S]: ...  # pyright: ignore[reportOverlappingOverload]
@overload
def randn[D, S: LiteralIntTuple](*args: Unpack[S], dtype: D) -> Tensor[D, S]: ...
@overload
def randn(*args: int, dtype: None = None) -> Tensor[Any, LiteralIntTuple]: ...
def sqrt[D, S: LiteralIntTuple](input: Tensor[D, S]) -> Tensor[D, S]: ...
@overload
def squeeze[  # pyright: ignore[reportOverlappingOverload]
    D,
    S: LiteralIntTuple,
    I: LiteralInt,
](
    input: Annotated[Tensor[D, S], Where(IntNe[TupleIndex[S, I], Literal[1]])],
    dim: I,  # pyright: ignore[reportInvalidTypeVarUse]
) -> Tensor[D, S]: ...
@overload
def squeeze[
    D,
    S: LiteralIntTuple,
    I: LiteralInt,
](
    input: Annotated[Tensor[D, S], Where(TupleIndex[S, I])], dim: I
) -> Tensor[D, TupleSplice[S, I, Literal[1], tuple[()]]]: ...
@overload
def squeeze[D](input: Tensor[D, LiteralIntTuple], dim: LiteralIntTuple | None = None) -> Tensor[D, LiteralIntTuple]: ...
@overload
def sum[D, S: LiteralIntTuple](
    input: Tensor[D, S], *, dim: None = None, keepdim: bool = False
) -> Tensor[D, tuple[Literal[1]]]: ...
@overload
def sum[D, S: LiteralIntTuple, I: LiteralInt](
    input: Tensor[D, S],
    *,
    dim: Annotated[I, Where(TupleSplice[S, I, Literal[1], tuple[()]])],
    keepdim: Literal[False] = False,
) -> Tensor[D, TupleSplice[S, I, Literal[1], tuple[()]]]: ...
@overload
def sum[D, S: LiteralIntTuple, I: LiteralInt](
    input: Tensor[D, S],
    *,
    dim: Annotated[I, Where(TupleSplice[S, I, Literal[1], tuple[Literal[1]]])],
    keepdim: Literal[True],
) -> Tensor[D, TupleSplice[S, I, Literal[1], tuple[Literal[1]]]]: ...
def take[D, S: LiteralIntTuple, X: LiteralInt](
    input: Tensor[D, S], index: Tensor[D, tuple[X]]
) -> Tensor[D, tuple[X]]: ...
@overload
def unsqueeze[  # pyright: ignore[reportOverlappingOverload]
    D,
    S: LiteralIntTuple,
    I: LiteralInt,
](
    input: Tensor[D, S], dim: Annotated[I, Where(IntGe[I, Literal[0]])]
) -> Tensor[D, TupleSplice[S, I, Literal[0], tuple[Literal[1]]]]: ...
@overload
def unsqueeze[  # pyright: ignore[reportOverlappingOverload]
    D,
    S: LiteralIntTuple,
    I: LiteralInt,
](
    input: Tensor[D, S], dim: Annotated[I, Where(IntLt[I, Literal[0]])]
) -> Tensor[
    D,
    TupleSplice[S, IntAdd[IntAdd[TupleLen[S], I], Literal[1]], Literal[0], tuple[Literal[1]]],
]: ...
@overload
def unsqueeze[D](  # pyright: ignore[reportOverlappingOverload]
    input: Tensor[D, LiteralIntTuple], dim: int
) -> Tensor[D, LiteralIntTuple]: ...
