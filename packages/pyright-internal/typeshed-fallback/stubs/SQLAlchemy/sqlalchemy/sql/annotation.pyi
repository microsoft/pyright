from _typeshed import Incomplete
from typing import TypeVar

from ..schema import Table
from ..util import immutabledict
from .compiler import _CompileLabel
from .crud import _multiparam_column
from .elements import (
    AnnotatedColumnElement as _ElementsAnnotatedColumnElement,
    AsBoolean,
    BinaryExpression,
    BindParameter,
    BooleanClauseList,
    Case,
    Cast,
    ClauseList,
    CollationClause,
    CollectionAggregate,
    ColumnClause,
    ColumnElement,
    Extract,
    False_,
    FunctionFilter,
    Grouping,
    IndexExpression,
    Label,
    NamedColumn,
    Null,
    Over,
    Slice,
    TableValuedColumn,
    True_,
    Tuple,
    TypeCoerce,
    UnaryExpression,
    WithinGroup,
    _label_reference,
    _textual_label_reference,
)
from .functions import (
    AnsiFunction,
    Function,
    FunctionAsBinary,
    FunctionElement,
    GenericFunction,
    OrderedSetAgg,
    ReturnTypeFromArgs,
    ScalarFunctionColumn,
    array_agg,
    char_length,
    coalesce,
    concat,
    count,
    cube,
    cume_dist,
    current_date,
    current_time,
    current_timestamp,
    current_user,
    dense_rank,
    grouping_sets,
    localtime,
    localtimestamp,
    max,
    min,
    mode,
    next_value,
    now,
    percent_rank,
    percentile_cont,
    percentile_disc,
    random,
    rank,
    rollup,
    session_user,
    sum,
    sysdate,
    user,
)
from .schema import Column
from .selectable import (
    CTE,
    Alias,
    AliasedReturnsRows,
    AnnotatedFromClause as _SelectableAnnotatedFromClause,
    Exists,
    FromClause,
    FromGrouping,
    Join,
    Lateral,
    ScalarSelect,
    Subquery,
    TableClause,
    TableSample,
    TableValuedAlias,
    Values,
    _OffsetLimitParam,
)

_T = TypeVar("_T")

EMPTY_ANNOTATIONS: immutabledict[Incomplete, Incomplete]

class SupportsAnnotations: ...
class SupportsCloneAnnotations(SupportsAnnotations): ...
class SupportsWrappingAnnotations(SupportsAnnotations): ...

class Annotated:
    __dict__: dict[str, Incomplete]
    def __init__(self, element, values) -> None: ...
    def __reduce__(self): ...
    def __hash__(self) -> int: ...
    def __eq__(self, other): ...
    @property
    def entity_namespace(self): ...

annotated_classes: dict[Incomplete, Incomplete]

# Everything below is dynamically generated at runtime

