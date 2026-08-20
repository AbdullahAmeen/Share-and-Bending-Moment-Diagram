'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createApp, approxEqual } = require('./helpers');

const EI = 50000;

test('simply supported: point load at midspan gives delta_max = P.L^3 / (48.EI)', () => {
  const { api } = createApp({ beamLength: { value: '10' }, beamEI: { value: String(EI) } });
  const { loads, calculateBeam, computeDeflection, findExtremum } = api;

  const P = 20, L = 10;
  loads.push({ type: 'point', magnitude: P, position: L / 2 });

  const result = calculateBeam();
  const deflection = computeDeflection(result);
  const maxDeflection = findExtremum(result.xVals, deflection);
  const expected = (P * L ** 3) / (48 * EI);

  assert.ok(approxEqual(Math.abs(maxDeflection.value), expected, expected * 0.02));
  assert.ok(approxEqual(maxDeflection.x, L / 2, 0.3));
});

test('simply supported: full-span UDL gives delta_max = 5.w.L^4 / (384.EI)', () => {
  const { api } = createApp({ beamLength: { value: '10' }, beamEI: { value: String(EI) } });
  const { loads, calculateBeam, computeDeflection } = api;

  const w = 4, L = 10;
  loads.push({ type: 'udl', magnitude: w, start: 0, end: L });

  const result = calculateBeam();
  const deflection = computeDeflection(result);
  const expected = (5 * w * L ** 4) / (384 * EI);

  assert.ok(approxEqual(Math.max(...deflection.map(Math.abs)), expected, expected * 0.02));
});

test('cantilever: point load at the free end gives tip deflection P.L^3 / (3.EI)', () => {
  const { api } = createApp({ beamType: { value: 'cantilever' }, beamLength: { value: '10' }, beamEI: { value: String(EI) } });
  const { loads, calculateBeam, computeDeflection } = api;

  const P = 10, L = 10;
  loads.push({ type: 'point', magnitude: P, position: L });

  const result = calculateBeam();
  const deflection = computeDeflection(result);
  const expected = (P * L ** 3) / (3 * EI);

  assert.equal(deflection[0], 0, 'no deflection at the fixed end');
  assert.ok(approxEqual(Math.abs(deflection[deflection.length - 1]), expected, expected * 0.02));
});

test('fixed-fixed: full-span UDL gives delta_max = w.L^4 / (384.EI) and zero deflection at both ends', () => {
  const { api } = createApp({ beamType: { value: 'fixed' }, beamLength: { value: '10' }, beamEI: { value: String(EI) } });
  const { loads, calculateBeam, computeDeflection } = api;

  const w = 6, L = 10;
  loads.push({ type: 'udl', magnitude: w, start: 0, end: L });

  const result = calculateBeam();
  const deflection = computeDeflection(result);
  const expected = (w * L ** 4) / (384 * EI);

  assert.equal(deflection[0], 0);
  assert.equal(deflection[deflection.length - 1], 0);
  assert.ok(approxEqual(Math.max(...deflection.map(Math.abs)), expected, expected * 0.02));
});

test('continuous, 2 equal symmetric spans: deflection is zero at every support and symmetric between spans', () => {
  const { api } = createApp({
    beamType: { value: 'continuous' },
    span1Length: { value: '10' },
    span2Length: { value: '10' },
    beamEI: { value: String(EI) },
  });
  const { loads, calculateContinuousBeam, computeDeflection } = api;

  loads.push({ type: 'udl', magnitude: 10, start: 0, end: 10 });
  loads.push({ type: 'udl', magnitude: 10, start: 10, end: 20 });

  const result = calculateContinuousBeam();
  const deflection = computeDeflection(result);
  const pointsPerSpan = 81;

  assert.ok(approxEqual(deflection[0], 0, 1e-6), 'left end support');
  assert.ok(approxEqual(deflection[pointsPerSpan - 1], 0, 1e-6), 'interior support');
  assert.ok(approxEqual(deflection[deflection.length - 1], 0, 1e-6), 'right end support');

  const midSpan0 = deflection[Math.round((pointsPerSpan - 1) / 2)];
  const midSpan1 = deflection[pointsPerSpan + Math.round((pointsPerSpan - 1) / 2)];
  assert.ok(approxEqual(midSpan0, midSpan1, 1e-6), 'symmetric spans must deflect equally at their midpoints');
});
