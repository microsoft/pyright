# Pyright Test Coverage Plan for Rust Port

This document outlines the comprehensive test coverage plan required before porting pyright to Rust.

## Executive Summary

| Component | Source Files | LOC (approx) | Current Tests | Coverage Status |
|-----------|-------------|--------------|---------------|-----------------|
| Parser | 9 | 8,500 | Basic | Needs expansion |
| Binder | 7+ | 6,000 | Indirect only | Needs refactoring + tests |
| Type Evaluator | 10+ | 35,000 | Good integration | Needs unit tests |
| Code Flow Engine | 3 | 3,000 | None direct | Needs tests |
| Checker | 1 | 7,600 | Good integration | Needs unit tests |
| Constraint Solver | 3 | 2,500 | None direct | Needs tests |
| Import Resolver | 4 | 3,000 | Basic | Needs expansion |
| Language Service | 23 | 8,000 | Fourslash tests | Adequate |
| Common Utilities | 51 | 6,000 | Partial | Needs expansion |

## Epic Breakdown

### 1. Parser Component Test Coverage (pyright-rzw) - P1

**Current State:**
- `tokenizer.test.ts` - Basic tokenizer tests exist
- `parser.test.ts` - Very basic parser tests (170 lines)
- Most parser testing is indirect through type evaluator tests

**Components:**
| File | Lines | Testability | Action Required |
|------|-------|-------------|-----------------|
| parser.ts | 5,415 | Moderate | Extract parsing functions for unit testing |
| tokenizer.ts | 1,800 | Good | Expand token type coverage |
| characterStream.ts | ~200 | Good | Add stream manipulation tests |
| stringTokenUtils.ts | ~400 | Good | Add string parsing tests |
| parseNodes.ts | ~1,500 | N/A (types) | No tests needed |
| parseNodeUtils.ts | ~300 | Good | Add utility function tests |

**Tasks:**
1. Tokenizer unit tests for all token types (pyright-rzw.1)
2. Parser unit tests for statement types (pyright-rzw.2)
3. Parser unit tests for expression types (pyright-rzw.3)
4. Parser error recovery tests (pyright-rzw.4)
5. String token utilities tests (pyright-rzw.5)

---

### 2. Binder Component Test Coverage (pyright-9vm) - P1

**Current State:**
- No direct `binder.test.ts` exists
- Binder is tested only indirectly through checker tests
- Tightly coupled to parse tree walker pattern

**Components:**
| File | Lines | Testability | Action Required |
|------|-------|-------------|-----------------|
| binder.ts | 4,437 | Poor | Extract pure functions, add dependency injection |
| scope.ts | ~400 | Moderate | Add scope creation tests |
| scopeUtils.ts | ~200 | Good | Add utility tests |
| symbol.ts | ~500 | Good | Add symbol tests |
| symbolUtils.ts | ~300 | Good | Add utility tests |
| declaration.ts | ~200 | N/A (types) | No tests needed |
| declarationUtils.ts | ~400 | Good | Add utility tests |

**Refactoring Required:**
- Extract scope creation logic into testable functions
- Extract symbol binding logic from walker methods
- Create mock parse tree builders for testing

**Tasks:**
1. Refactor binder for testability (pyright-9vm.1)
2. Scope creation and nesting tests (pyright-9vm.2)
3. Symbol binding and resolution tests (pyright-9vm.3)
4. Declaration binding tests (pyright-9vm.4)
5. Control flow node creation tests (pyright-9vm.5)

---

### 3. Type Evaluator Test Coverage (pyright-5mj) - P1

**Current State:**
- `typeEvaluator1-8.test.ts` - 8 test files with good coverage via sample files
- `typePrinter.test.ts` - Type printing tests exist
- Tests are integration-style, not unit tests

