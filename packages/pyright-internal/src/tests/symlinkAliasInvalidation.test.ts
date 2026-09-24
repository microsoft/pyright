/*
 * symlinkAliasInvalidation.test.ts
 *
 * Regression tests for stale diagnostics across filesystem symlink aliases.
 *
 * A filesystem symlink and its target are tracked as two independent
 * SourceFileInfo entries (the source-file map is keyed by uri.key, with no
 * realpath/inode dedup). When a change is routed to one alias (e.g. the fs
 * watcher fires for the real target path after an editor save/undo), the other
 * alias — and any consumer that imported *that* alias — must also be
 * invalidated. Invalidation recurses only through `importedBy`, so without an
 * explicit realpath-twin bridge the consumer is never re-checked, its
 * diagnostics are never recomputed, and a stale diagnostic persists until the
 * file is manually edited.
 *
 * The twin must be invalidated at the CONTENT level (markDirty -> re-parse from
 * disk), not merely re-check-required: otherwise it keeps its cached symbol
 * table and the consumer re-resolves against stale symbols.
 */

import assert from 'assert';

import { DiagnosticCategory } from '../common/diagnostic';
import { Uri } from '../common/uri/uri';
import { parseAndGetTestState, TestState } from './harness/fourslash/testState';

// Consumer imports the symbol from the SYMLINK twin; a change routed to the real
// target must still re-check it.
const consumerOfTwin = `
// @filename: linked/__init__.py
//// # package marker

// @filename: linked/shared.py
//// class SharedType:
////     pass

// @filename: consumer.py
//// from linked.shared_link import SharedType
//// x = SharedType()
`;

// Consumer imports the symbol from the REAL target; a change routed to the
// symlink twin must still re-check it (reverse direction).
const consumerOfTarget = `
// @filename: linked/__init__.py
//// # package marker

// @filename: linked/shared.py
//// class SharedType:
////     pass

// @filename: consumer.py
//// from linked.shared import SharedType
//// x = SharedType()
`;

const removedTargetContent = 'class RenamedType:\n    pass\n';

test('symlink twin invalidation clears stale diagnostics on the consumer of the twin', () => {
    const state = parseAndGetTestState(consumerOfTwin, '/proj').state;
    const provider = state.serviceProvider;

    const sharedUri = Uri.file('/proj/linked/shared.py', provider);
    const linkUri = Uri.file('/proj/linked/shared_link.py', provider);
    const consumerUri = Uri.file('/proj/consumer.py', provider);

    // shared_link.py is a symlink to shared.py, so it resolves to the same
    // realpath and exposes the same symbols.
    state.testFS.symlinkSync('/proj/linked/shared.py', '/proj/linked/shared_link.py');

    state.program.addTrackedFiles([sharedUri, linkUri, consumerUri]);
    state.analyze();

    // Baseline: SharedType exists via the symlink twin, so the consumer is clean.
    assert.deepStrictEqual(errorMessagesOn(state, consumerUri), []);

    // Capture the twin's content version so we can assert it advances (i.e. the
    // twin is invalidated at the CONTENT level, not merely re-check-required).
    const twinVersionBefore = state.program.getSourceFile(linkUri)!.getFileContentsVersion();

    // Rewrite the backing file to remove SharedType (as an editor save/undo would).
    // Because shared_link.py is a symlink to shared.py, reading the twin now yields
    // the new content too.
    state.testFS.writeFileSync(sharedUri, removedTargetContent);

    // Simulate the fs watcher firing for the real target path only.
    state.program.markFilesDirty([sharedUri], /* evenIfContentsAreSame */ false);
    state.analyze();

    // The twin's content version must advance: co-invalidation calls markDirty on
    // the twin, which re-parses it from disk. If a future refactor downgrades this
    // to re-check-only, the version would stay put and this guard would fail.
    assert.ok(
        state.program.getSourceFile(linkUri)!.getFileContentsVersion() > twinVersionBefore,
        'Expected the symlink twin fileContentsVersion to advance after co-invalidation'
    );

    // The consumer imported `linked.shared_link` (the twin), which no longer
    // exposes SharedType. Its stale "clean" diagnostics must be recomputed to the
    // exact unresolved-import error. The exact message (rather than a substring)
    // also guards against a future refactor that downgrades twin invalidation to
    // re-check-only, which would leave the twin's cached symbol table intact and
    // produce no error at all.
    assert.deepStrictEqual(errorMessagesOn(state, consumerUri), [unknownImportError('SharedType')]);
});

