'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, approxEqual } = require('./helpers');

test('moving point load: envelope matches the classic M(x) = P.x.(L-x)/L formula', () => {
  const { api } = createApp({
    beamType: { value: 'simply' },
    beamLength: { value: '10' },
    movingLoadEnabled: { checked: true },
    movingLoadType: { value: 'point' },
    movingLoadMagnitude: { value: '20' },
  });
  const { loads, sweepMovingLoadEnvelope } = api;

  const P = 20, L = 10;
  loads.length = 0;
  const envelope = sweepMovingLoadEnvelope();

  let maxError = 0;
  envelope.xVals.forEach((x, i) => {
    const expected = (P * x * (L - x)) / L;
    maxError = Math.max(maxError, Math.abs(envelope.momentMax[i] - expected));
  });

  assert.ok(maxError < 0.15, `max deviation from closed-form envelope was ${maxError}`);
  assert.ok(approxEqual(envelope.shearMin[envelope.shearMin.length - 1], -P, 0.5));
});

test('moving load combined with a static UDL: envelope exceeds the static-only bending moment', () => {
  const { api } = createApp({
    beamType: { value: 'simply' },
    beamLength: { value: '10' },
    movingLoadEnabled: { checked: true },
    movingLoadMagnitude: { value: '20' },
  });
  const { loads, sweepMovingLoadEnvelope } = api;

  loads.length = 0;
  loads.push({ type: 'udl', magnitude: 5, start: 0, end: 10 });
  const envelope = sweepMovingLoadEnvelope();

  const midIdx = Math.round((envelope.xVals.length - 1) / 2);
  const staticOnlyMidMoment = (5 * 10 * 10) / 8; // wL^2/8 = 62.5
  assert.ok(envelope.momentMax[midIdx] > staticOnlyMidMoment, 'moving load must add to, not replace, the static effect');
});

test('moving UDL crossing a continuous-beam span boundary balances exactly', () => {
  const { api } = createApp({
    beamType: { value: 'continuous' },
    span1Length: { value: '10' },
    span2Length: { value: '10' },
    movingLoadEnabled: { checked: true },
    movingLoadType: { value: 'udl' },
    movingLoadMagnitude: { value: '4' },
    movingLoadLength: { value: '6' },
  });
  const { loads, calculateWithMovingLoadAt } = api;

  loads.length = 0;
  const result = calculateWithMovingLoadAt(7); // patch spans [7, 13], crossing x=10
  const totalReaction = result.reactions.reduce((a, b) => a + b, 0);
  const totalLoad = 4 * 6;

  assert.ok(approxEqual(totalReaction, totalLoad, 1e-6), `reactions summed to ${totalReaction}, expected ${totalLoad}`);
});

test('buildMovingLoad: UDL patch shrinks (does not vanish) as it runs off either end of the beam', () => {
  const { api } = createApp({
    beamType: { value: 'simply' },
    beamLength: { value: '10' },
    movingLoadType: { value: 'udl' },
    movingLoadLength: { value: '4' },
  });
  const { buildMovingLoad } = api;

  const nearRightEdge = buildMovingLoad(9); // would extend to 13, clamped to 10
  assert.equal(nearRightEdge.start, 9);
  assert.equal(nearRightEdge.end, 10);

  const pastRightEdge = buildMovingLoad(10);
  assert.equal(pastRightEdge.start, 10);
  assert.equal(pastRightEdge.end, 10);
});
