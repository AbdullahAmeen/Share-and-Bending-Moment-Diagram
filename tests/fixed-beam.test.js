'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, approxEqual } = require('./helpers');

test('fixed-fixed: point load at midspan gives Ra=Rb=P/2 and Ma=Mb=-P*L/8', () => {
  const { api } = createApp({ beamType: { value: 'fixed' }, beamLength: { value: '10' } });
  const { loads, calculateBeam } = api;

  const P = 20;
  const L = 10;
  loads.push({ type: 'point', magnitude: P, position: L / 2 });

  const result = calculateBeam();
  assert.ok(approxEqual(result.leftReaction, P / 2));
  assert.ok(approxEqual(result.rightReaction, P / 2));
  assert.ok(approxEqual(result.momentVals[0], -(P * L) / 8));
  assert.ok(approxEqual(result.momentVals[result.momentVals.length - 1], -(P * L) / 8));
});

test('fixed-fixed: full-span UDL gives Ra=Rb=wL/2 and Ma=Mb=-wL^2/12', () => {
  const { api } = createApp({ beamType: { value: 'fixed' }, beamLength: { value: '10' } });
  const { loads, calculateBeam } = api;

  const w = 6;
  const L = 10;
  loads.push({ type: 'udl', magnitude: w, start: 0, end: L });

  const result = calculateBeam();
  assert.ok(approxEqual(result.leftReaction, (w * L) / 2));
  assert.ok(approxEqual(result.rightReaction, (w * L) / 2));
  assert.ok(approxEqual(result.momentVals[0], -(w * L * L) / 12));
  assert.ok(approxEqual(result.momentVals[result.momentVals.length - 1], -(w * L * L) / 12));
});