test('symlink target invalidation clears stale diagnostics on the consumer of the real target', () => {
    const state = parseAndGetTestState(consumerOfTarget, '/proj').state;
    const provider = state.serviceProvider;

    const sharedUri = Uri.file('/proj/linked/shared.py', provider);
    const linkUri = Uri.file('/proj/linked/shared_link.py', provider);
    const consumerUri = Uri.file('/proj/consumer.py', provider);

    state.testFS.symlinkSync('/proj/linked/shared.py', '/proj/linked/shared_link.py');

    state.program.addTrackedFiles([sharedUri, linkUri, consumerUri]);
    state.analyze();

    assert.deepStrictEqual(errorMessagesOn(state, consumerUri), []);

    // Rewrite the backing file, then route the change to the SYMLINK twin only.
    state.testFS.writeFileSync(sharedUri, removedTargetContent);
    state.program.markFilesDirty([linkUri], /* evenIfContentsAreSame */ false);
    state.analyze();

    // The consumer imported `linked.shared` (the real target); marking the twin
    // dirty must bridge back to the target and re-check the consumer.
    assert.deepStrictEqual(errorMessagesOn(state, consumerUri), [unknownImportError('SharedType')]);
});

test('non-symlinked files do not spuriously invalidate unrelated consumers', () => {
    // Two distinct real modules (no symlink). Changing one must not re-check a
    // consumer of the other — guards against over-broad alias invalidation.
    const code = `
// @filename: pkg/__init__.py
//// # package marker

// @filename: pkg/a.py
//// class AType:
////     pass

// @filename: pkg/b.py
//// class BType:
////     pass

// @filename: consumer.py
//// from pkg.b import BType
//// y = BType()
`;
    const state = parseAndGetTestState(code, '/proj').state;
    const provider = state.serviceProvider;

    const aUri = Uri.file('/proj/pkg/a.py', provider);
    const consumerUri = Uri.file('/proj/consumer.py', provider);

    state.analyze();
    assert.deepStrictEqual(errorMessagesOn(state, consumerUri), []);

    // Change an unrelated module and mark it dirty.
    state.testFS.writeFileSync(aUri, 'class ARenamed:\n    pass\n');
    state.program.markFilesDirty([aUri], /* evenIfContentsAreSame */ false);
    state.analyze();

    // Consumer of pkg.b is unaffected.
    assert.deepStrictEqual(errorMessagesOn(state, consumerUri), []);
});

test('closing a symlink alias co-invalidates the twin so its consumer is re-checked', () => {
    // Exercises the setFileClosed entrypoint (not just markFilesDirty). The
    // consumer imports the symlink twin; the real target is open and then closed
    // after its backing file changed on disk. setFileClosed must bridge to the
    // twin (same realpath) and re-check the twin's consumer.
    const state = parseAndGetTestState(consumerOfTwin, '/proj').state;
    const provider = state.serviceProvider;

    const sharedUri = Uri.file('/proj/linked/shared.py', provider);
    const linkUri = Uri.file('/proj/linked/shared_link.py', provider);
    const consumerUri = Uri.file('/proj/consumer.py', provider);

    state.testFS.symlinkSync('/proj/linked/shared.py', '/proj/linked/shared_link.py');

    state.program.addTrackedFiles([sharedUri, linkUri, consumerUri]);

    // Open the real target as an editor document, then analyze.
    state.program.setFileOpened(sharedUri, 1, 'class SharedType:\n    pass\n');
    state.analyze();

    assert.deepStrictEqual(errorMessagesOn(state, consumerUri), []);

    // The backing file changes on disk (rename/undo save), then the target
    // document is closed. Closing must co-invalidate the symlink twin.
    state.testFS.writeFileSync(sharedUri, removedTargetContent);
    state.program.setFileClosed(sharedUri);
    state.analyze();

    assert.deepStrictEqual(errorMessagesOn(state, consumerUri), [unknownImportError('SharedType')]);
});

