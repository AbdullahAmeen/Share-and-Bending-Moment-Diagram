'use strict';

// Loads js/script.js into a sandboxed function scope with a minimal DOM stub,
// so the beam-physics functions it defines can be called and asserted on
// directly from plain Node - no browser, no build step, matching how the
// rest of this project runs (a single script tag, no bundler).

const fs = require('fs');
const path = require('path');

const SCRIPT_PATH = path.join(__dirname, '..', 'js', 'script.js');
const SCRIPT_SOURCE = fs.readFileSync(SCRIPT_PATH, 'utf8');

// Everything a test might want to call or inspect. Pulling these out via a
// trailing `return { ... }` is how we get access to script.js's top-level
// consts/functions without turning the app itself into a module.
const EXPORTED_NAMES = [
  'loads',
  'calculateBeam',
  'computeSimplySupported',
  'calculateContinuousBeam',
  'solveSupportMoments',
  'solveChainedSupportMoments',
  'assignLoadsToSpans',
  'getSpanBoundaries',
  'getSpanLengths',
  'getTotalLength',
  'computeDeflection',
  'findExtremum',
  'sweepMovingLoadEnvelope',
  'calculateWithMovingLoadAt',
  'buildMovingLoad',
  'clamp',
];

function makeFakeCanvasContext() {
  // Any property access returns a no-op function; covers every ctx.* call
  // (fillRect, moveTo, arc, fillText, ...) the diagram renderers make.
  return new Proxy(function () {}, {
    get() { return () => makeFakeCanvasContext(); },
    apply() { return makeFakeCanvasContext(); },
  });
}

function makeElement(overrides = {}) {
  return Object.assign(
    {
      value: '',
      style: {},
      checked: false,
      classList: { add() {}, remove() {}, contains() { return false; } },
      addEventListener() {},
      innerHTML: '',
      innerText: '',
      getBoundingClientRect() { return { width: 800 }; },
      getContext() { return makeFakeCanvasContext(); },
      options: [{ text: 'x' }],
      selectedIndex: 0,
      querySelectorAll() { return []; },
    },
    overrides
  );
}

// Every #id script.js looks up via document.getElementById, with the values
// a fresh page loads with. Override any of these per-test via createApp().
const DEFAULT_ELEMENTS = {
  beamType: { value: 'simply' },
  beamLength: { value: '10' },
  beamLengthGroup: {},
  loadType: { value: 'point' },
  magnitude: { value: '20' },
  position: {},
  endPosition: {},
  endPositionGroup: {},
  loadList: {},
  numSpans: { value: '2' },
  numSpansGroup: {},
  spanLengthsGroup: {},
  span1Length: { value: '5' },
  span2Length: { value: '5' },
  span3Length: { value: '5' },
  endSupportsGroup: {},
  leftEndSupport: { value: 'simple' },
  rightEndSupport: { value: 'simple' },
  interiorSupportsGroup: {},
  interiorSupport1: { value: 'simple' },
  interiorSupport2: { value: 'simple' },
  beamEI: { value: '50000' },
  supportReactionsPanel: {},
  movingLoadEnabled: { checked: false },
  movingLoadTypeGroup: {},
  movingLoadType: { value: 'point' },
  movingLoadMagnitudeGroup: {},
  movingLoadMagnitude: { value: '15' },
  movingLoadMagnitudeLabel: {},
  movingLoadLengthGroup: {},
  movingLoadLength: { value: '2' },
  movingLoadPositionGroup: {},
  movingLoadPosition: { value: '0', max: '10' },
  movingLoadPositionLabel: {},
  movingLoadPlayGroup: {},
  movingLoadPlayButton: {},
  movingLoadHint: {},
  addLoadButton: {},
  resetButton: {},
  beamLayoutCanvas: {},
  printButton: {},
  calcStepsSection: {},
  calcStepsContent: {},
  printReportMeta: {},
  customAlert: {},
};

// Creates one fresh, isolated instance of the app's calculation functions.
// `overrides` is a map of element-id -> partial element props, e.g.
// { beamType: { value: 'continuous' }, span1Length: { value: '10' } }.
function createApp(overrides = {}) {
  const elements = {};
  Object.keys(DEFAULT_ELEMENTS).forEach(id => {
    elements[id] = makeElement({ ...DEFAULT_ELEMENTS[id], ...(overrides[id] || {}) });
  });

  const document = {
    getElementById(id) { return elements[id] || makeElement(); },
    addEventListener() {},
    querySelector() { return { innerText: '' }; },
  };
  const window = { addEventListener() {}, devicePixelRatio: 1, print() {} };
  function Chart() { this.destroy = () => {}; }
  const navigator = {};

  const loadApp = new Function(
    'document', 'window', 'Chart', 'navigator',
    `${SCRIPT_SOURCE}\nreturn { ${EXPORTED_NAMES.join(', ')} };`
  );

  const api = loadApp(document, window, Chart, navigator);
  return { api, elements };
}

function approxEqual(actual, expected, tolerance = 1e-3) {
  return Math.abs(actual - expected) < tolerance;
}

module.exports = { createApp, approxEqual };
