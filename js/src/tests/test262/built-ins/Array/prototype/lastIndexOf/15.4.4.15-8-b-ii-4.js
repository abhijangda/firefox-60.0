// Copyright (c) 2012 Ecma International.  All rights reserved.
// This code is governed by the BSD license found in the LICENSE file.

/*---
esid: sec-array.prototype.lastindexof
es5id: 15.4.4.15-8-b-ii-4
description: Array.prototype.lastIndexOf - search element is NaN
---*/

assert.sameValue([+NaN, NaN, -NaN].lastIndexOf(NaN), -1, '[+NaN, NaN, -NaN].lastIndexOf(NaN)');

reportCompare(0, 0);