**Components:**
| File | Lines | Testability | Action Required |
|------|-------|-------------|-----------------|
| typeEvaluator.ts | 28,881 | Very Poor | Major refactoring needed |
| types.ts | ~2,000 | Good | Add type creation tests |
| typeUtils.ts | ~3,000 | Good | Add utility tests |
| typePrinter.ts | ~800 | Good | Expand tests |
| typeGuards.ts | ~2,000 | Moderate | Add narrowing tests |
| typeWalker.ts | ~300 | Good | Add walker tests |

**Refactoring Required:**
- The 29K line `typeEvaluator.ts` is a closure-based module for performance
- Cannot easily unit test internal functions
- Need to identify and extract pure functions where possible
- Consider creating a test harness that exposes internal functions

**Tasks:**
1. Refactor typeEvaluator for testability (pyright-5mj.1)
2. Type creation and manipulation unit tests (pyright-5mj.2)
3. Type compatibility and assignability tests (pyright-5mj.3)
4. Generic type instantiation tests (pyright-5mj.4)
5. TypeVar constraint solving tests (pyright-5mj.5)
6. Type printer comprehensive tests (pyright-5mj.6)

---

### 4. Code Flow Engine Test Coverage (pyright-6kc) - P1

**Current State:**
- No direct tests for code flow engine
- Tested indirectly through type narrowing samples

**Components:**
| File | Lines | Testability | Action Required |
|------|-------|-------------|-----------------|
| codeFlowEngine.ts | 2,040 | Moderate | Add graph traversal tests |
| codeFlowTypes.ts | ~300 | N/A (types) | No tests needed |
| codeFlowUtils.ts | ~200 | Good | Add utility tests |

**Tasks:**
1. Code flow graph traversal tests (pyright-6kc.1)
2. Type narrowing via code flow tests (pyright-6kc.2)
3. Reachability analysis tests (pyright-6kc.3)
4. Loop type widening tests (pyright-6kc.4)

---

### 5. Checker Component Test Coverage (pyright-d1f) - P1

**Current State:**
- `checker.test.ts` - 704 lines, good integration tests via samples
- Tests all major checking scenarios
- Missing unit tests for individual check functions

**Components:**
| File | Lines | Testability | Action Required |
|------|-------|-------------|-----------------|
| checker.ts | 7,634 | Moderate | Add unit tests for check functions |

**Tasks:**
1. Checker diagnostic rule tests (pyright-d1f.1)
2. Type annotation check tests (pyright-d1f.2)
3. Function/method override check tests (pyright-d1f.3)
4. Protocol conformance check tests (pyright-d1f.4)

---

### 6. Constraint Solver Test Coverage (pyright-vsr) - P1

**Current State:**
- No direct tests
- Tested indirectly through type evaluator tests

**Components:**
| File | Lines | Testability | Action Required |
|------|-------|-------------|-----------------|
| constraintSolver.ts | 1,398 | Good | Add solving algorithm tests |
| constraintTracker.ts | ~500 | Good | Add tracking tests |
| constraintSolution.ts | ~300 | Good | Add solution tests |

**Tasks:**
1. Basic TypeVar constraint solving tests (pyright-vsr.1)
2. ParamSpec constraint solving tests (pyright-vsr.2)
3. TypeVarTuple constraint solving tests (pyright-vsr.3)
4. Constraint widening and narrowing tests (pyright-vsr.4)
5. Multiple constraint unification tests (pyright-vsr.5)

---

### 7. Import Resolver Test Coverage (pyright-5j8) - P1

**Current State:**
- `importResolver.test.ts` exists with some tests
- Missing comprehensive module resolution tests

**Components:**
| File | Lines | Testability | Action Required |
|------|-------|-------------|-----------------|
| importResolver.ts | ~2,000 | Good | Expand test coverage |
| importResult.ts | ~100 | N/A (types) | No tests needed |
| importStatementUtils.ts | ~300 | Good | Add utility tests |
| importLogger.ts | ~100 | Good | Add logging tests |

**Tasks:**
1. Module resolution algorithm tests (pyright-5j8.1)
2. Package resolution tests (pyright-5j8.2)
3. Stub file resolution tests (pyright-5j8.3)
4. Relative import resolution tests (pyright-5j8.4)
5. sys.path manipulation tests (pyright-5j8.5)

