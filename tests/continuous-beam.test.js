'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, approxEqual } = require('./helpers');

test('continuous, 2 equal simple spans, matching full UDL: classic 3-moment result', () => {
  // Textbook case: M_B = -wL^2/8, R_A = R_C = 3wL/8, R_B = 5wL/4.
  const { api } = createApp({
    beamType: { value: 'continuous' },
    span1Length: { value: '10' },
    span2Length: { value: '10' },
  });
  const { loads, calculateContinuousBeam } = api;

  const w = 10;
  const L = 10;
  loads.push({ type: 'udl', magnitude: w, start: 0, end: 10 });
  loads.push({ type: 'udl', magnitude: w, start: 10, end: 20 });

  const result = calculateContinuousBeam();
  const midMoment = result.supportDisplay[1].left;

  assert.ok(approxEqual(midMoment, -(w * L * L) / 8, 0.5), `M_B = ${midMoment}`);
  assert.ok(approxEqual(result.reactions[0], (3 * w * L) / 8, 0.05));
  assert.ok(approxEqual(result.reactions[1], (5 * w * L) / 4, 0.05));
  assert.ok(approxEqual(result.reactions[2], (3 * w * L) / 8, 0.05));

  const total = result.reactions.reduce((a, b) => a + b, 0);
  assert.ok(approxEqual(total, 2 * w * L, 0.05), 'reactions must sum to the total applied load');
});

test('continuous, both ends fixed, 2 equal spans, matching full UDL: all three support moments equal -wL^2/12', () => {
  // Symmetric special case, derived by hand: M_0 = M_1 = M_2 = -wL^2/12,
  // R_end = wL/2, R_mid = wL.
  const { api } = createApp({
    beamType: { value: 'continuous' },
    span1Length: { value: '10' },
    span2Length: { value: '10' },
    leftEndSupport: { value: 'fixed' },
    rightEndSupport: { value: 'fixed' },
  });
  const { loads, calculateContinuousBeam } = api;

  const w = 10;
  const L = 10;
  loads.push({ type: 'udl', magnitude: w, start: 0, end: 10 });
  loads.push({ type: 'udl', magnitude: w, start: 10, end: 20 });

  const result = calculateContinuousBeam();
  const expectedM = -(w * L * L) / 12;

  result.supportDisplay.forEach(d => {
    const m = d.left !== null ? d.left : d.right;
    assert.ok(approxEqual(m, expectedM, 0.05), `support moment ${m} vs ${expectedM}`);
  });
  assert.ok(approxEqual(result.reactions[0], (w * L) / 2, 0.05));
  assert.ok(approxEqual(result.reactions[1], w * L, 0.05));
  assert.ok(approxEqual(result.reactions[2], (w * L) / 2, 0.05));
});

test('continuous, fixed interior support decouples into two independent fixed-fixed spans', () => {
  // Both outer ends AND the interior support fixed -> each span behaves
  // exactly like the standalone single-span "fixed" beam type, independently.
  const { api } = createApp({
    beamType: { value: 'continuous' },
    span1Length: { value: '8' },
    span2Length: { value: '12' },
    leftEndSupport: { value: 'fixed' },
    rightEndSupport: { value: 'fixed' },
    interiorSupport1: { value: 'fixed' },
  });
  const { loads, calculateContinuousBeam } = api;

  loads.push({ type: 'point', magnitude: 30, position: 3 }); // span0 only
  loads.push({ type: 'udl', magnitude: 6, start: 8, end: 20 }); // span1 only (full UDL)

  const result = calculateContinuousBeam();

  const L1 = 8, P = 30, a = 3, b = L1 - a;
  const Ma0 = -(P * a * b * b) / (L1 * L1);
  const Mb0 = -(P * b * a * a) / (L1 * L1);

  const L2 = 12, w = 6;
  const Ma1 = -(w * L2 * L2) / 12;

  assert.ok(approxEqual(result.spanMomentsLeft[0], Ma0, 0.05));
  assert.ok(approxEqual(result.spanMomentsRight[0], Mb0, 0.05));
  assert.ok(approxEqual(result.spanMomentsLeft[1], Ma1, 0.05));
  assert.ok(approxEqual(result.spanMomentsRight[1], Ma1, 0.05));
  assert.equal(result.supportDisplay[1].split, true);

  const total = result.reactions.reduce((sum, r) => sum + r, 0);
  assert.ok(approxEqual(total, P + w * L2, 0.05));
});

test('continuous: UDL crossing a span boundary is split (not dropped) and total weight is preserved', () => {
  const { api } = createApp({
    beamType: { value: 'continuous' },
    span1Length: { value: '10' },
    span2Length: { value: '10' },
  });
  const { assignLoadsToSpans, getSpanBoundaries } = api;

  const boundaries = getSpanBoundaries();
  const load = { type: 'udl', magnitude: 4, start: 7, end: 13 }; // crosses x=10
  const spanLoads = assignLoadsToSpans([load], boundaries);

  const totalAssigned = spanLoads.reduce(
    (sum, spanLoad) => sum + spanLoad.reduce((s, l) => s + l.magnitude * (l.end - l.start), 0),
    0
  );
  assert.ok(approxEqual(totalAssigned, 4 * (13 - 7), 1e-6), 'no load lost or duplicated across the boundary');
  assert.equal(spanLoads[0].length, 1);
  assert.equal(spanLoads[1].length, 1);
});