test('open-content invalidation (evenIfContentsAreSame) still bridges symlink twins when disk changed', () => {
    // The open-document update path calls markFilesDirty(evenIfContentsAreSame=true).
    // When the backing file actually changed on disk, twin co-invalidation must
    // still fire, and unrelated files must not be dragged in.
    const code = `
// @filename: linked/__init__.py
//// # package marker

// @filename: linked/shared.py
//// class SharedType:
////     pass

// @filename: unrelated.py
//// value = 1

// @filename: consumer.py
//// from linked.shared_link import SharedType
//// x = SharedType()
`;
    const state = parseAndGetTestState(code, '/proj').state;
    const provider = state.serviceProvider;

    const sharedUri = Uri.file('/proj/linked/shared.py', provider);
    const linkUri = Uri.file('/proj/linked/shared_link.py', provider);
    const consumerUri = Uri.file('/proj/consumer.py', provider);
    const unrelatedUri = Uri.file('/proj/unrelated.py', provider);

    state.testFS.symlinkSync('/proj/linked/shared.py', '/proj/linked/shared_link.py');

    state.program.addTrackedFiles([sharedUri, linkUri, consumerUri, unrelatedUri]);
    state.analyze();

    assert.deepStrictEqual(errorMessagesOn(state, consumerUri), []);
    assert.deepStrictEqual(errorMessagesOn(state, unrelatedUri), []);

    state.testFS.writeFileSync(sharedUri, removedTargetContent);
    state.program.markFilesDirty([sharedUri], /* evenIfContentsAreSame */ true);
    state.analyze();

    assert.deepStrictEqual(errorMessagesOn(state, consumerUri), [unknownImportError('SharedType')]);
    // The unrelated file (not a realpath alias) must remain clean.
    assert.deepStrictEqual(errorMessagesOn(state, unrelatedUri), []);
});

test('an in-memory open edit (evenIfContentsAreSame, no disk change) does not re-check the twin', () => {
    // Regression for over-invalidation: updateOpenFileContents calls
    // markFilesDirty(evenIfContentsAreSame=true) on every keystroke. Twin fan-out
    // must NOT force the other alias (and its importer subtree) to be re-checked
    // when the twin's on-disk contents are unchanged, otherwise every keystroke on
    // one alias triggers a full recheck of the other alias's dependents.
    const code = `
// @filename: linked/__init__.py
//// # package marker

// @filename: linked/shared.py
//// class SharedType:
////     pass

// @filename: consumer.py
//// from linked.shared_link import SharedType
//// x = SharedType()
`;
    const state = parseAndGetTestState(code, '/proj').state;
    const provider = state.serviceProvider;

    const sharedUri = Uri.file('/proj/linked/shared.py', provider);
    const linkUri = Uri.file('/proj/linked/shared_link.py', provider);
    const consumerUri = Uri.file('/proj/consumer.py', provider);

    state.testFS.symlinkSync('/proj/linked/shared.py', '/proj/linked/shared_link.py');

    state.program.addTrackedFiles([sharedUri, linkUri, consumerUri]);
    // Open the real target as an editor document, then analyze so everything is clean.
    state.program.setFileOpened(sharedUri, 1, 'class SharedType:\n    pass\n');
    state.analyze();

    assert.deepStrictEqual(errorMessagesOn(state, consumerUri), []);

    // Simulate a keystroke: the open document's in-memory contents change but the
    // backing file on disk does NOT. This is exactly what updateOpenFileContents
    // does (markFilesDirty with evenIfContentsAreSame=true).
    state.program.setFileOpened(sharedUri, 2, 'class SharedType:\n    pass\n# edit\n');
    state.program.markFilesDirty([sharedUri], /* evenIfContentsAreSame */ true);

    // The edited (open) file itself needs re-checking, but the twin alias must not
    // have been dragged in, since its on-disk contents are unchanged.
    const linkInfo = state.program.getSourceFileInfo(linkUri);
    const consumerInfo = state.program.getSourceFileInfo(consumerUri);
    assert.ok(linkInfo, 'expected twin alias to be tracked');
    assert.ok(consumerInfo, 'expected twin consumer to be tracked');
    assert.strictEqual(
        linkInfo!.sourceFile.isCheckingRequired(),
        false,
        'twin alias must not be re-checked on an in-memory-only edit'
    );
    assert.strictEqual(
        consumerInfo!.sourceFile.isCheckingRequired(),
        false,
        "twin's consumer must not be re-checked on an in-memory-only edit"
    );
});