---

### 8. Program and Service Test Coverage (pyright-cnp) - P1

**Current State:**
- `service.test.ts` exists with basic tests
- `sourceFile.test.ts` exists with some tests
- Missing incremental analysis tests

**Components:**
| File | Lines | Testability | Action Required |
|------|-------|-------------|-----------------|
| program.ts | ~1,500 | Moderate | Add program management tests |
| service.ts | ~1,000 | Good | Expand service tests |
| sourceFile.ts | ~1,200 | Moderate | Add caching tests |
| backgroundAnalysisProgram.ts | ~500 | Moderate | Add background tests |

**Tasks:**
1. Program file management tests (pyright-cnp.1)
2. Incremental analysis tests (pyright-cnp.2)
3. SourceFile parsing and caching tests (pyright-cnp.3)
4. Service configuration handling tests (pyright-cnp.4)

---

### 9. Language Service Test Coverage (pyright-3wx) - P2

**Current State:**
- Good coverage via fourslash tests (200+ tests)
- `completions.test.ts`, `hoverProvider.test.ts`, `signatureHelp.test.ts` exist
- Missing unit-level tests for provider internals

**Components:**
| File | Lines | Testability | Action Required |
|------|-------|-------------|-----------------|
| completionProvider.ts | ~2,000 | Good | Add provider unit tests |
| hoverProvider.ts | ~500 | Good | Add provider unit tests |
| definitionProvider.ts | ~400 | Good | Add provider unit tests |
| referencesProvider.ts | ~400 | Good | Add provider unit tests |
| renameProvider.ts | ~600 | Good | Add provider unit tests |
| signatureHelpProvider.ts | ~500 | Good | Add provider unit tests |
| codeActionProvider.ts | ~800 | Good | Add provider unit tests |

**Tasks:**
1. Completion provider unit tests (pyright-3wx.1)
2. Hover provider unit tests (pyright-3wx.2)
3. Definition provider unit tests (pyright-3wx.3)
4. References provider unit tests (pyright-3wx.4)
5. Rename provider unit tests (pyright-3wx.5)
6. Code action provider unit tests (pyright-3wx.6)
7. Signature help provider unit tests (pyright-3wx.7)

---

### 10. Common Utilities Test Coverage (pyright-7ea) - P2

**Current State:**
- Several utility test files exist
- `uri.test.ts`, `pathUtils.test.ts`, `collectionUtils.test.ts`, etc.
- Some gaps in coverage

**Components to Test:**
- URI handling (uri/, 9 files)
- Path utilities
- Text range utilities
- Collection utilities
- Configuration options
- Diagnostic utilities

**Tasks:**
1. URI handling tests (pyright-7ea.1)
2. Path utilities tests (pyright-7ea.2)
3. Text range and position utilities tests (pyright-7ea.3)
4. Collection utilities tests (pyright-7ea.4)
5. Configuration options tests (pyright-7ea.5)
6. Diagnostic utilities tests (pyright-7ea.6)

---

### 11. Special Type Handlers Test Coverage (pyright-asn) - P2

**Current State:**
- Tested indirectly through type evaluator sample tests
- Missing dedicated unit tests for special type handlers

**Components:**
| File | Lines | Testability | Action Required |
|------|-------|-------------|-----------------|
| dataClasses.ts | ~1,000 | Good | Add dataclass tests |
| namedTuples.ts | ~500 | Good | Add named tuple tests |
| typedDicts.ts | ~800 | Good | Add typed dict tests |
| enums.ts | ~600 | Good | Add enum tests |
| protocols.ts | ~800 | Good | Add protocol tests |
| patternMatching.ts | ~1,200 | Moderate | Add pattern tests |

**Tasks:**
1. DataClass handler tests (pyright-asn.1)
2. NamedTuple handler tests (pyright-asn.2)
3. TypedDict handler tests (pyright-asn.3)
4. Enum handler tests (pyright-asn.4)
5. Protocol handler tests (pyright-asn.5)
6. Pattern matching type narrowing tests (pyright-asn.6)

