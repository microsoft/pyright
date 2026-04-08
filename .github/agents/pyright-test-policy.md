# .github/agents/pyright-test-policy.md

# Pyright Test Policy

Tests are the specification for Pyright behavior.

Agents must **not modify tests simply to make CI pass**.

The goal is to **preserve or improve type precision** unless a justified upstream change requires otherwise.

---

# Allowed Changes

Agents may modify tests only when one of the following is true:

1. A **typeshed stub change** legitimately alters the expected type.
2. A **Pyright diagnostic message format** changed but the semantic meaning is the same.
3. A test relied on unstable formatting or ordering.

---

# Precision Regression Rule (Default)

Any change that makes types less precise is considered a **regression by default**.

Examples:

- `T → Unknown`
- `T → Any`
- container precision loss  
  `list[int] → list[Any]`
- literal widening  
  `Literal["x"] → str`

These regressions are **allowed only with justification**.

---

# Allowed Regression With Evidence

`Unknown` or `Any` changes may be accepted **only if the PR includes**:

1. **Evidence**
   - the relevant typeshed stub diff  
   - or an upstream typing change

2. **Reasoning**
   - why Pyright cannot infer the previous precision

3. **Classification**
   - A) typeshed became less precise  
   - B) Pyright limitation  
   - C) test fragility  
   - D) harness issue

4. **Mitigation**
   When possible:
   - open a typeshed issue/PR
   - or add a TODO referencing the issue

---

# Forbidden Changes

Agents must NOT:

- blindly replace expected types with `Unknown` or `Any`
- remove diagnostics
- delete `reveal_type` checks
- suppress errors to make tests pass

without the justification process above.

---

# Preferred Fix Order

Agents must attempt fixes in this order:

1. **Fix Pyright behavior**
2. **Fix incorrect typeshed stub**
3. **Adjust tests (last resort)**

---

# Precision Regression Reporting

If a regression is introduced, the agent must include a report in the PR:

Example:

Precision Regression Report

Test | Before | After | Reason
---- | ---- | ---- | ----
test_numpy_array | ndarray[int] | ndarray[Any] | typeshed change in numpy/__init__.pyi

This ensures reviewers can quickly understand the impact.

---

# Review Gate

If more than **2 precision regressions** occur in a single PR, the agent must stop and request human review.

---

# Commit Message Requirements

Each fix must include:

- failure classification (A/B/C/D)
- relevant typeshed commit (if applicable)
- explanation of how the change preserves or justifies type precision