class AnnotatedFromClause(_SelectableAnnotatedFromClause, FromClause): ...
class AnnotatedAliasedReturnsRows(AnnotatedFromClause, AliasedReturnsRows): ...
class AnnotatedAlias(AnnotatedAliasedReturnsRows, Alias): ...
class AnnotatedColumnElement(_ElementsAnnotatedColumnElement, ColumnElement[_T]): ...
class AnnotatedFunctionElement(AnnotatedColumnElement[_T], FunctionElement): ...  # type: ignore[misc]
class AnnotatedFunction(AnnotatedFunctionElement[_T], Function): ...  # type: ignore[misc]
class AnnotatedGenericFunction(AnnotatedFunction[_T], GenericFunction): ...  # type: ignore[misc]
class AnnotatedAnsiFunction(AnnotatedGenericFunction[_T], AnsiFunction): ...  # type: ignore[misc]
class AnnotatedUnaryExpression(AnnotatedColumnElement[_T], UnaryExpression): ...
class AnnotatedAsBoolean(AnnotatedUnaryExpression[_T], AsBoolean): ...
class AnnotatedBinaryExpression(AnnotatedColumnElement[_T], BinaryExpression): ...
class AnnotatedBindParameter(AnnotatedColumnElement[_T], BindParameter[_T]): ...
class AnnotatedBooleanClauseList(AnnotatedColumnElement[_T], BooleanClauseList): ...
class AnnotatedCTE(AnnotatedAliasedReturnsRows, CTE): ...
class AnnotatedCase(AnnotatedColumnElement[_T], Case): ...
class AnnotatedCast(AnnotatedColumnElement[_T], Cast): ...
class AnnotatedClauseList(Annotated, ClauseList): ...
class AnnotatedCollationClause(AnnotatedColumnElement[_T], CollationClause): ...
class AnnotatedCollectionAggregate(AnnotatedUnaryExpression[_T], CollectionAggregate): ...
class AnnotatedNamedColumn(AnnotatedColumnElement[_T], NamedColumn): ...
class AnnotatedColumnClause(AnnotatedNamedColumn[_T], ColumnClause): ...
class AnnotatedColumn(AnnotatedColumnClause[_T], Column): ...
class AnnotatedExists(AnnotatedUnaryExpression[_T], Exists): ...
class AnnotatedExtract(AnnotatedColumnElement[_T], Extract): ...
class AnnotatedFalse_(AnnotatedColumnElement[_T], False_): ...
class AnnotatedFromGrouping(AnnotatedFromClause, FromGrouping): ...
class AnnotatedFunctionAsBinary(AnnotatedBinaryExpression[_T], FunctionAsBinary): ...
class AnnotatedFunctionFilter(AnnotatedColumnElement[_T], FunctionFilter): ...
class AnnotatedGrouping(AnnotatedColumnElement[_T], Grouping): ...
class AnnotatedIndexExpression(AnnotatedBinaryExpression[_T], IndexExpression): ...
class AnnotatedJoin(AnnotatedFromClause, Join): ...
class AnnotatedLabel(AnnotatedColumnElement[_T], Label): ...
class AnnotatedLateral(AnnotatedAliasedReturnsRows, Lateral): ...
class AnnotatedNull(AnnotatedColumnElement[_T], Null): ...
class AnnotatedOrderedSetAgg(AnnotatedGenericFunction[_T], OrderedSetAgg): ...  # type: ignore[misc]
class AnnotatedOver(AnnotatedColumnElement[_T], Over): ...
class AnnotatedReturnTypeFromArgs(AnnotatedGenericFunction[_T], ReturnTypeFromArgs): ...  # type: ignore[misc]
class AnnotatedScalarFunctionColumn(AnnotatedNamedColumn[_T], ScalarFunctionColumn): ...
class AnnotatedScalarSelect(AnnotatedGrouping[_T], ScalarSelect): ...
class AnnotatedSlice(AnnotatedColumnElement[_T], Slice): ...
class AnnotatedSubquery(AnnotatedAliasedReturnsRows, Subquery): ...
class AnnotatedTableClause(AnnotatedFromClause, TableClause): ...
class AnnotatedTable(AnnotatedTableClause, Table): ...
class AnnotatedTableSample(AnnotatedAliasedReturnsRows, TableSample): ...
class AnnotatedTableValuedAlias(AnnotatedAlias, TableValuedAlias): ...
class AnnotatedTableValuedColumn(AnnotatedNamedColumn[_T], TableValuedColumn): ...
class AnnotatedTrue_(AnnotatedColumnElement[_T], True_): ...
class AnnotatedTuple(AnnotatedColumnElement[_T], Tuple): ...
class AnnotatedTypeCoerce(AnnotatedColumnElement[_T], TypeCoerce): ...
class AnnotatedValues(AnnotatedFromClause, Values): ...
class AnnotatedWithinGroup(AnnotatedColumnElement[_T], WithinGroup): ...
class Annotated_CompileLabel(AnnotatedColumnElement[_T], _CompileLabel): ...
class Annotated_OffsetLimitParam(AnnotatedBindParameter[_T], _OffsetLimitParam): ...
class Annotated_label_reference(AnnotatedColumnElement[_T], _label_reference): ...
class Annotated_multiparam_column(AnnotatedColumnElement[_T], _multiparam_column[_T]): ...
class Annotated_textual_label_reference(AnnotatedColumnElement[_T], _textual_label_reference): ...
class Annotatedarray_agg(AnnotatedGenericFunction[_T], array_agg): ...  # type: ignore[misc]
class Annotatedchar_length(AnnotatedGenericFunction[_T], char_length): ...  # type: ignore[misc]
class Annotatedcoalesce(AnnotatedReturnTypeFromArgs[_T], coalesce): ...  # type: ignore[misc]
class Annotatedconcat(AnnotatedGenericFunction[_T], concat): ...  # type: ignore[misc]
class Annotatedcount(AnnotatedGenericFunction[_T], count): ...  # type: ignore[misc]
class Annotatedcube(AnnotatedGenericFunction[_T], cube): ...  # type: ignore[misc]
class Annotatedcume_dist(AnnotatedGenericFunction[_T], cume_dist): ...  # type: ignore[misc]
class Annotatedcurrent_date(AnnotatedAnsiFunction[_T], current_date): ...  # type: ignore[misc]
class Annotatedcurrent_time(AnnotatedAnsiFunction[_T], current_time): ...  # type: ignore[misc]
class Annotatedcurrent_timestamp(AnnotatedAnsiFunction[_T], current_timestamp): ...  # type: ignore[misc]
class Annotatedcurrent_user(AnnotatedAnsiFunction[_T], current_user): ...  # type: ignore[misc]
class Annotateddense_rank(AnnotatedGenericFunction[_T], dense_rank): ...  # type: ignore[misc]
class Annotatedgrouping_sets(AnnotatedGenericFunction[_T], grouping_sets): ...  # type: ignore[misc]
class Annotatedlocaltime(AnnotatedAnsiFunction[_T], localtime): ...  # type: ignore[misc]
class Annotatedlocaltimestamp(AnnotatedAnsiFunction[_T], localtimestamp): ...  # type: ignore[misc]
class Annotatedmax(AnnotatedReturnTypeFromArgs[_T], max): ...  # type: ignore[misc]
class Annotatedmin(AnnotatedReturnTypeFromArgs[_T], min): ...  # type: ignore[misc]
class Annotatedmode(AnnotatedOrderedSetAgg[_T], mode): ...  # type: ignore[misc]
class Annotatednext_value(AnnotatedGenericFunction[_T], next_value): ...  # type: ignore[misc]
class Annotatednow(AnnotatedGenericFunction[_T], now): ...  # type: ignore[misc]
class Annotatedpercent_rank(AnnotatedGenericFunction[_T], percent_rank): ...  # type: ignore[misc]
class Annotatedpercentile_cont(AnnotatedOrderedSetAgg[_T], percentile_cont): ...  # type: ignore[misc]
class Annotatedpercentile_disc(AnnotatedOrderedSetAgg[_T], percentile_disc): ...  # type: ignore[misc]
class Annotatedrandom(AnnotatedGenericFunction[_T], random): ...  # type: ignore[misc]
class Annotatedrank(AnnotatedGenericFunction[_T], rank): ...  # type: ignore[misc]
class Annotatedrollup(AnnotatedGenericFunction[_T], rollup): ...  # type: ignore[misc]
class Annotatedsession_user(AnnotatedAnsiFunction[_T], session_user): ...  # type: ignore[misc]
class Annotatedsum(AnnotatedReturnTypeFromArgs[_T], sum): ...  # type: ignore[misc]
class Annotatedsysdate(AnnotatedAnsiFunction[_T], sysdate): ...  # type: ignore[misc]
class Annotateduser(AnnotatedAnsiFunction[_T], user): ...  # type: ignore[misc]