test('a 3+ member symlink group fans out to every alias consumer', () => {
    // Two symlinks to one target, with a distinct consumer per symlink. A change
    // routed to the target must re-check BOTH alias consumers — exercises the
    // multi-entry aliasKeys fan-out (not just a 2-member group).
    const code = `
// @filename: linked/__init__.py
//// # package marker

// @filename: linked/shared.py
//// class SharedType:
////     pass

// @filename: consumer1.py
//// from linked.link1 import SharedType
//// a = SharedType()

// @filename: consumer2.py
//// from linked.link2 import SharedType
//// b = SharedType()
`;
    const state = parseAndGetTestState(code, '/proj').state;
    const provider = state.serviceProvider;

    const sharedUri = Uri.file('/proj/linked/shared.py', provider);
    const link1Uri = Uri.file('/proj/linked/link1.py', provider);
    const link2Uri = Uri.file('/proj/linked/link2.py', provider);
    const consumer1Uri = Uri.file('/proj/consumer1.py', provider);
    const consumer2Uri = Uri.file('/proj/consumer2.py', provider);

    state.testFS.symlinkSync('/proj/linked/shared.py', '/proj/linked/link1.py');
    state.testFS.symlinkSync('/proj/linked/shared.py', '/proj/linked/link2.py');

    state.program.addTrackedFiles([sharedUri, link1Uri, link2Uri, consumer1Uri, consumer2Uri]);
    state.analyze();

    assert.deepStrictEqual(errorMessagesOn(state, consumer1Uri), []);
    assert.deepStrictEqual(errorMessagesOn(state, consumer2Uri), []);

    state.testFS.writeFileSync(sharedUri, removedTargetContent);
    state.program.markFilesDirty([sharedUri], /* evenIfContentsAreSame */ false);
    state.analyze();

    assert.deepStrictEqual(errorMessagesOn(state, consumer1Uri), [unknownImportError('SharedType')]);
    assert.deepStrictEqual(errorMessagesOn(state, consumer2Uri), [unknownImportError('SharedType')]);
});

test('multiple consumers of the same twin are all re-checked', () => {
    const code = `
// @filename: linked/__init__.py
//// # package marker

// @filename: linked/shared.py
//// class SharedType:
////     pass

// @filename: consumer1.py
//// from linked.shared_link import SharedType
//// a = SharedType()

// @filename: consumer2.py
//// from linked.shared_link import SharedType
//// b = SharedType()
`;
    const state = parseAndGetTestState(code, '/proj').state;
    const provider = state.serviceProvider;

    const sharedUri = Uri.file('/proj/linked/shared.py', provider);
    const linkUri = Uri.file('/proj/linked/shared_link.py', provider);
    const consumer1Uri = Uri.file('/proj/consumer1.py', provider);
    const consumer2Uri = Uri.file('/proj/consumer2.py', provider);

    state.testFS.symlinkSync('/proj/linked/shared.py', '/proj/linked/shared_link.py');
    state.program.addTrackedFiles([sharedUri, linkUri, consumer1Uri, consumer2Uri]);
    state.analyze();

    assert.deepStrictEqual(errorMessagesOn(state, consumer1Uri), []);
    assert.deepStrictEqual(errorMessagesOn(state, consumer2Uri), []);

    state.testFS.writeFileSync(sharedUri, removedTargetContent);
    state.program.markFilesDirty([sharedUri], /* evenIfContentsAreSame */ false);
    state.analyze();

    assert.deepStrictEqual(errorMessagesOn(state, consumer1Uri), [unknownImportError('SharedType')]);
    assert.deepStrictEqual(errorMessagesOn(state, consumer2Uri), [unknownImportError('SharedType')]);
});

