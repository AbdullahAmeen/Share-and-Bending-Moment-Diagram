'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, approxEqual } = require('./helpers');

test('simply supported: point load reactions and max moment match textbook formulas', () => {
  const { api } = createApp({ beamLength: { value: '10' } });
  const { loads, calculateBeam } = api;

  const P = 20;
  const a = 4;
  const L = 10;
  loads.push({ type: 'point', magnitude: P, position: a });

  const result = calculateBeam();
  const Ra = (P * (L - a)) / L;
  const Rb = (P * a) / L;
  const Mmax = (P * a * (L - a)) / L;

  assert.ok(approxEqual(result.leftReaction, Ra), `leftReaction ${result.leftReaction} vs ${Ra}`);
  assert.ok(approxEqual(result.rightReaction, Rb), `rightReaction ${result.rightReaction} vs ${Rb}`);
  assert.ok(approxEqual(Math.max(...result.momentVals), Mmax, 0.05), `maxMoment vs ${Mmax}`);
});

test('simply supported: full-span UDL reactions split evenly and max moment is wL^2/8', () => {
  const { api } = createApp({ beamLength: { value: '10' } });
  const { loads, calculateBeam } = api;

  const w = 5;
  const L = 10;
  loads.push({ type: 'udl', magnitude: w, start: 0, end: L });

  const result = calculateBeam();
  const expectedReaction = (w * L) / 2;
  const expectedMoment = (w * L * L) / 8;

  assert.ok(approxEqual(result.leftReaction, expectedReaction));
  assert.ok(approxEqual(result.rightReaction, expectedReaction));
  assert.ok(approxEqual(Math.max(...result.momentVals), expectedMoment, 0.05));
});

test('simply supported: empty beam has zero reactions and zero moment everywhere', () => {
  const { api } = createApp();
  const { calculateBeam } = api;
  const result = calculateBeam();

  assert.equal(result.leftReaction, 0);
  assert.equal(result.rightReaction, 0);
  assert.ok(result.momentVals.every(m => m === 0));
});
