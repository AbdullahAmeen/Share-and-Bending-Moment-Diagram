'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, approxEqual } = require('./helpers');

test('cantilever: point load at the tip gives R=P and fixed-end moment M=-P*L', () => {
  const { api } = createApp({ beamType: { value: 'cantilever' }, beamLength: { value: '8' } });
  const { loads, calculateBeam } = api;

  const P = 10;
  const L = 8;
  loads.push({ type: 'point', magnitude: P, position: L });

  const result = calculateBeam();
  assert.ok(approxEqual(result.leftReaction, P));
  assert.ok(approxEqual(result.momentVals[0], -P * L));
});

test('cantilever: full-span UDL gives R=wL and fixed-end moment M=-wL^2/2', () => {
  const { api } = createApp({ beamType: { value: 'cantilever' }, beamLength: { value: '6' } });
  const { loads, calculateBeam } = api;

  const w = 4;
  const L = 6;
  loads.push({ type: 'udl', magnitude: w, start: 0, end: L });

  const result = calculateBeam();
  assert.ok(approxEqual(result.leftReaction, w * L));
  assert.ok(approxEqual(result.momentVals[0], -(w * L * L) / 2));
});