test('two independent symlink groups do not cross-invalidate', () => {
    const code = `
// @filename: pkg/__init__.py
//// # package marker

// @filename: pkg/a.py
//// class TypeA:
////     pass

// @filename: pkg/b.py
//// class TypeB:
////     pass

// @filename: consumerA.py
//// from pkg.a_link import TypeA
//// a = TypeA()

// @filename: consumerB.py
//// from pkg.b_link import TypeB
//// b = TypeB()
`;
    const state = parseAndGetTestState(code, '/proj').state;
    const provider = state.serviceProvider;

    const aUri = Uri.file('/proj/pkg/a.py', provider);
    const bUri = Uri.file('/proj/pkg/b.py', provider);
    const aLinkUri = Uri.file('/proj/pkg/a_link.py', provider);
    const bLinkUri = Uri.file('/proj/pkg/b_link.py', provider);
    const consumerAUri = Uri.file('/proj/consumerA.py', provider);
    const consumerBUri = Uri.file('/proj/consumerB.py', provider);

    state.testFS.symlinkSync('/proj/pkg/a.py', '/proj/pkg/a_link.py');
    state.testFS.symlinkSync('/proj/pkg/b.py', '/proj/pkg/b_link.py');

    state.program.addTrackedFiles([aUri, bUri, aLinkUri, bLinkUri, consumerAUri, consumerBUri]);
    state.analyze();

    assert.deepStrictEqual(errorMessagesOn(state, consumerAUri), []);
    assert.deepStrictEqual(errorMessagesOn(state, consumerBUri), []);

    // Change group A's target only.
    state.testFS.writeFileSync(aUri, 'class RenamedA:\n    pass\n');
    state.program.markFilesDirty([aUri], /* evenIfContentsAreSame */ false);
    state.analyze();

    assert.deepStrictEqual(errorMessagesOn(state, consumerAUri), [unknownImportError('TypeA')]);
    // Group B is a different realpath group and must stay clean.
    assert.deepStrictEqual(errorMessagesOn(state, consumerBUri), []);
});

test('alias index survives file removal and re-add', () => {
    // Exercises _unindexRealpathAlias (on removal) and re-indexing (on re-add):
    // after the alias group is torn down and rebuilt, co-invalidation must still
    // work and no stale index entry may misdirect invalidation.
    const state = parseAndGetTestState(consumerOfTwin, '/proj').state;
    const provider = state.serviceProvider;

    const sharedUri = Uri.file('/proj/linked/shared.py', provider);
    const linkUri = Uri.file('/proj/linked/shared_link.py', provider);
    const consumerUri = Uri.file('/proj/consumer.py', provider);

    state.testFS.symlinkSync('/proj/linked/shared.py', '/proj/linked/shared_link.py');

    state.program.addTrackedFiles([sharedUri, linkUri, consumerUri]);
    state.analyze();
    assert.deepStrictEqual(errorMessagesOn(state, consumerUri), []);

    // Tear down: untrack everything so _removeUnneededFiles evicts the files
    // (and _unindexRealpathAlias runs for the symlink group).
    state.program.setTrackedFiles([]);
    state.analyze();
    assert.strictEqual(
        state.program.getSourceFileInfo(linkUri),
        undefined,
        'Expected the symlink twin to be removed from the program after untracking'
    );

    // Re-add the same files; the alias index must be rebuilt from scratch.
    state.program.addTrackedFiles([sharedUri, linkUri, consumerUri]);
    state.analyze();
    assert.deepStrictEqual(errorMessagesOn(state, consumerUri), []);

    // Co-invalidation must work again against the rebuilt index.
    state.testFS.writeFileSync(sharedUri, removedTargetContent);
    state.program.markFilesDirty([sharedUri], /* evenIfContentsAreSame */ false);
    state.analyze();

    assert.deepStrictEqual(errorMessagesOn(state, consumerUri), [unknownImportError('SharedType')]);
});

test('a twin first seen as an untracked import is indexed once it becomes tracked', () => {
    // Ordering gap: the symlink twin is discovered first via import resolution
    // (untracked -> skipped by the user-code-only index), then later tracked. The
    // tracked-flip must (re-)index it so co-invalidation applies.
    const state = parseAndGetTestState(consumerOfTwin, '/proj').state;
    const provider = state.serviceProvider;

    const sharedUri = Uri.file('/proj/linked/shared.py', provider);
    const linkUri = Uri.file('/proj/linked/shared_link.py', provider);
    const consumerUri = Uri.file('/proj/consumer.py', provider);

    state.testFS.symlinkSync('/proj/linked/shared.py', '/proj/linked/shared_link.py');

    // Track only the target + consumer. The twin (shared_link.py) is pulled in as
    // an untracked referenced import during analysis.
    state.program.addTrackedFiles([sharedUri, consumerUri]);
    state.analyze();
    assert.deepStrictEqual(errorMessagesOn(state, consumerUri), []);

    // Now the twin becomes tracked (e.g. enumeration catches up / it is opened).
    state.program.setTrackedFiles([sharedUri, linkUri, consumerUri]);
    state.analyze();

    // Route a change to the real target; the now-tracked twin must be bridged.
    state.testFS.writeFileSync(sharedUri, removedTargetContent);
    state.program.markFilesDirty([sharedUri], /* evenIfContentsAreSame */ false);
    state.analyze();

    assert.deepStrictEqual(errorMessagesOn(state, consumerUri), [unknownImportError('SharedType')]);
});

