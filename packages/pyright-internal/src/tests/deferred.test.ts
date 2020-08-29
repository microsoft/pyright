// Copyright (c) Microsoft Corporation. All rights reserved.
// Licensed under the MIT License.

'use strict';

import * as assert from 'assert';

import { createDeferred } from '../common/deferred';

test('Deferred - resolve', (done) => {
    const valueToSent = new Date().getTime();
    const def = createDeferred<number>();
    def.promise
        .then((value) => {
            assert.equal(value, valueToSent);
            assert.equal(def.resolved, true, 'resolved property value is not `true`');
        })
        .then(done)
        .catch(done);

    assert.equal(def.resolved, false, 'Promise is resolved even when it should not be');
    assert.equal(def.rejected, false, 'Promise is rejected even when it should not be');
    assert.equal(def.completed, false, 'Promise is completed even when it should not be');

    def.resolve(valueToSent);

    assert.equal(def.resolved, true, 'Promise is not resolved even when it should not be');
    assert.equal(def.rejected, false, 'Promise is rejected even when it should not be');
    assert.equal(def.completed, true, 'Promise is not completed even when it should not be');
});
test('Deferred - reject', (done) => {
    const errorToSend = new Error('Something');
    const def = createDeferred<number>();
    def.promise
        .then((value) => {
            assert.fail(value, 'Error', 'Was expecting promise to get rejected, however it was resolved', '');
            done();
        })
        .catch((reason) => {
            assert.equal(reason, errorToSend, 'Error received is not the same');
            done();
        })
        .catch(done);

    assert.equal(def.resolved, false, 'Promise is resolved even when it should not be');
    assert.equal(def.rejected, false, 'Promise is rejected even when it should not be');
    assert.equal(def.completed, false, 'Promise is completed even when it should not be');

    def.reject(errorToSend);

    assert.equal(def.resolved, false, 'Promise is resolved even when it should not be');
    assert.equal(def.rejected, true, 'Promise is not rejected even when it should not be');
    assert.equal(def.completed, true, 'Promise is not completed even when it should not be');
});