---

## Testability Assessment Summary

### Files Requiring Refactoring Before Testing

| File | Issue | Suggested Refactoring |
|------|-------|----------------------|
| typeEvaluator.ts | 29K line closure | Extract pure functions, create test harness |
| binder.ts | Tightly coupled walker | Extract binding logic, add DI |
| codeFlowEngine.ts | Coupled to type evaluator | Create mock type evaluator interface |
| checker.ts | Large file | Extract check functions into testable units |

### Files Ready for Testing (No Refactoring)

- All parser/*.ts files
- All common/*.ts utility files  
- constraintSolver.ts, constraintTracker.ts
- importResolver.ts
- All languageService/*.ts provider files
- types.ts, typeUtils.ts
- Special type handlers (dataClasses.ts, etc.)

---

## Recommended Priority Order

1. **Parser** (pyright-rzw) - Foundation for everything else
2. **Common Utilities** (pyright-7ea) - Used by all components
3. **Import Resolver** (pyright-5j8) - Critical for module loading
4. **Binder** (pyright-9vm) - Depends on parser
5. **Constraint Solver** (pyright-vsr) - Relatively isolated
6. **Type Evaluator** (pyright-5mj) - Core, needs most work
7. **Code Flow Engine** (pyright-6kc) - Depends on type evaluator
8. **Checker** (pyright-d1f) - Integration point
9. **Program/Service** (pyright-cnp) - Top-level orchestration
10. **Language Service** (pyright-3wx) - Already well-tested
11. **Special Type Handlers** (pyright-asn) - Can be done in parallel

---

## Test Infrastructure Needed

### New Test Utilities Required

1. **Parse Tree Builders** - Create parse trees programmatically for testing
2. **Type Builders** - Create Type objects for testing type operations
3. **Mock File System** - Already exists, needs enhancement
4. **Mock Type Evaluator** - For testing code flow engine
5. **Scope/Symbol Builders** - For binder unit tests

### Test Patterns to Adopt

1. **Property-based testing** - For parser and type operations
2. **Snapshot testing** - For type printer output
3. **Parameterized tests** - For systematic coverage
4. **Fuzz testing** - For parser robustness

---

## Metrics to Track

- Lines of code covered by unit tests
- Number of public functions with direct tests
- Mutation testing score
- Test execution time (for CI)

---

## Timeline Estimate

| Phase | Epics | Est. Effort | Prerequisites |
|-------|-------|-------------|---------------|
| Phase 1 | Parser, Common Utils | 2 weeks | None |
| Phase 2 | Import Resolver, Binder refactoring | 2 weeks | Phase 1 |
| Phase 3 | Constraint Solver, Type Evaluator refactoring | 3 weeks | Phase 2 |
| Phase 4 | Code Flow, Checker | 2 weeks | Phase 3 |
| Phase 5 | Program/Service, Language Service | 1 week | Phase 4 |
| Phase 6 | Special Type Handlers | 1 week | Phase 3 |

**Total: ~11 weeks**

---

## Issue Tracking

All epics and tasks have been created in the bd issue tracker:

### Epics (11 total)
- pyright-rzw: Parser Component Test Coverage (P1)
- pyright-9vm: Binder Component Test Coverage (P1)
- pyright-5mj: Type Evaluator Test Coverage (P1)
- pyright-6kc: Code Flow Engine Test Coverage (P1)
- pyright-d1f: Checker Component Test Coverage (P1)
- pyright-vsr: Constraint Solver Test Coverage (P1)
- pyright-5j8: Import Resolver Test Coverage (P1)
- pyright-cnp: Program and Service Test Coverage (P1)
- pyright-3wx: Language Service Test Coverage (P2)
- pyright-7ea: Common Utilities Test Coverage (P2)
- pyright-asn: Special Type Handlers Test Coverage (P2)

Run `bd list --tree` to see full task hierarchy.