test('re-adding only the realpath target rebuilds the alias group', () => {
    // Comment-2 scenario: remove ONLY the realpath target (leaving the symlink
    // twin tracked), then re-add ONLY the target. The alias group must be
    // rebuilt so co-invalidation through the twin keeps working.
    const state = parseAndGetTestState(consumerOfTwin, '/proj').state;
    const provider = state.serviceProvider;

    const sharedUri = Uri.file('/proj/linked/shared.py', provider);
    const linkUri = Uri.file('/proj/linked/shared_link.py', provider);
    const consumerUri = Uri.file('/proj/consumer.py', provider);

    state.testFS.symlinkSync('/proj/linked/shared.py', '/proj/linked/shared_link.py');

    state.program.addTrackedFiles([sharedUri, linkUri, consumerUri]);
    state.analyze();
    assert.deepStrictEqual(errorMessagesOn(state, consumerUri), []);

    // Untrack only the realpath target; the symlink twin + consumer stay tracked.
    state.program.setTrackedFiles([linkUri, consumerUri]);
    state.analyze();
    assert.strictEqual(
        state.program.getSourceFileInfo(sharedUri),
        undefined,
        'Expected the realpath target to be removed from the program after untracking it'
    );

    // Re-add only the realpath target. The alias group (still holding the twin)
    // must be rebuilt to include the target again.
    state.program.setTrackedFiles([sharedUri, linkUri, consumerUri]);
    state.analyze();
    assert.deepStrictEqual(errorMessagesOn(state, consumerUri), []);

    // Co-invalidation must work again through the rebuilt group.
    state.testFS.writeFileSync(sharedUri, removedTargetContent);
    state.program.markFilesDirty([sharedUri], /* evenIfContentsAreSame */ false);
    state.analyze();

    assert.deepStrictEqual(errorMessagesOn(state, consumerUri), [unknownImportError('SharedType')]);
});

test('an alias whose realpath target is never indexed does not leak a stale group on removal', () => {
    // A symlink whose resolved target is never added (e.g. it resolves outside
    // the workspace) seeds the alias group with the unindexed target key.
    // Removing the alias must drop the group entirely rather than leaving a
    // permanent one-entry remnant behind that accumulates over a long session.
    const state = parseAndGetTestState(consumerOfTwin, '/proj').state;
    const provider = state.serviceProvider;

    const unindexedTargetUri = Uri.file('/proj/linked/ext_real.py', provider);
    const aliasUri = Uri.file('/proj/linked/ext_link.py', provider);

    // ext_link.py is a symlink to a file that is never tracked or imported, so
    // only the alias is indexed while its realpath target remains unindexed.
    state.testFS.writeFileSync(unindexedTargetUri, 'value = 1\n');
    state.testFS.symlinkSync('/proj/linked/ext_real.py', '/proj/linked/ext_link.py');

    state.program.addTrackedFiles([aliasUri]);
    state.analyze();

    const aliasMap = (state.program as any)._realpathAliasMap as Map<string, Set<string>>;
    assert.strictEqual(aliasMap.size, 1, 'Expected the alias to seed a realpath group while tracked');

    // Untracking the alias must not leave a lingering realpath group behind,
    // since the only remaining key is the never-indexed target seed.
    state.program.setTrackedFiles([]);
    state.analyze();

    assert.strictEqual(
        aliasMap.size,
        0,
        'Expected no lingering realpath alias group after removing an alias whose target was never indexed'
    );
});

function unknownImportError(name: string): string {
    return `"${name}" is unknown import symbol`;
}

function errorMessagesOn(state: TestState, uri: Uri): string[] {
    const diags = state.program.getSourceFile(uri)!.getDiagnostics(state.configOptions) ?? [];
    return diags.filter((d) => d.category === DiagnosticCategory.Error).map((d) => d.message);
}
