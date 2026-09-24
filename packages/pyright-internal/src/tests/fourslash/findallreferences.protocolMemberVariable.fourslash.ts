/// <reference path="typings/fourslash.d.ts" />

// DRIFT-TRIPWIRE ONLY — this test provides NO behavioral regression coverage. It pins the observable
// pyright-internal Find-All-References result at the exact location of a local `documentSymbolCollector`
// divergence (`_getSubclassMemberVariableDeclarations`, called from `_getDeclarationsForNonModuleNameNode`)
// so that an upstream `subrepo.py pull` which conflicts with or regresses the surrounding member-access
// resolution fails loudly in Pyright's own suite. The behaviorally-authoritative coverage for the fix
// lives in the Pylance harness (`protocolMixinMemberVariable.common.ts`).
//
// Why this is only a tripwire, not real coverage: deleting `_getSubclassMemberVariableDeclarations`
// leaves this reference set unchanged. Pyright's own MRO-walk fallback already resolves the unannotated
// `A.self.a` sites to the protocol decl `P.a`, so the FAR result here is identical with the seed-helper
// enabled or disabled (verified by toggling it off). The seed-helper only becomes load-bearing inside
// Pylance, where `ProtocolMemberUsageProvider` narrows the seed to the protocol declaration.
//
// Scenario: `A` fuses a `Protocol` base `P` (declaring `a`) with a coincidental mixin (defining
// `self.a`) and also assigns its own `self.a`. Seeding from the concrete-instance usage `obj.a`, the
// reference set covers the fused slot on `A`: `P.a`, `A.self.a`, and the `obj.a` usage. The coincidental
// `Mixin.self.a` is intentionally NOT reached here — cross-sibling linking is a Pylance-only
// override-provider behavior, not part of this Pyright-core change.

// @filename: test.py
//// from typing import Protocol
////
//// class P(Protocol):
////     [|a|]: int
////
//// class Mixin:
////     def __init__(self):
////         self.a = 2
////
//// class A(P, Mixin):
////     def __init__(self):
////         self.[|a|] = 3
////
//// obj = A()
//// print(obj.[|/*marker*/a|])

{
    const ranges = helper.getRanges();

    helper.verifyFindAllReferences({
        marker: {
            references: ranges.map((r) => {
                return { path: r.fileName, range: helper.convertPositionRange(r) };
            }),
        },
    });
}
