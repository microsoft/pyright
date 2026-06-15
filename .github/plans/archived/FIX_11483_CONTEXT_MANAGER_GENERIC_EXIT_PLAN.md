# Fix #11483 — Incorrect type inference from context manager `__exit__` return type with Generic
## Status: ✅ Complete

Status: ✅ Complete (pending pipeline push/PR)

Issue: https://github.com/microsoft/pyright/issues/11483

## Problem

When a generic context manager annotates its `__exit__` (or `__aexit__`) return
type with a `TypeVar` (e.g. `class ContextManager(Generic[T])` whose `__exit__`
returns `T` with `T` bound to `bool | None`), pyright determines exception
suppression from the **unspecialized declared** return type instead of the
solved type argument. As a result `ContextManager[bool]` was treated as
non-suppressing, so code-flow narrowing after the `with` block was wrong
(`reveal_type(foo)` was `Literal[1]` instead of `Literal["str", 1]`).

## Root cause (debugger-verified)

`isExceptionContextManager` in `packages/pyright-internal/src/analyzer/codeFlowEngine.ts`
read `exitType.shared.declaredReturnType`, which is the raw declared return type.

Debugger evidence at the `bool` case breakpoint:
- `exitType.shared.declaredReturnType.shared.name` = `"T"` (TypeVar — the bug)
- `exitType.priv.specializedTypes.returnType.shared.name` = `"bool"` (solved)

Because the declared type was the TypeVar `T`, the `ClassType.isBuiltIn(returnType, 'bool')`
check never matched and `cmSwallowsExceptions` stayed `false`.

## Fix

Use `FunctionType.getEffectiveReturnType(exitType, /* includeInferred */ false)`,
which prefers `priv.specializedTypes.returnType` over `shared.declaredReturnType`.
This returns the specialized `bool` / `None` and covers both `__exit__` and
`__aexit__` (the async Coroutine-unwrapping logic is preserved).

## Tests

- Sample: `packages/pyright-internal/src/tests/samples/with7.py` — generic sync
  and async context managers specialized to `None` and `bool`, asserting the
  narrowed type after the block via `assert_type`.
- Test case: `With7` in `packages/pyright-internal/src/tests/checker.test.ts`.

## Validation

- Red → green: With7 failed before the fix (4 assert_type mismatches), passes after.
- Debugger confirmed declared=`T` vs specialized=`bool`/`None`.
- `checker.test` (72) and `typeEvaluator1-8` (1163) suites pass.
- Prettier, ESLint (legacy config), and `tsc --noEmit` clean.
