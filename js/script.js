const loads = [];
let sfdChart = null;
let bmdChart = null;
let deflectionChart = null;
let printMode = false;

const beamType = document.getElementById('beamType');
const beamLength = document.getElementById('beamLength');
const beamLengthGroup = document.getElementById('beamLengthGroup');
const loadType = document.getElementById('loadType');
const magnitude = document.getElementById('magnitude');
const position = document.getElementById('position');
const endPosition = document.getElementById('endPosition');
const endPositionGroup = document.getElementById('endPositionGroup');
const loadList = document.getElementById('loadList');

const numSpans = document.getElementById('numSpans');
const numSpansGroup = document.getElementById('numSpansGroup');
const spanLengthsGroup = document.getElementById('spanLengthsGroup');
const span1Length = document.getElementById('span1Length');
const span2Length = document.getElementById('span2Length');
const span3Length = document.getElementById('span3Length');
const endSupportsGroup = document.getElementById('endSupportsGroup');
const leftEndSupport = document.getElementById('leftEndSupport');
const rightEndSupport = document.getElementById('rightEndSupport');
const interiorSupportsGroup = document.getElementById('interiorSupportsGroup');
const interiorSupport1 = document.getElementById('interiorSupport1');
const interiorSupport2 = document.getElementById('interiorSupport2');
const beamEI = document.getElementById('beamEI');
const supportReactionsPanel = document.getElementById('supportReactionsPanel');

const movingLoadEnabled = document.getElementById('movingLoadEnabled');
const movingLoadTypeGroup = document.getElementById('movingLoadTypeGroup');
const movingLoadType = document.getElementById('movingLoadType');
const movingLoadMagnitudeGroup = document.getElementById('movingLoadMagnitudeGroup');
const movingLoadMagnitude = document.getElementById('movingLoadMagnitude');
const movingLoadMagnitudeLabel = document.getElementById('movingLoadMagnitudeLabel');
const movingLoadLengthGroup = document.getElementById('movingLoadLengthGroup');
const movingLoadLength = document.getElementById('movingLoadLength');
const movingLoadPositionGroup = document.getElementById('movingLoadPositionGroup');
const movingLoadPosition = document.getElementById('movingLoadPosition');
const movingLoadPositionLabel = document.getElementById('movingLoadPositionLabel');
const movingLoadPlayGroup = document.getElementById('movingLoadPlayGroup');
const movingLoadPlayButton = document.getElementById('movingLoadPlayButton');
const movingLoadHint = document.getElementById('movingLoadHint');

let lastEnvelope = null;
let movingLoadAnimHandle = null;
let movingLoadDirection = 1;

const addLoadButton = document.getElementById('addLoadButton');
const resetButton = document.getElementById('resetButton');
const beamLayoutCanvas = document.getElementById('beamLayoutCanvas');
const printButton = document.getElementById('printButton');
const calcStepsSection = document.getElementById('calcStepsSection');
const calcStepsContent = document.getElementById('calcStepsContent');
const printReportMeta = document.getElementById('printReportMeta');

// Custom Alert Function
function showCustomAlert(message, title = 'Alert') {
  const alertElement = document.getElementById('customAlert');
  if (alertElement) {
    document.getElementById('alertTitle').textContent = title;
    document.getElementById('alertMessage').textContent = message;
    alertElement.classList.add('show');
  }
}

function closeCustomAlert() {
  const alertElement = document.getElementById('customAlert');
  if (alertElement) {
    alertElement.classList.remove('show');
  }
}

// Setup alert event listener after DOM is ready
document.addEventListener('DOMContentLoaded', function() {
  const customAlertOverlay = document.getElementById('customAlert');
  if (customAlertOverlay) {
    customAlertOverlay.addEventListener('click', function(e) {
      if (e.target === this) {
        closeCustomAlert();
      }
    });
  }
});

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function formatNumber(value) {
  return Number(value).toFixed(2);
}

function getSpanLengths() {
  const count = parseInt(numSpans.value, 10) || 2;
  const lengths = [parseFloat(span1Length.value) || 5, parseFloat(span2Length.value) || 5];
  if (count === 3) lengths.push(parseFloat(span3Length.value) || 5);
  return lengths;
}

function getTotalLength() {
  if (beamType.value === 'continuous') {
    return getSpanLengths().reduce((sum, l) => sum + l, 0);
  }
  return parseFloat(beamLength.value) || 10;
}

function getSpanBoundaries() {
  const lengths = getSpanLengths();
  const boundaries = [0];
  lengths.forEach(l => boundaries.push(boundaries[boundaries.length - 1] + l));
  return boundaries;
}

// One entry per interior support (support index 1..n-1): true if that support
// is a rigid, rotation-restrained fixed support rather than a simple/roller one.
function getInteriorFixedFlags() {
  const count = parseInt(numSpans.value, 10) || 2;
  const flags = [interiorSupport1.value === 'fixed'];
  if (count === 3) flags.push(interiorSupport2.value === 'fixed');
  return flags;
}

function getMovingLoadMagnitude() {
  return parseFloat(movingLoadMagnitude.value) || 0;
}

function getMovingLoadLength() {
  return parseFloat(movingLoadLength.value) || 0.1;
}

// Describes the moving load at a given reference position: for a point load,
// `position` is its location; for a UDL, `position` is the patch's leading
// (left) edge and `start`/`end` are its clamped extent - the patch shrinks
// as it runs off either end of the beam, rather than jumping in/out abruptly.
function buildMovingLoad(position) {
  const magnitude = getMovingLoadMagnitude();
  if (movingLoadType.value === 'udl') {
    const total = getTotalLength();
    const start = clamp(position, 0, total);
    const end = clamp(position + getMovingLoadLength(), 0, total);
    return { type: 'udl', magnitude, position, start, end };
  }
  return { type: 'point', magnitude, position };
}

function calculateCurrent() {
  return beamType.value === 'continuous' ? calculateContinuousBeam() : calculateBeam();
}

// Temporarily adds the moving load to the static load list, runs the normal
// solver, then removes it - reuses the existing per-type physics untouched
// instead of duplicating it for a "load at position x" case.
function calculateWithMovingLoadAt(position) {
  const movingLoad = buildMovingLoad(position);
  if (movingLoad.type === 'udl') {
    loads.push({ type: 'udl', magnitude: movingLoad.magnitude, start: movingLoad.start, end: movingLoad.end });
  } else {
    loads.push({ type: 'point', magnitude: movingLoad.magnitude, position: movingLoad.position });
  }
  try {
    return calculateCurrent();
  } finally {
    loads.pop();
  }
}

// Sweeps the moving load across the whole span, combined with whatever static
// loads are already present, and records the worst-case (max/min) shear and
// moment at every section - the standard "envelope" diagram for moving-load
// analysis, i.e. the automatically-drawn diagrams the live load produces.
const MOVING_LOAD_SWEEP_STEPS = 161;

function sweepMovingLoadEnvelope() {
  const total = getTotalLength();
  const sweepSteps = MOVING_LOAD_SWEEP_STEPS;
  let envelope = null;

  for (let i = 0; i < sweepSteps; i += 1) {
    const pos = (i * total) / (sweepSteps - 1);
    const result = calculateWithMovingLoadAt(pos);

    if (!envelope) {
      envelope = {
        xVals: result.xVals,
        shearMax: result.shearVals.slice(),
        shearMin: result.shearVals.slice(),
        momentMax: result.momentVals.slice(),
        momentMin: result.momentVals.slice(),
      };
    } else {
      for (let k = 0; k < result.shearVals.length; k += 1) {
        if (result.shearVals[k] > envelope.shearMax[k]) envelope.shearMax[k] = result.shearVals[k];
        if (result.shearVals[k] < envelope.shearMin[k]) envelope.shearMin[k] = result.shearVals[k];
        if (result.momentVals[k] > envelope.momentMax[k]) envelope.momentMax[k] = result.momentVals[k];
        if (result.momentVals[k] < envelope.momentMin[k]) envelope.momentMin[k] = result.momentVals[k];
      }
    }
  }

  return envelope;
}

function updateMovingLoadPositionLabel() {
  movingLoadPositionLabel.innerText = `${formatNumber(parseFloat(movingLoadPosition.value) || 0)} m`;
}

function syncMovingLoadSliderRange() {
  const total = getTotalLength();
  movingLoadPosition.max = total;
  if (parseFloat(movingLoadPosition.value) > total) {
    movingLoadPosition.value = total;
  }
  updateMovingLoadPositionLabel();
}

function startMovingLoadAnimation() {
  if (movingLoadAnimHandle) return;
  movingLoadPlayButton.innerText = 'Pause';
  movingLoadAnimHandle = setInterval(() => {
    const total = getTotalLength();
    const step = total / 60;
    let pos = (parseFloat(movingLoadPosition.value) || 0) + movingLoadDirection * step;
    if (pos >= total) { pos = total; movingLoadDirection = -1; }
    else if (pos <= 0) { pos = 0; movingLoadDirection = 1; }
    movingLoadPosition.value = pos;
    updateMovingLoadPositionLabel();
    renderMovingLoadFrame();
  }, 60);
}

function stopMovingLoadAnimation() {
  if (movingLoadAnimHandle) {
    clearInterval(movingLoadAnimHandle);
    movingLoadAnimHandle = null;
  }
  movingLoadPlayButton.innerText = 'Play';
}

loadType.addEventListener('change', () => {
  const isUDL = loadType.value === 'udl';
  endPositionGroup.style.display = isUDL ? 'block' : 'none';
  document.querySelector('#positionGroup label').innerText = isUDL ? 'Start Position (m)' : 'Position (m)';
});

function updateBeamTypeUI() {
  const isContinuous = beamType.value === 'continuous';
  beamLengthGroup.style.display = isContinuous ? 'none' : 'flex';
  numSpansGroup.style.display = isContinuous ? 'flex' : 'none';
  spanLengthsGroup.style.display = isContinuous ? 'flex' : 'none';
  endSupportsGroup.style.display = isContinuous ? 'flex' : 'none';
  interiorSupportsGroup.style.display = isContinuous ? 'flex' : 'none';
}

beamType.addEventListener('change', () => {
  updateBeamTypeUI();
  renderBeam();
});

numSpans.addEventListener('change', () => {
  const isThreeSpans = numSpans.value === '3';
  span3Length.style.display = isThreeSpans ? 'block' : 'none';
  interiorSupport2.style.display = isThreeSpans ? 'block' : 'none';
  renderBeam();
});

span1Length.addEventListener('change', renderBeam);
span2Length.addEventListener('change', renderBeam);
span3Length.addEventListener('change', renderBeam);
leftEndSupport.addEventListener('change', renderBeam);
rightEndSupport.addEventListener('change', renderBeam);
interiorSupport1.addEventListener('change', renderBeam);
interiorSupport2.addEventListener('change', renderBeam);
beamEI.addEventListener('change', renderBeam);

beamLength.addEventListener('change', renderBeam);
addLoadButton.addEventListener('click', addLoad);
resetButton.addEventListener('click', resetAll);
printButton.addEventListener('click', printReport);

function updateMovingLoadUI() {
  const enabled = movingLoadEnabled.checked;
  movingLoadTypeGroup.style.display = enabled ? 'flex' : 'none';
  movingLoadMagnitudeGroup.style.display = enabled ? 'flex' : 'none';
  movingLoadPositionGroup.style.display = enabled ? 'flex' : 'none';
  movingLoadPlayGroup.style.display = enabled ? 'block' : 'none';
  movingLoadHint.style.display = enabled ? 'block' : 'none';

  const isUDL = movingLoadType.value === 'udl';
  movingLoadLengthGroup.style.display = enabled && isUDL ? 'flex' : 'none';
  movingLoadMagnitudeLabel.innerText = isUDL ? 'Magnitude (kN/m)' : 'Magnitude (kN)';
}

movingLoadEnabled.addEventListener('change', () => {
  updateMovingLoadUI();
  if (!movingLoadEnabled.checked) stopMovingLoadAnimation();
  renderBeam();
});
movingLoadType.addEventListener('change', () => {
  updateMovingLoadUI();
  renderBeam();
});
movingLoadMagnitude.addEventListener('change', renderBeam);
movingLoadLength.addEventListener('change', renderBeam);
movingLoadPosition.addEventListener('input', () => {
  stopMovingLoadAnimation();
  updateMovingLoadPositionLabel();
  renderMovingLoadFrame();
});
movingLoadPlayButton.addEventListener('click', () => {
  if (movingLoadAnimHandle) stopMovingLoadAnimation();
  else startMovingLoadAnimation();
});

window.addEventListener('beforeprint', () => {
  printMode = true;
  renderBeam();
});

window.addEventListener('afterprint', () => {
  printMode = false;
  calcStepsSection.classList.remove('show');
  renderBeam();
});

function addLoad() {
  const type = loadType.value;
  const mag = parseFloat(magnitude.value);
  const pos = parseFloat(position.value);
  const len = getTotalLength();
  const endPos = parseFloat(endPosition.value);

  if (Number.isNaN(mag) || mag <= 0) {
    showCustomAlert('Enter a valid load magnitude.', 'Validation Error');
    return;
  }

  if (Number.isNaN(pos) || pos < 0 || pos > len) {
    showCustomAlert('Enter a valid position within the beam length.', 'Validation Error');
    return;
  }

  if (type === 'udl') {
    if (Number.isNaN(endPos) || endPos <= pos || endPos > len) {
      showCustomAlert('Enter a valid end position greater than the start position.', 'Validation Error');
      return;
    }

    if (beamType.value === 'continuous') {
      const boundaries = getSpanBoundaries();
      const crossesSupport = boundaries.some(b => b > pos + 1e-9 && b < endPos - 1e-9);
      if (crossesSupport) {
        showCustomAlert('A distributed load on a continuous beam must stay within a single span - it cannot cross an intermediate support.', 'Validation Error');
        return;
      }
    }

    loads.push({ type, magnitude: mag, start: pos, end: endPos });
  } else {
    loads.push({ type, magnitude: mag, position: pos });
  }

  position.value = '';
  endPosition.value = '';
  renderLoads();
  renderBeam();
}

function renderLoads() {
  if (loads.length === 0) {
    loadList.innerHTML = '<p class="empty-state">No loads added yet.</p>';
    return;
  }

  loadList.innerHTML = loads
    .map((load, index) => {
      if (load.type === 'udl') {
        return `
          <div class="load-item">
            <span>${index + 1}. UDL ${formatNumber(load.magnitude)} kN/m from ${formatNumber(load.start)} to ${formatNumber(load.end)} m</span>
            <button type="button" data-index="${index}" class="remove-load">Remove</button>
          </div>
        `;
      } 

      return `
        <div class="load-item">
          <span>${index + 1}. Point load ${formatNumber(load.magnitude)} kN at ${formatNumber(load.position)} m</span>
          <button type="button" data-index="${index}" class="remove-load">Remove</button> 
        </div>
      `;
    })
    .join('');

  loadList.querySelectorAll('.remove-load').forEach(button => {
    button.addEventListener('click', () => {
      loads.splice(Number(button.dataset.index), 1);
      renderLoads();
      renderBeam();
    });
  });
}

function calculateBeam() {
  const length = parseFloat(beamLength.value) || 10;
  const steps = 81;
  const xVals = Array.from({ length: steps }, (_, i) => Number(((i * length) / (steps - 1)).toFixed(2)));
  const shearVals = Array(steps).fill(0);
  const momentVals = Array(steps).fill(0);
  let leftReaction = 0;
  let rightReaction = 0;

  if (loads.length === 0) {
    return { xVals, shearVals, momentVals, leftReaction, rightReaction };
  }

  if (beamType.value === 'cantilever') {
    loads.forEach(load => {
      if (load.type === 'point') {
        const P = load.magnitude;
        const a = clamp(load.position, 0, length);
        leftReaction += P;
        for (let i = 0; i < steps; i += 1) {
          const x = xVals[i];
          if (x <= a) {
            shearVals[i] += P;
            momentVals[i] += -P * (a - x);
          }
        }
      } else {
        const w = load.magnitude;
        const a = clamp(load.start, 0, length);
        const b = clamp(load.end, a, length);
        const totalW = w * (b - a);
        const centroid = (a + b) / 2;
        leftReaction += totalW;
        for (let i = 0; i < steps; i += 1) {
          const x = xVals[i];
          if (x <= a) {
            shearVals[i] += totalW;
            momentVals[i] += -totalW * (centroid - x);
          } else if (x <= b) {
            const remaining = b - x;
            shearVals[i] += w * remaining;
            momentVals[i] += -w * remaining * remaining / 2;
          }
        }
      }
    });
  } else if (beamType.value === 'fixed') {
    loads.forEach(load => {
      if (load.type === 'point') {
        const P = load.magnitude;
        const a = clamp(load.position, 0, length);
        const b = length - a;
        const Ra = P * b * b * (length + 2 * a) / (length * length * length);
        const Rb = P * a * a * (3 * length - 2 * a) / (length * length * length);
        const Ma = -P * a * b * b / (length * length);
        const Mb = -P * b * a * a / (length * length);
        leftReaction += Ra;
        rightReaction += Rb;

        for (let i = 0; i < steps; i += 1) {
          const x = xVals[i];
          if (x < a) {
            shearVals[i] += Ra;
            momentVals[i] += Ma + Ra * x;
          } else {
            shearVals[i] += Ra - P;
            momentVals[i] += Ma + Ra * x - P * (x - a);
          }
        }
      } else {
        const w = load.magnitude;
        const a = clamp(load.start, 0, length);
        const b = clamp(load.end, a, length);
        const totalW = w * (b - a);
        const a2 = a * a; const a3 = a2 * a; const a4 = a3 * a;
        const b2 = b * b; const b3 = b2 * b; const b4 = b3 * b;
        const L2 = length * length; const L3 = L2 * length;
        // Exact fixed-end reactions/moments for a partial-span UDL, obtained by
        // integrating the exact point-load solution over [a, b].
        const Ra = (w / L3) * (L3 * (b - a) - length * (b3 - a3) + (b4 - a4) / 2);
        const Rb = totalW - Ra;
        const Ma = -(w / L2) * ((L2 * (b2 - a2)) / 2 - (2 * length * (b3 - a3)) / 3 + (b4 - a4) / 4);
        const Mb = -(w / L2) * ((length * (b3 - a3)) / 3 - (b4 - a4) / 4);
        leftReaction += Ra;
        rightReaction += Rb;

        for (let i = 0; i < steps; i += 1) {
          const x = xVals[i];
          if (x < a) {
            shearVals[i] += Ra;
            momentVals[i] += Ma + Ra * x;
          } else if (x <= b) {
            const loadedLength = x - a;
            shearVals[i] += Ra - w * loadedLength;
            momentVals[i] += Ma + Ra * x - w * loadedLength * loadedLength / 2;
          } else {
            shearVals[i] += Ra - totalW;
            momentVals[i] += Ma + Ra * x - w * (b - a) * (x - (a + b) / 2);
          }
        }
      }
    });
  } else {
    const result = computeSimplySupported(loads, length, xVals);
    return { xVals, shearVals: result.shearVals, momentVals: result.momentVals, leftReaction: result.leftReaction, rightReaction: result.rightReaction };
  }

  return { xVals, shearVals, momentVals, leftReaction, rightReaction };
}

function computeSimplySupported(loadsList, length, xVals) {
  const steps = xVals.length;
  const shearVals = Array(steps).fill(0);
  const momentVals = Array(steps).fill(0);
  let leftReaction = 0;
  let rightReaction = 0;

  loadsList.forEach(load => {
    if (load.type === 'point') {
      const P = load.magnitude;
      const a = clamp(load.position, 0, length);
      const Ra = P * (length - a) / length;
      const Rb = P * a / length;
      leftReaction += Ra;
      rightReaction += Rb;

      for (let i = 0; i < steps; i += 1) {
        const x = xVals[i];
        if (x < a) {
          shearVals[i] += Ra;
          momentVals[i] += Ra * x;
        } else {
          shearVals[i] += Ra - P;
          momentVals[i] += Ra * x - P * (x - a);
        }
      }
    } else {
      const w = load.magnitude;
      const a = clamp(load.start, 0, length);
      const b = clamp(load.end, a, length);
      const totalW = w * (b - a);
      const centroid = (a + b) / 2;
      const Ra = totalW * (length - centroid) / length;
      const Rb = totalW * centroid / length;
      leftReaction += Ra;
      rightReaction += Rb;

      for (let i = 0; i < steps; i += 1) {
        const x = xVals[i];
        if (x < a) {
          shearVals[i] += Ra;
          momentVals[i] += Ra * x;
        } else if (x <= b) {
          const loadedLength = x - a;
          shearVals[i] += Ra - w * loadedLength;
          momentVals[i] += Ra * x - w * loadedLength * loadedLength / 2;
        } else {
          shearVals[i] += Ra - totalW;
          momentVals[i] += Ra * x - w * (b - a) * (b - a) / 2 - totalW * (x - b);
        }
      }
    }
  });

  return { shearVals, momentVals, leftReaction, rightReaction };
}

// Splits the global load list across spans (by absolute position) and returns
// each span's loads translated into that span's own local 0..L coordinates.
function assignLoadsToSpans(loadsList, boundaries) {
  const n = boundaries.length - 1;
  const spanLoads = Array.from({ length: n }, () => []);
  const eps = 1e-6;

  loadsList.forEach(load => {
    if (load.type === 'point') {
      for (let s = 0; s < n; s += 1) {
        if (load.position <= boundaries[s + 1] + eps || s === n - 1) {
          spanLoads[s].push({ type: 'point', magnitude: load.magnitude, position: clamp(load.position - boundaries[s], 0, boundaries[s + 1] - boundaries[s]) });
          break;
        }
      }
    } else {
      // A UDL that overlaps more than one span (only possible for the moving
      // load - static UDLs are validated at entry to stay within one span)
      // gets its own clipped portion pushed onto every span it touches.
      for (let s = 0; s < n; s += 1) {
        const overlapStart = Math.max(load.start, boundaries[s]);
        const overlapEnd = Math.min(load.end, boundaries[s + 1]);
        if (overlapEnd > overlapStart + eps) {
          spanLoads[s].push({ type: 'udl', magnitude: load.magnitude, start: overlapStart - boundaries[s], end: overlapEnd - boundaries[s] });
        }
      }
    }
  });

  return spanLoads;
}

// Numerically integrates the free (simply supported) moment diagram of a span
// to get its area (A) and first moment about the span's own left end (M1) -
// the two quantities the three-moment (Clapeyron) equation needs per span.
function integrateMomentDiagram(xLocal, momentFree) {
  // Composite Simpson's rule (exact for the quadratic/cubic moment diagrams
  // produced by point loads and UDLs) - needs an even number of intervals,
  // which the even pointsPerSpan-1 sampling in calculateContinuousBeam guarantees.
  const n = xLocal.length - 1;
  const h = (xLocal[n] - xLocal[0]) / n;
  const f = (i) => momentFree[i];
  const g = (i) => momentFree[i] * xLocal[i];

  let A = f(0) + f(n);
  let M1 = g(0) + g(n);
  for (let i = 1; i < n; i += 1) {
    const weight = i % 2 === 0 ? 2 : 4;
    A += weight * f(i);
    M1 += weight * g(i);
  }
  A *= h / 3;
  M1 *= h / 3;

  return { A, M1 };
}

// Solves for the bending moment at every support (0..n) using the three-moment
// (Clapeyron) theorem. Interior supports always get an equation (slope
// continuity between the two adjoining spans). A fixed end also gets an
// equation - modelled as an imaginary, unloaded, zero-length span beyond that
// end, which forces zero slope there without needing a separate formula.
function solveSupportMoments(spanLengths, spanFree, leftFixed, rightFixed) {
  const n = spanLengths.length;
  const unknownSupports = [];
  if (leftFixed) unknownSupports.push(0);
  for (let j = 1; j < n; j += 1) unknownSupports.push(j);
  if (rightFixed) unknownSupports.push(n);

  const supportMoments = Array(n + 1).fill(0);
  if (unknownSupports.length === 0) return supportMoments;

  const unknownIndexOf = new Map();
  unknownSupports.forEach((supportIdx, i) => unknownIndexOf.set(supportIdx, i));

  const size = unknownSupports.length;
  const coeff = Array.from({ length: size }, () => Array(size).fill(0));
  const rhs = Array(size).fill(0);

  unknownSupports.forEach((j, row) => {
    const hasLeftSpan = j > 0;
    const hasRightSpan = j < n;
    const Lleft = hasLeftSpan ? spanLengths[j - 1] : 0;
    const Lright = hasRightSpan ? spanLengths[j] : 0;
    const freeLeft = hasLeftSpan ? spanFree[j - 1] : { A: 0, M1: 0 };
    const freeRight = hasRightSpan ? spanFree[j] : { A: 0, M1: 0 };

    coeff[row][row] += 2 * (Lleft + Lright);
    if (unknownIndexOf.has(j - 1)) coeff[row][unknownIndexOf.get(j - 1)] += Lleft;
    if (unknownIndexOf.has(j + 1)) coeff[row][unknownIndexOf.get(j + 1)] += Lright;

    const leftTerm = Lleft === 0 ? 0 : freeLeft.M1 / Lleft;
    const rightTerm = Lright === 0 ? 0 : (freeRight.A * Lright - freeRight.M1) / Lright;
    rhs[row] = -6 * (leftTerm + rightTerm);
  });

  const solved = solveLinearSystem(coeff, rhs);
  unknownSupports.forEach((j, i) => { supportMoments[j] = solved[i]; });
  return supportMoments;
}

// Small Gaussian elimination solver - the continuous-beam system is at most 2x2 (3 spans).
function solveLinearSystem(matrix, rhs) {
  const n = rhs.length;
  const M = matrix.map(row => row.slice());
  const b = rhs.slice();

  for (let col = 0; col < n; col += 1) {
    let pivotRow = col;
    for (let r = col + 1; r < n; r += 1) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivotRow][col])) pivotRow = r;
    }
    [M[col], M[pivotRow]] = [M[pivotRow], M[col]];
    [b[col], b[pivotRow]] = [b[pivotRow], b[col]];

    for (let r = col + 1; r < n; r += 1) {
      const factor = M[r][col] / M[col][col];
      for (let c = col; c < n; c += 1) M[r][c] -= factor * M[col][c];
      b[r] -= factor * b[col];
    }
  }

  const x = Array(n).fill(0);
  for (let row = n - 1; row >= 0; row -= 1) {
    let sum = b[row];
    for (let c = row + 1; c < n; c += 1) sum -= M[row][c] * x[c];
    x[row] = sum / M[row][row];
  }
  return x;
}

// Splits the span sequence into independent chains wherever an interior
// support is fully fixed. A rigid interior support restrains rotation to
// zero on both sides independently, so slope continuity (and the
// three-moment equation linking the two spans that meet there) no longer
// applies across it - each side is solved as its own chain, using that
// support as a fixed end for whichever chain it terminates.
function solveChainedSupportMoments(spanLengths, spanFree, leftFixed, rightFixed, interiorFixedFlags) {
  const n = spanLengths.length;
  const splitPoints = [];
  interiorFixedFlags.forEach((isFixed, i) => { if (isFixed) splitPoints.push(i + 1); });

  const chainBoundaries = [0, ...splitPoints, n];
  const spanMomentsLeft = Array(n).fill(0);
  const spanMomentsRight = Array(n).fill(0);

  for (let c = 0; c < chainBoundaries.length - 1; c += 1) {
    const chainStart = chainBoundaries[c];
    const chainEnd = chainBoundaries[c + 1];
    const chainSpanLengths = spanLengths.slice(chainStart, chainEnd);
    const chainSpanFree = spanFree.slice(chainStart, chainEnd);
    const chainLeftFixed = chainStart === 0 ? leftFixed : true;
    const chainRightFixed = chainEnd === n ? rightFixed : true;

    const chainMoments = solveSupportMoments(chainSpanLengths, chainSpanFree, chainLeftFixed, chainRightFixed);
    for (let cs = 0; cs < chainSpanLengths.length; cs += 1) {
      spanMomentsLeft[chainStart + cs] = chainMoments[cs];
      spanMomentsRight[chainStart + cs] = chainMoments[cs + 1];
    }
  }

  // One entry per support (0..n) for display: `left`/`right` are the moment
  // as seen approaching from the left span / leaving into the right span -
  // equal for a normal continuous or simple/fixed end support, but possibly
  // different at a split (fixed interior) support, where `split` is true.
  const supportDisplay = Array.from({ length: n + 1 }, (_, k) => ({
    left: k > 0 ? spanMomentsRight[k - 1] : null,
    right: k < n ? spanMomentsLeft[k] : null,
    split: k > 0 && k < n && interiorFixedFlags[k - 1],
  }));

  return { spanMomentsLeft, spanMomentsRight, supportDisplay };
}

const CONTINUOUS_POINTS_PER_SPAN = 81;

function calculateContinuousBeam() {
  const spanLengths = getSpanLengths();
  const boundaries = getSpanBoundaries();
  const n = spanLengths.length;
  const pointsPerSpan = CONTINUOUS_POINTS_PER_SPAN;
  const leftFixed = leftEndSupport.value === 'fixed';
  const rightFixed = rightEndSupport.value === 'fixed';
  const interiorFixedFlags = getInteriorFixedFlags();

  const spanLoads = assignLoadsToSpans(loads, boundaries);

  const spanLocalX = spanLengths.map(L => Array.from({ length: pointsPerSpan }, (_, i) => (i * L) / (pointsPerSpan - 1)));
  const spanFreeResults = spanLengths.map((L, s) => computeSimplySupported(spanLoads[s], L, spanLocalX[s]));
  const spanFree = spanFreeResults.map((res, s) => integrateMomentDiagram(spanLocalX[s], res.momentVals));

  const { spanMomentsLeft, spanMomentsRight, supportDisplay } = solveChainedSupportMoments(spanLengths, spanFree, leftFixed, rightFixed, interiorFixedFlags);

  const xVals = [];
  const shearVals = [];
  const momentVals = [];
  const reactions = Array(n + 1).fill(0);
  const spanEndShear = [];

  for (let s = 0; s < n; s += 1) {
    const L = spanLengths[s];
    const Mleft = spanMomentsLeft[s];
    const Mright = spanMomentsRight[s];
    const free = spanFreeResults[s];
    const localShear = spanLocalX[s].map((x, i) => free.shearVals[i] + (Mright - Mleft) / L);
    const localMoment = spanLocalX[s].map((x, i) => free.momentVals[i] + Mleft * (1 - x / L) + Mright * (x / L));

    spanLocalX[s].forEach((x, i) => {
      xVals.push(boundaries[s] + x);
      shearVals.push(localShear[i]);
      momentVals.push(localMoment[i]);
    });

    spanEndShear.push({ start: localShear[0], end: localShear[localShear.length - 1] });
  }

  reactions[0] = spanEndShear[0].start;
  reactions[n] = -spanEndShear[n - 1].end;
  for (let s = 1; s < n; s += 1) {
    reactions[s] = spanEndShear[s].start - spanEndShear[s - 1].end;
  }

  return { xVals, shearVals, momentVals, reactions, supportDisplay, spanMomentsLeft, spanMomentsRight, spanLengths, boundaries, leftFixed, rightFixed, interiorFixedFlags };
}

function getBeamEI() {
  return parseFloat(beamEI.value) || 1;
}

// Running (cumulative) trapezoidal integral: result[i] = integral of yVals
// from xVals[0] to xVals[i]. Used twice below to go curvature -> slope -> deflection.
function cumulativeIntegral(xVals, yVals) {
  const result = Array(xVals.length).fill(0);
  for (let i = 1; i < xVals.length; i += 1) {
    const dx = xVals[i] - xVals[i - 1];
    result[i] = result[i - 1] + (dx * (yVals[i] + yVals[i - 1])) / 2;
  }
  return result;
}

// Solves EI.y'' = M(x) over one span/segment by double integration, given the
// physically-correct M(x) for that segment (which already encodes whatever
// support fixity or continuity produced it). Two integration constants are
// fixed by the segment's own boundary conditions:
//  - freeEnd = false (the normal case): both ends are supports, so y=0 at
//    x[0] and x[last]. The moment diagram already enforces slope continuity
//    with whatever is beyond each end (that's exactly what the three-moment/
//    fixed-end equations solved for), so treating every span this way -
//    independent of whether its ends are pinned or fixed - reproduces the
//    true continuous deflection curve without needing that state here.
//  - freeEnd = true (cantilever): only x[0] is a support: y=0 and slope=0
//    there, and the far end is free, so no second condition is available or
//    needed - integrating forward from the fixed end alone is exact.
function computeSpanDeflection(xVals, momentVals, EI, freeEnd) {
  const curvature = momentVals.map(m => m / EI);
  const thetaRaw = cumulativeIntegral(xVals, curvature);
  const yRaw = cumulativeIntegral(xVals, thetaRaw);
  const span = xVals[xVals.length - 1] - xVals[0];

  const C1 = freeEnd ? 0 : -yRaw[yRaw.length - 1] / span;
  const deflection = yRaw.map((y, i) => y + C1 * (xVals[i] - xVals[0]));
  return deflection;
}

// Deflection for the beam currently shown, aligned point-for-point with
// result.xVals so it can be charted directly alongside shear/moment. A
// continuous beam is solved one span at a time (each always has y=0 at both
// of its own supports, regardless of what's beyond them) and stitched back
// together; every other type is exactly one span.
function computeDeflection(result) {
  const EI = getBeamEI();

  if (beamType.value !== 'continuous') {
    return computeSpanDeflection(result.xVals, result.momentVals, EI, beamType.value === 'cantilever');
  }

  const pointsPerSpan = CONTINUOUS_POINTS_PER_SPAN;
  const deflection = [];
  result.spanLengths.forEach((_, s) => {
    const xSlice = result.xVals.slice(s * pointsPerSpan, (s + 1) * pointsPerSpan);
    const mSlice = result.momentVals.slice(s * pointsPerSpan, (s + 1) * pointsPerSpan);
    deflection.push(...computeSpanDeflection(xSlice, mSlice, EI, false));
  });
  return deflection;
}

function getMovingLoadState() {
  if (!movingLoadEnabled.checked) return { envelope: null, movingLoad: null, result: null };

  const envelope = sweepMovingLoadEnvelope();
  lastEnvelope = envelope;
  const pos = clamp(parseFloat(movingLoadPosition.value) || 0, 0, getTotalLength());
  const result = calculateWithMovingLoadAt(pos);
  const movingLoad = buildMovingLoad(pos);
  return { envelope, movingLoad, result };
}

function setMaxShearMoment(shearVals, momentVals, envelope) {
  const absMax = arr => Math.max(...arr.map(Math.abs));
  const shear = envelope ? Math.max(absMax(envelope.shearMax), absMax(envelope.shearMin)) : absMax(shearVals);
  const moment = envelope ? Math.max(absMax(envelope.momentMax), absMax(envelope.momentMin)) : absMax(momentVals);
  document.getElementById('maxShear').innerText = `${formatNumber(shear)} kN`;
  document.getElementById('maxMoment').innerText = `${formatNumber(moment)} kN.m`;
}

function setMaxDeflection(deflectionVals) {
  const maxMm = Math.max(...deflectionVals.map(Math.abs)) * 1000;
  document.getElementById('maxDeflection').innerText = `${formatNumber(maxMm)} mm`;
}

function renderBeam() {
  syncMovingLoadSliderRange();

  if (beamType.value === 'continuous') {
    renderContinuousBeam();
    return;
  }

  const { envelope, movingLoad, result: movingResult } = getMovingLoadState();
  const result = movingResult || calculateBeam();
  const { xVals, shearVals, momentVals, leftReaction, rightReaction } = result;
  const deflectionVals = computeDeflection(result);

  document.getElementById('leftReaction').innerText = `${formatNumber(leftReaction)} kN`;
  document.getElementById('rightReaction').innerText = beamType.value === 'cantilever' ? '-' : `${formatNumber(rightReaction)} kN`;
  setMaxShearMoment(shearVals, momentVals, envelope);
  setMaxDeflection(deflectionVals);
  supportReactionsPanel.style.display = 'none';

  renderBeamDiagram(xVals, shearVals, momentVals, leftReaction, rightReaction, movingLoad);
  updateCharts(xVals, shearVals, momentVals, deflectionVals, envelope, movingLoad);
}

function renderContinuousBeam() {
  const { envelope, movingLoad, result: movingResult } = getMovingLoadState();
  const result = movingResult || calculateContinuousBeam();
  const { xVals, shearVals, momentVals, reactions } = result;
  const deflectionVals = computeDeflection(result);

  document.getElementById('leftReaction').innerText = `${formatNumber(reactions[0])} kN`;
  document.getElementById('rightReaction').innerText = `${formatNumber(reactions[reactions.length - 1])} kN`;
  setMaxShearMoment(shearVals, momentVals, envelope);
  setMaxDeflection(deflectionVals);

  supportReactionsPanel.style.display = 'flex';
  supportReactionsPanel.innerHTML = reactions
    .map((r, i) => `<div class="support-reaction-chip"><span>Support ${i + 1}</span><strong>${formatNumber(r)} kN</strong></div>`)
    .join('');

  renderContinuousBeamDiagram(result, movingLoad);
  updateCharts(xVals, shearVals, momentVals, deflectionVals, envelope, movingLoad);
}

// Fast path for the moving-load slider/animation: only recomputes the
// instantaneous diagram for the new load position and reuses the envelope
// already computed by the last full renderBeam() - avoids re-sweeping the
// whole beam (60+ solves) on every animation tick.
function renderMovingLoadFrame() {
  if (!movingLoadEnabled.checked) return;

  const pos = clamp(parseFloat(movingLoadPosition.value) || 0, 0, getTotalLength());
  const result = calculateWithMovingLoadAt(pos);
  const movingLoad = buildMovingLoad(pos);
  const deflectionVals = computeDeflection(result);
  setMaxDeflection(deflectionVals);

  if (beamType.value === 'continuous') {
    const { xVals, shearVals, momentVals, reactions } = result;
    document.getElementById('leftReaction').innerText = `${formatNumber(reactions[0])} kN`;
    document.getElementById('rightReaction').innerText = `${formatNumber(reactions[reactions.length - 1])} kN`;
    supportReactionsPanel.innerHTML = reactions
      .map((r, i) => `<div class="support-reaction-chip"><span>Support ${i + 1}</span><strong>${formatNumber(r)} kN</strong></div>`)
      .join('');
    renderContinuousBeamDiagram(result, movingLoad);
    updateCharts(xVals, shearVals, momentVals, deflectionVals, lastEnvelope, movingLoad);
  } else {
    const { xVals, shearVals, momentVals, leftReaction, rightReaction } = result;
    document.getElementById('leftReaction').innerText = `${formatNumber(leftReaction)} kN`;
    document.getElementById('rightReaction').innerText = beamType.value === 'cantilever' ? '-' : `${formatNumber(rightReaction)} kN`;
    renderBeamDiagram(xVals, shearVals, momentVals, leftReaction, rightReaction, movingLoad);
    updateCharts(xVals, shearVals, momentVals, deflectionVals, lastEnvelope, movingLoad);
  }
}

function renderBeamDiagram(xVals, shearVals, momentVals, leftReaction, rightReaction, movingLoad) {
  const canvas = beamLayoutCanvas;
  if (!canvas || !canvas.getContext) return;

  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  const width = Math.max(rect.width, 400) * scale;
  const height = 300 * scale;
  canvas.width = width;
  canvas.height = height;
  canvas.style.height = '320px';

  const labelColor = printMode ? '#1e293b' : '#cbd5e1';
  const mutedLabelColor = printMode ? '#334155' : '#94a3b8';

  const beamLengthVal = parseFloat(beamLength.value) || 10;
  const margin = 60 * scale;
  const beamStart = margin;
  const beamEnd = width - margin;
  const beamY = height * 0.55;
  const beamHeight = 10 * scale;
  const unitScale = (beamEnd - beamStart) / beamLengthVal;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = '#e2e8f0';
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 4 * scale;
  ctx.lineCap = 'round';

  // beam body
  ctx.beginPath();
  ctx.moveTo(beamStart, beamY);
  ctx.lineTo(beamEnd, beamY);
  ctx.stroke();

  // support drawing helpers
  const drawArrow = (x, y, length, upward = false) => {
    ctx.beginPath();
    ctx.moveTo(x, y + (upward ? length : 0));
    ctx.lineTo(x, y + (upward ? 0 : length));
    ctx.stroke();
    if (upward) {
      ctx.beginPath();
      ctx.moveTo(x - 6 * scale, y + 12 * scale);
      ctx.lineTo(x, y);
      ctx.lineTo(x + 6 * scale, y + 12 * scale);
      ctx.stroke();
    } else {
      ctx.beginPath();
      ctx.moveTo(x - 6 * scale, y + length - 12 * scale);
      ctx.lineTo(x, y + length);
      ctx.lineTo(x + 6 * scale, y + length - 12 * scale);
      ctx.stroke();
    }
  };

  const drawReaction = (x, value) => {
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 3 * scale;
    const arrowTop = beamY - 40 * scale;
    drawArrow(x, arrowTop, 40 * scale, true);
    ctx.fillStyle = '#22c55e';
    ctx.font = `${12 * scale}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`${formatNumber(value)} kN`, x, arrowTop - 8 * scale);
  };

  const drawMomentSymbol = (x, clockwise, magnitudeLabel) => {
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2 * scale;
    const radius = 18 * scale;
    const centerY = beamY - 45 * scale;
    ctx.beginPath();
    if (clockwise) {
      ctx.arc(x, centerY, radius, 0.7 * Math.PI, 2.3 * Math.PI);
      ctx.moveTo(x + radius * Math.cos(2.3 * Math.PI), centerY + radius * Math.sin(2.3 * Math.PI));
      ctx.lineTo(x + (radius - 8 * scale) * Math.cos(2.3 * Math.PI), centerY + (radius - 8 * scale) * Math.sin(2.3 * Math.PI));
    } else {
      ctx.arc(x, centerY, radius, 0.3 * Math.PI, 1.7 * Math.PI);
      ctx.moveTo(x + radius * Math.cos(1.7 * Math.PI), centerY + radius * Math.sin(1.7 * Math.PI));
      ctx.lineTo(x + (radius - 8 * scale) * Math.cos(1.7 * Math.PI), centerY + (radius - 8 * scale) * Math.sin(1.7 * Math.PI));
    }
    ctx.stroke();
    ctx.fillStyle = '#fbbf24';
    ctx.font = `${11 * scale}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(magnitudeLabel, x, centerY - radius - 6 * scale);
  };

  const supportSize = 20 * scale;
  if (beamType.value === 'cantilever') {
    ctx.fillStyle = '#7c3aed';
    ctx.fillRect(beamStart - supportSize / 2, beamY - supportSize, supportSize / 1.5, supportSize * 2);
    drawReaction(beamStart, leftReaction);
    drawMomentSymbol(beamStart + 10 * scale, true, `${formatNumber(momentVals[0])} kN·m`);
  } else if (beamType.value === 'fixed') {
    const blockW = supportSize * 1.2;
    const blockH = supportSize * 1.8;
    ctx.fillStyle = '#1e40af';
    ctx.fillRect(beamStart - blockW / 2, beamY - blockH / 2, blockW, blockH);
    ctx.fillRect(beamEnd - blockW / 2, beamY - blockH / 2, blockW, blockH);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1 * scale;
    const ticks = 5;
    for (let i = 0; i < ticks; i += 1) {
      const tx = beamStart - blockW / 2 + (i + 1) * (blockW / (ticks + 1));
      ctx.beginPath();
      ctx.moveTo(tx, beamY - blockH / 2);
      ctx.lineTo(tx, beamY + blockH / 2);
      ctx.stroke();
    }
    for (let i = 0; i < ticks; i += 1) {
      const tx = beamEnd - blockW / 2 + (i + 1) * (blockW / (ticks + 1));
      ctx.beginPath();
      ctx.moveTo(tx, beamY - blockH / 2);
      ctx.lineTo(tx, beamY + blockH / 2);
      ctx.stroke();
    }
    drawReaction(beamStart, leftReaction);
    drawReaction(beamEnd, rightReaction);
    drawMomentSymbol(beamStart + 10 * scale, false, `${formatNumber(momentVals[0])} kN·m`);
    drawMomentSymbol(beamEnd - 10 * scale, true, `${formatNumber(momentVals[momentVals.length - 1])} kN·m`);
  } else {
    ctx.fillStyle = '#38bdf8';
    ctx.beginPath();
    ctx.moveTo(beamStart - supportSize / 2, beamY + supportSize / 1.5);
    ctx.lineTo(beamStart + supportSize / 2, beamY + supportSize / 1.5);
    ctx.lineTo(beamStart, beamY);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(beamEnd - supportSize / 2, beamY + supportSize / 1.5);
    ctx.lineTo(beamEnd + supportSize / 2, beamY + supportSize / 1.5);
    ctx.lineTo(beamEnd, beamY);
    ctx.closePath();
    ctx.fill();
    drawReaction(beamStart, leftReaction);
    drawReaction(beamEnd, rightReaction);
  }

  // Beam length label below the beam
  ctx.fillStyle = labelColor;
  ctx.font = `${16 * scale}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(`${formatNumber(beamLengthVal)} m`, (beamStart + beamEnd) / 2, beamY + 40 * scale);

  loads.forEach(load => {
    if (load.type === 'point') {
      const xPos = beamStart + clamp(load.position, 0, beamLengthVal) * unitScale;
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 3 * scale;
      drawArrow(xPos, beamY - 40 * scale, 40 * scale);
      ctx.fillStyle = '#f97316';
      ctx.font = `${13 * scale}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(`${formatNumber(load.magnitude)} kN`, xPos, beamY - 45 * scale);
    } else {
      const startX = beamStart + clamp(load.start, 0, beamLengthVal) * unitScale;
      const endX = beamStart + clamp(load.end, load.start, beamLengthVal) * unitScale;
      const udlHeight = 25 * scale;
      ctx.fillStyle = 'rgba(248, 113, 113, 0.35)';
      ctx.fillRect(startX, beamY - udlHeight, endX - startX, udlHeight);
      ctx.strokeStyle = '#f87171';
      ctx.lineWidth = 2 * scale;
      ctx.strokeRect(startX, beamY - udlHeight, endX - startX, udlHeight);
      ctx.fillStyle = '#f87171';
      ctx.font = `${13 * scale}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(`${formatNumber(load.magnitude)} kN/m`, (startX + endX) / 2, beamY - udlHeight - 10 * scale);
    }
  });

  if (movingLoad && movingLoad.type === 'udl') {
    const startX = beamStart + clamp(movingLoad.start, 0, beamLengthVal) * unitScale;
    const endX = beamStart + clamp(movingLoad.end, movingLoad.start, beamLengthVal) * unitScale;
    const udlHeight = 30 * scale;
    ctx.fillStyle = 'rgba(236, 72, 153, 0.4)';
    ctx.fillRect(startX, beamY - udlHeight, endX - startX, udlHeight);
    ctx.strokeStyle = '#ec4899';
    ctx.lineWidth = 2.5 * scale;
    ctx.strokeRect(startX, beamY - udlHeight, endX - startX, udlHeight);
    ctx.fillStyle = '#ec4899';
    ctx.font = `bold ${13 * scale}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`LIVE ${formatNumber(movingLoad.magnitude)} kN/m`, (startX + endX) / 2, beamY - udlHeight - 8 * scale);
  } else if (movingLoad) {
    const xPos = beamStart + clamp(movingLoad.position, 0, beamLengthVal) * unitScale;
    ctx.strokeStyle = '#ec4899';
    ctx.lineWidth = 3.5 * scale;
    drawArrow(xPos, beamY - 58 * scale, 58 * scale);
    ctx.fillStyle = '#ec4899';
    ctx.font = `bold ${13 * scale}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`LIVE ${formatNumber(movingLoad.magnitude)} kN`, xPos, beamY - 63 * scale);
  }

  // end markers
  ctx.fillStyle = mutedLabelColor;
  ctx.font = `${12 * scale}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('0 m', beamStart, beamY + 40 * scale);
  ctx.fillText(`${beamLengthVal.toFixed(1)} m`, beamEnd, beamY + 40 * scale);
  ctx.textAlign = 'left';
  ctx.fillText(beamType.value === 'cantilever' ? 'Cantilever support' : beamType.value === 'fixed' ? 'Fixed supports' : 'Simply supported', beamStart, beamY + 70 * scale);
}

function renderContinuousBeamDiagram(result, movingLoad) {
  const canvas = beamLayoutCanvas;
  if (!canvas || !canvas.getContext) return;

  const { reactions, boundaries, supportDisplay, leftFixed, rightFixed } = result;
  const totalLength = boundaries[boundaries.length - 1];
  const n = boundaries.length - 1;

  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  const width = Math.max(rect.width, 400) * scale;
  const height = 300 * scale;
  canvas.width = width;
  canvas.height = height;
  canvas.style.height = '320px';

  const labelColor = printMode ? '#1e293b' : '#cbd5e1';
  const mutedLabelColor = printMode ? '#334155' : '#94a3b8';

  const margin = 60 * scale;
  const beamStart = margin;
  const beamEnd = width - margin;
  const beamY = height * 0.55;
  const unitScale = (beamEnd - beamStart) / totalLength;

  ctx.clearRect(0, 0, width, height);
  ctx.strokeStyle = '#38bdf8';
  ctx.lineWidth = 4 * scale;
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(beamStart, beamY);
  ctx.lineTo(beamEnd, beamY);
  ctx.stroke();

  const drawArrow = (x, y, len, upward = false) => {
    ctx.beginPath();
    ctx.moveTo(x, y + (upward ? len : 0));
    ctx.lineTo(x, y + (upward ? 0 : len));
    ctx.stroke();
    if (upward) {
      ctx.beginPath();
      ctx.moveTo(x - 6 * scale, y + 12 * scale);
      ctx.lineTo(x, y);
      ctx.lineTo(x + 6 * scale, y + 12 * scale);
      ctx.stroke();
    }
  };

  const drawReaction = (x, value) => {
    ctx.strokeStyle = '#22c55e';
    ctx.lineWidth = 3 * scale;
    const arrowTop = beamY - 40 * scale;
    drawArrow(x, arrowTop, 40 * scale, true);
    ctx.fillStyle = '#22c55e';
    ctx.font = `${12 * scale}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`${formatNumber(value)} kN`, x, arrowTop - 8 * scale);
  };

  const drawMomentSymbol = (x, clockwise, magnitudeLabel, extraLift = 0) => {
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2 * scale;
    const radius = 18 * scale;
    const centerY = beamY - 45 * scale - extraLift;
    ctx.beginPath();
    if (clockwise) {
      ctx.arc(x, centerY, radius, 0.7 * Math.PI, 2.3 * Math.PI);
      ctx.moveTo(x + radius * Math.cos(2.3 * Math.PI), centerY + radius * Math.sin(2.3 * Math.PI));
      ctx.lineTo(x + (radius - 8 * scale) * Math.cos(2.3 * Math.PI), centerY + (radius - 8 * scale) * Math.sin(2.3 * Math.PI));
    } else {
      ctx.arc(x, centerY, radius, 0.3 * Math.PI, 1.7 * Math.PI);
      ctx.moveTo(x + radius * Math.cos(1.7 * Math.PI), centerY + radius * Math.sin(1.7 * Math.PI));
      ctx.lineTo(x + (radius - 8 * scale) * Math.cos(1.7 * Math.PI), centerY + (radius - 8 * scale) * Math.sin(1.7 * Math.PI));
    }
    ctx.stroke();
    ctx.fillStyle = '#fbbf24';
    ctx.font = `${11 * scale}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(magnitudeLabel, x, centerY - radius - 6 * scale);
  };

  const drawFixedBlock = (x) => {
    const blockW = supportSize * 1.2;
    const blockH = supportSize * 1.8;
    ctx.fillStyle = '#1e40af';
    ctx.fillRect(x - blockW / 2, beamY - blockH / 2, blockW, blockH);
    ctx.strokeStyle = '#94a3b8';
    ctx.lineWidth = 1 * scale;
    const ticks = 5;
    for (let i = 0; i < ticks; i += 1) {
      const tx = x - blockW / 2 + (i + 1) * (blockW / (ticks + 1));
      ctx.beginPath();
      ctx.moveTo(tx, beamY - blockH / 2);
      ctx.lineTo(tx, beamY + blockH / 2);
      ctx.stroke();
    }
  };

  const supportSize = 20 * scale;
  boundaries.forEach((boundaryX, i) => {
    const x = beamStart + boundaryX * unitScale;
    const display = supportDisplay[i];
    const isLeftFixedEnd = i === 0 && leftFixed;
    const isRightFixedEnd = i === n && rightFixed;
    const isInteriorFixed = display.split;

    if (isLeftFixedEnd || isRightFixedEnd) {
      drawFixedBlock(x);
      const value = isLeftFixedEnd ? display.right : display.left;
      drawMomentSymbol(x + (isLeftFixedEnd ? 1 : -1) * 10 * scale, isLeftFixedEnd, `${formatNumber(value)} kN·m`);
    } else if (isInteriorFixed) {
      drawFixedBlock(x);
      drawMomentSymbol(x - 24 * scale, false, `${formatNumber(display.left)} kN·m`, 0);
      drawMomentSymbol(x + 24 * scale, true, `${formatNumber(display.right)} kN·m`, 26 * scale);
    } else {
      ctx.fillStyle = '#38bdf8';
      ctx.beginPath();
      ctx.moveTo(x - supportSize / 2, beamY + supportSize / 1.5);
      ctx.lineTo(x + supportSize / 2, beamY + supportSize / 1.5);
      ctx.lineTo(x, beamY);
      ctx.closePath();
      ctx.fill();
    }
    drawReaction(x, reactions[i]);
  });

  // span length labels below the beam
  ctx.fillStyle = labelColor;
  ctx.font = `${14 * scale}px sans-serif`;
  ctx.textAlign = 'center';
  for (let s = 0; s < boundaries.length - 1; s += 1) {
    const midX = beamStart + ((boundaries[s] + boundaries[s + 1]) / 2) * unitScale;
    ctx.fillText(`${formatNumber(boundaries[s + 1] - boundaries[s])} m`, midX, beamY + 40 * scale);
  }

  loads.forEach(load => {
    if (load.type === 'point') {
      const xPos = beamStart + clamp(load.position, 0, totalLength) * unitScale;
      ctx.strokeStyle = '#f97316';
      ctx.lineWidth = 3 * scale;
      drawArrow(xPos, beamY - 40 * scale, 40 * scale);
      ctx.fillStyle = '#f97316';
      ctx.font = `${13 * scale}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(`${formatNumber(load.magnitude)} kN`, xPos, beamY - 45 * scale);
    } else {
      const startX = beamStart + clamp(load.start, 0, totalLength) * unitScale;
      const endX = beamStart + clamp(load.end, load.start, totalLength) * unitScale;
      const udlHeight = 25 * scale;
      ctx.fillStyle = 'rgba(248, 113, 113, 0.35)';
      ctx.fillRect(startX, beamY - udlHeight, endX - startX, udlHeight);
      ctx.strokeStyle = '#f87171';
      ctx.lineWidth = 2 * scale;
      ctx.strokeRect(startX, beamY - udlHeight, endX - startX, udlHeight);
      ctx.fillStyle = '#f87171';
      ctx.font = `${13 * scale}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillText(`${formatNumber(load.magnitude)} kN/m`, (startX + endX) / 2, beamY - udlHeight - 10 * scale);
    }
  });

  if (movingLoad && movingLoad.type === 'udl') {
    const startX = beamStart + clamp(movingLoad.start, 0, totalLength) * unitScale;
    const endX = beamStart + clamp(movingLoad.end, movingLoad.start, totalLength) * unitScale;
    const udlHeight = 30 * scale;
    ctx.fillStyle = 'rgba(236, 72, 153, 0.4)';
    ctx.fillRect(startX, beamY - udlHeight, endX - startX, udlHeight);
    ctx.strokeStyle = '#ec4899';
    ctx.lineWidth = 2.5 * scale;
    ctx.strokeRect(startX, beamY - udlHeight, endX - startX, udlHeight);
    ctx.fillStyle = '#ec4899';
    ctx.font = `bold ${13 * scale}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`LIVE ${formatNumber(movingLoad.magnitude)} kN/m`, (startX + endX) / 2, beamY - udlHeight - 8 * scale);
  } else if (movingLoad) {
    const xPos = beamStart + clamp(movingLoad.position, 0, totalLength) * unitScale;
    ctx.strokeStyle = '#ec4899';
    ctx.lineWidth = 3.5 * scale;
    drawArrow(xPos, beamY - 58 * scale, 58 * scale);
    ctx.fillStyle = '#ec4899';
    ctx.font = `bold ${13 * scale}px sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillText(`LIVE ${formatNumber(movingLoad.magnitude)} kN`, xPos, beamY - 63 * scale);
  }

  const endsLabel = leftFixed || rightFixed
    ? `${leftFixed ? 'fixed' : 'simple'} left end, ${rightFixed ? 'fixed' : 'simple'} right end`
    : 'simple end supports';
  const interiorFixedCount = supportDisplay.filter(d => d.split).length;
  const interiorLabel = interiorFixedCount > 0
    ? `, ${interiorFixedCount} fixed interior support${interiorFixedCount > 1 ? 's' : ''}`
    : '';
  ctx.fillStyle = mutedLabelColor;
  ctx.font = `${12 * scale}px sans-serif`;
  ctx.textAlign = 'left';
  ctx.fillText(`Continuous beam - ${n} spans, ${endsLabel}${interiorLabel}`, beamStart, beamY + 70 * scale);
}

function updateCharts(xVals, shearVals, momentVals, deflectionVals, envelope, movingLoad) {
  const textColor = printMode ? '#1e293b' : '#e2e8f0';
  const tickColor = printMode ? '#1e293b' : '#cbd5e1';
  const gridColor = printMode ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.06)';

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: textColor
        }
      }
    },
    scales: {
      x: {
        ticks: {
          color: tickColor,
        },
        grid: {
          color: gridColor
        }
      },
      y: {
        ticks: {
          color: tickColor
        },
        grid: {
          color: gridColor
        }
      }
    }
  };

  if (sfdChart) sfdChart.destroy();
  if (bmdChart) bmdChart.destroy();
  if (deflectionChart) deflectionChart.destroy();

  const currentSuffix = !movingLoad ? '' : (movingLoad.type === 'udl'
    ? ` (live load ${formatNumber(movingLoad.magnitude)} kN/m from x=${formatNumber(movingLoad.start)} to ${formatNumber(movingLoad.end)} m)`
    : ` (live load at x=${formatNumber(movingLoad.position)} m)`);

  const sfdDatasets = [{
    label: `Shear Force (kN)${currentSuffix}`,
    data: shearVals,
    borderColor: '#38bdf8',
    backgroundColor: 'rgba(56,189,248,0.2)',
    fill: true,
    tension: 0.5,
    borderWidth: .28
  }];

  const bmdDatasets = [{
    label: `Bending Moment (kN.m)${currentSuffix}`,
    data: momentVals,
    borderColor: '#c084fc',
    backgroundColor: 'rgba(192,132,252,0.2)',
    fill: true,
    tension: 0.5,
    borderWidth: 0.28
  }];

  if (envelope) {
    sfdDatasets.push(
      { label: 'Envelope Max', data: envelope.shearMax, borderColor: '#22c55e', backgroundColor: 'transparent', borderDash: [5, 4], fill: false, pointRadius: 0, borderWidth: 1.5, tension: 0.5 },
      { label: 'Envelope Min', data: envelope.shearMin, borderColor: '#ef4444', backgroundColor: 'transparent', borderDash: [5, 4], fill: false, pointRadius: 0, borderWidth: 1.5, tension: 0.5 }
    );
    bmdDatasets.push(
      { label: 'Envelope Max', data: envelope.momentMax, borderColor: '#22c55e', backgroundColor: 'transparent', borderDash: [5, 4], fill: false, pointRadius: 0, borderWidth: 1.5, tension: 0.5 },
      { label: 'Envelope Min', data: envelope.momentMin, borderColor: '#ef4444', backgroundColor: 'transparent', borderDash: [5, 4], fill: false, pointRadius: 0, borderWidth: 1.5, tension: 0.5 }
    );
  }

  sfdChart = new Chart(document.getElementById('sfdChart'), {
    type: 'line',
    data: { labels: xVals, datasets: sfdDatasets },
    options: chartOptions
  });

  bmdChart = new Chart(document.getElementById('bmdChart'), {
    type: 'line',
    data: { labels: xVals, datasets: bmdDatasets },
    options: chartOptions
  });

  const deflectionMm = deflectionVals.map(y => y * 1000);
  deflectionChart = new Chart(document.getElementById('deflectionChart'), {
    type: 'line',
    data: {
      labels: xVals,
      datasets: [{
        label: `Deflection (mm)${currentSuffix}`,
        data: deflectionMm,
        borderColor: '#f59e0b',
        backgroundColor: 'rgba(245,158,11,0.2)',
        fill: true,
        tension: 0.5,
        borderWidth: .28
      }]
    },
    options: chartOptions
  });
}

function findExtremum(xVals, arr) {
  let maxAbs = -1;
  let idx = 0;
  arr.forEach((value, i) => {
    if (Math.abs(value) > maxAbs) {
      maxAbs = Math.abs(value);
      idx = i;
    }
  });
  return { value: arr[idx], x: xVals[idx] };
}

function generateCalculationSteps(loadsList, type, length, result) {
  const { xVals, shearVals, momentVals, leftReaction, rightReaction } = result;

  if (loadsList.length === 0) {
    return '<div class="calc-block"><div class="calc-line">No loads have been added - nothing to calculate.</div></div>';
  }

  let html = '';

  html += '<div class="calc-block calc-legend">';
  html += '<div class="calc-title">Symbols Used</div>';
  html += `<div class="calc-line">L = beam length = ${formatNumber(length)} m\na = distance from the left support (or fixed end) to the load - for a point load, its position; for a distributed load, the start of the loaded span\nb = distance from the left support to the end of a distributed load (for fixed-beam point loads, b = L - a)\nW = total distributed load = w x (b - a)\nx&#772; = centroid of a distributed load = (a + b)/2</div>`;
  html += '</div>';

  loadsList.forEach((load, index) => {
    html += `<div class="calc-block calc-load ${load.type === 'udl' ? 'calc-load-udl' : 'calc-load-point'}">`;
    html += `<div class="calc-title"><span class="calc-badge">${index + 1}</span>${load.type === 'udl' ? 'Uniformly Distributed Load' : 'Point Load'}</div>`;

    if (type === 'cantilever') {
      if (load.type === 'point') {
        const P = load.magnitude;
        const a = clamp(load.position, 0, length);
        const M = -P * a;
        html += `<div class="calc-line">P = ${formatNumber(P)} kN at a = ${formatNumber(a)} m from the fixed support\nReaction contribution: R = P = ${formatNumber(P)} kN\nFixed-end moment contribution: M = -P.a = -${formatNumber(P)} x ${formatNumber(a)} = ${formatNumber(M)} kN.m</div>`;
      } else {
        const w = load.magnitude;
        const a = clamp(load.start, 0, length);
        const b = clamp(load.end, a, length);
        const W = w * (b - a);
        const xc = (a + b) / 2;
        const M = -W * xc;
        html += `<div class="calc-line">w = ${formatNumber(w)} kN/m from ${formatNumber(a)} m to ${formatNumber(b)} m\nTotal load: W = w(b - a) = ${formatNumber(w)} x (${formatNumber(b)} - ${formatNumber(a)}) = ${formatNumber(W)} kN acting at centroid x&#772; = (a+b)/2 = ${formatNumber(xc)} m\nReaction contribution: R = W = ${formatNumber(W)} kN\nFixed-end moment contribution: M = -W.x&#772; = -${formatNumber(W)} x ${formatNumber(xc)} = ${formatNumber(M)} kN.m</div>`;
      }
    } else if (type === 'fixed') {
      if (load.type === 'point') {
        const P = load.magnitude;
        const a = clamp(load.position, 0, length);
        const b = length - a;
        const Ra = (P * b * b * (length + 2 * a)) / (length ** 3);
        const Rb = (P * a * a * (3 * length - 2 * a)) / (length ** 3);
        const Ma = -(P * a * b * b) / (length ** 2);
        const Mb = -(P * b * a * a) / (length ** 2);
        html += `<div class="calc-line">P = ${formatNumber(P)} kN at a = ${formatNumber(a)} m (b = L - a = ${formatNumber(b)} m)\nR_A = P.b^2(L + 2a)/L^3 = ${formatNumber(Ra)} kN\nR_B = P.a^2(3L - 2a)/L^3 = ${formatNumber(Rb)} kN\nM_A = -P.a.b^2/L^2 = ${formatNumber(Ma)} kN.m\nM_B = -P.b.a^2/L^2 = ${formatNumber(Mb)} kN.m</div>`;
      } else {
        const w = load.magnitude;
        const a = clamp(load.start, 0, length);
        const b = clamp(load.end, a, length);
        const W = w * (b - a);
        const a2 = a * a; const a3 = a2 * a; const a4 = a3 * a;
        const b2 = b * b; const b3 = b2 * b; const b4 = b3 * b;
        const L2 = length * length; const L3 = L2 * length;
        const Ra = (w / L3) * (L3 * (b - a) - length * (b3 - a3) + (b4 - a4) / 2);
        const Rb = W - Ra;
        const Ma = -(w / L2) * ((L2 * (b2 - a2)) / 2 - (2 * length * (b3 - a3)) / 3 + (b4 - a4) / 4);
        const Mb = -(w / L2) * ((length * (b3 - a3)) / 3 - (b4 - a4) / 4);
        const isFullSpan = a <= 0 && b >= length;
        html += `<div class="calc-line">w = ${formatNumber(w)} kN/m from ${formatNumber(a)} m to ${formatNumber(b)} m\nTotal load: W = w(b - a) = ${formatNumber(W)} kN${isFullSpan ? '\nR_A = R_B = W/2 = ' + formatNumber(Ra) + ' kN\nM_A = M_B = -w(b-a)^2/12 = ' + formatNumber(Ma) + ' kN.m' : '\nExact fixed-end values (point-load solution integrated over the loaded span):\nR_A = ' + formatNumber(Ra) + ' kN\nR_B = ' + formatNumber(Rb) + ' kN\nM_A = ' + formatNumber(Ma) + ' kN.m\nM_B = ' + formatNumber(Mb) + ' kN.m'}</div>`;
      }
    } else {
      if (load.type === 'point') {
        const P = load.magnitude;
        const a = clamp(load.position, 0, length);
        const Ra = (P * (length - a)) / length;
        const Rb = (P * a) / length;
        html += `<div class="calc-line">P = ${formatNumber(P)} kN at a = ${formatNumber(a)} m from the left support\nR_A = P(L - a)/L = ${formatNumber(P)} x (${formatNumber(length)} - ${formatNumber(a)}) / ${formatNumber(length)} = ${formatNumber(Ra)} kN\nR_B = P.a/L = ${formatNumber(P)} x ${formatNumber(a)} / ${formatNumber(length)} = ${formatNumber(Rb)} kN</div>`;
      } else {
        const w = load.magnitude;
        const a = clamp(load.start, 0, length);
        const b = clamp(load.end, a, length);
        const W = w * (b - a);
        const xc = (a + b) / 2;
        const Ra = (W * (length - xc)) / length;
        const Rb = (W * xc) / length;
        html += `<div class="calc-line">w = ${formatNumber(w)} kN/m from ${formatNumber(a)} m to ${formatNumber(b)} m\nTotal load: W = w(b - a) = ${formatNumber(W)} kN acting at centroid x&#772; = (a+b)/2 = ${formatNumber(xc)} m\nR_A = W(L - x&#772;)/L = ${formatNumber(W)} x (${formatNumber(length)} - ${formatNumber(xc)}) / ${formatNumber(length)} = ${formatNumber(Ra)} kN\nR_B = W.x&#772;/L = ${formatNumber(W)} x ${formatNumber(xc)} / ${formatNumber(length)} = ${formatNumber(Rb)} kN</div>`;
      }
    }

    html += '</div>';
  });

  const maxShear = findExtremum(xVals, shearVals);
  const maxMoment = findExtremum(xVals, momentVals);
  const deflectionVals = computeDeflection(result);
  const maxDeflection = findExtremum(xVals, deflectionVals);

  html += '<div class="calc-block calc-totals">';
  html += '<div class="calc-title">Totals</div>';
  html += type === 'cantilever'
    ? `<div class="calc-line">Total support reaction: R = ${formatNumber(leftReaction)} kN\nTotal fixed-end moment: M = ${formatNumber(momentVals[0])} kN.m</div>`
    : `<div class="calc-line">Total left reaction: R_A = ${formatNumber(leftReaction)} kN\nTotal right reaction: R_B = ${formatNumber(rightReaction)} kN</div>`;
  html += `<div class="calc-line">Maximum shear force: |V|max = ${formatNumber(maxShear.value)} kN at x = ${formatNumber(maxShear.x)} m\nMaximum bending moment: |M|max = ${formatNumber(maxMoment.value)} kN.m at x = ${formatNumber(maxMoment.x)} m\nMaximum deflection: |&delta;|max = ${formatNumber(maxDeflection.value * 1000)} mm at x = ${formatNumber(maxDeflection.x)} m (EI = ${formatNumber(getBeamEI())} kN&middot;m&sup2;)</div>`;
  html += '</div>';

  return html;
}

function generateContinuousCalculationSteps(loadsList, result) {
  const { spanLengths, boundaries, supportDisplay, reactions, xVals, shearVals, momentVals, leftFixed, rightFixed } = result;
  const n = spanLengths.length;

  if (loadsList.length === 0) {
    return '<div class="calc-block"><div class="calc-line">No loads have been added - nothing to calculate.</div></div>';
  }

  const spanLoads = assignLoadsToSpans(loadsList, boundaries);
  const splitSupports = supportDisplay.filter(d => d.split);
  let html = '';

  const endsDescription = `Left end: ${leftFixed ? 'fixed (M_0 solved for)' : 'simple (M_0 = 0)'}. Right end: ${rightFixed ? `fixed (M_${n} solved for)` : `simple (M_${n} = 0)`}.`;
  const interiorDescription = splitSupports.length > 0
    ? `Fixed interior support(s) at: ${supportDisplay.map((d, i) => (d.split ? i : null)).filter(i => i !== null).join(', ')}. A fixed interior support restrains rotation on both sides independently, so it decouples the beam there - each side is solved as its own independent chain (its moment can differ approaching from the left vs. leaving to the right).`
    : '';
  const methodNote = (leftFixed || rightFixed || splitSupports.length > 0)
    ? 'A fixed end/support is modelled as an imaginary, unloaded, zero-length span beyond it, which forces zero slope there and adds one more unknown moment and one more three-moment equation.'
    : '';

  html += '<div class="calc-block calc-legend">';
  html += '<div class="calc-title">Symbols Used &amp; Method</div>';
  html += `<div class="calc-line">This is a statically indeterminate beam, solved with the three-moment (Clapeyron) theorem assuming constant EI.\nSpans: ${spanLengths.map((l, i) => `L${i + 1} = ${formatNumber(l)} m`).join(', ')}\nFor each span, A = area of the simply-supported (free) bending moment diagram due to that span's own loads; x&#772; = distance of its centroid from the span's left end.\nM_i = bending moment carried at support i.\n${endsDescription}${interiorDescription ? '\n' + interiorDescription : ''}${methodNote ? '\n' + methodNote : ''}</div>`;
  html += '</div>';

  spanLoads.forEach((loadsInSpan, s) => {
    html += `<div class="calc-block calc-load">`;
    html += `<div class="calc-title"><span class="calc-badge">${s + 1}</span>Span ${s + 1} (${formatNumber(spanLengths[s])} m, from ${formatNumber(boundaries[s])} to ${formatNumber(boundaries[s + 1])} m)</div>`;
    if (loadsInSpan.length === 0) {
      html += '<div class="calc-line">No loads on this span.</div>';
    } else {
      const lines = loadsInSpan.map(load => {
        if (load.type === 'point') {
          return `Point load P = ${formatNumber(load.magnitude)} kN at a = ${formatNumber(load.position)} m from this span's left support`;
        }
        return `UDL w = ${formatNumber(load.magnitude)} kN/m from ${formatNumber(load.start)} m to ${formatNumber(load.end)} m (local to this span)`;
      });
      html += `<div class="calc-line">${lines.join('\n')}</div>`;
    }
    html += '</div>';
  });

  html += '<div class="calc-block calc-totals">';
  html += '<div class="calc-title">Support Moments (Three-Moment Equation)</div>';
  html += `<div class="calc-line">${supportDisplay.map((d, i) => (d.split
    ? `M_${i} (left) = ${formatNumber(d.left)} kN.m, M_${i} (right) = ${formatNumber(d.right)} kN.m - fixed interior support, decoupled`
    : `M_${i} = ${formatNumber(d.left !== null ? d.left : d.right)} kN.m`)).join('\n')}</div>`;
  html += '</div>';

  html += '<div class="calc-block calc-totals">';
  html += '<div class="calc-title">Support Reactions</div>';
  html += `<div class="calc-line">${reactions.map((r, i) => `R_${i + 1} (support ${i + 1} at x = ${formatNumber(boundaries[i])} m) = ${formatNumber(r)} kN`).join('\n')}</div>`;
  html += '</div>';

  const maxShear = findExtremum(xVals, shearVals);
  const maxMoment = findExtremum(xVals, momentVals);
  const deflectionVals = computeDeflection(result);
  const maxDeflection = findExtremum(xVals, deflectionVals);
  html += '<div class="calc-block calc-totals">';
  html += '<div class="calc-title">Totals</div>';
  html += `<div class="calc-line">Maximum shear force: |V|max = ${formatNumber(maxShear.value)} kN at x = ${formatNumber(maxShear.x)} m\nMaximum bending moment: |M|max = ${formatNumber(maxMoment.value)} kN.m at x = ${formatNumber(maxMoment.x)} m\nMaximum deflection: |&delta;|max = ${formatNumber(maxDeflection.value * 1000)} mm at x = ${formatNumber(maxDeflection.x)} m (EI = ${formatNumber(getBeamEI())} kN&middot;m&sup2;)</div>`;
  html += '</div>';

  return html;
}

function printReport() {
  const movingActive = movingLoadEnabled.checked;
  if (loads.length === 0 && !movingActive) {
    showCustomAlert('Add at least one load before printing a report.', 'Nothing to Print');
    return;
  }

  const isContinuous = beamType.value === 'continuous';
  const length = getTotalLength();
  const { envelope, movingLoad, result: movingResult } = getMovingLoadState();
  const result = movingResult || (isContinuous ? calculateContinuousBeam() : calculateBeam());
  const beamTypeLabel = beamType.options[beamType.selectedIndex].text;
  const generatedOn = new Date().toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  const maxShear = envelope
    ? Math.max(...envelope.shearMax.map(Math.abs), ...envelope.shearMin.map(Math.abs))
    : findExtremum(result.xVals, result.shearVals).value;
  const maxMoment = envelope
    ? Math.max(...envelope.momentMax.map(Math.abs), ...envelope.momentMin.map(Math.abs))
    : findExtremum(result.xVals, result.momentVals).value;
  const leftReactionVal = isContinuous ? result.reactions[0] : result.leftReaction;
  const rightReactionVal = isContinuous ? result.reactions[result.reactions.length - 1] : result.rightReaction;
  const maxDeflectionMm = Math.max(...computeDeflection(result).map(y => Math.abs(y))) * 1000;

  const loadCountLabel = movingActive ? `${loads.length} + 1 moving` : `${loads.length}`;
  printReportMeta.innerHTML = `<div>${beamTypeLabel}</div><div>Length: ${formatNumber(length)} m &nbsp;&bull;&nbsp; Loads applied: ${loadCountLabel} &nbsp;&bull;&nbsp; EI: ${formatNumber(getBeamEI())} kN&middot;m&sup2;</div><div>Generated: ${generatedOn}</div>`;
  document.getElementById('printLeftReaction').innerText = `${formatNumber(leftReactionVal)} kN`;
  document.getElementById('printRightReaction').innerText = beamType.value === 'cantilever' ? '-' : `${formatNumber(rightReactionVal)} kN`;
  document.getElementById('printMaxShear').innerText = `${formatNumber(Math.abs(maxShear))} kN`;
  document.getElementById('printMaxMoment').innerText = `${formatNumber(Math.abs(maxMoment))} kN.m`;
  document.getElementById('printMaxDeflection').innerText = `${formatNumber(maxDeflectionMm)} mm`;

  const staticSteps = isContinuous
    ? generateContinuousCalculationSteps(loads, result)
    : generateCalculationSteps(loads, beamType.value, length, result);

  const movingLoadDescription = movingActive && movingLoad.type === 'udl'
    ? `A ${formatNumber(movingLoad.magnitude)} kN/m distributed load, ${formatNumber(getMovingLoadLength())} m long, was swept across the full ${formatNumber(length)} m span`
    : movingActive
      ? `A ${formatNumber(movingLoad.magnitude)} kN point load was swept across the full ${formatNumber(length)} m span`
      : '';
  const movingLoadSnapshot = movingActive && movingLoad.type === 'udl'
    ? `live load at x = ${formatNumber(movingLoad.start)} to ${formatNumber(movingLoad.end)} m`
    : movingActive
      ? `live load at x = ${formatNumber(movingLoad.position)} m`
      : '';

  const movingSteps = movingActive
    ? `<div class="calc-block calc-totals">
        <div class="calc-title">Moving Load Analysis (Live Load)</div>
        <div class="calc-line">${movingLoadDescription} in ${envelope ? MOVING_LOAD_SWEEP_STEPS : 0} steps, combined with the static loads above at every step.\nInstantaneous snapshot shown in the diagrams: ${movingLoadSnapshot}.\nAbsolute maximum shear across all positions: ${formatNumber(Math.abs(maxShear))} kN\nAbsolute maximum bending moment across all positions: ${formatNumber(Math.abs(maxMoment))} kN.m\nThe dashed green/red curves on the Shear Force and Bending Moment diagrams are the resulting envelope - the worst-case value at each section as the load traverses the beam.</div>
      </div>`
    : '';

  calcStepsContent.innerHTML = movingSteps + staticSteps;
  calcStepsSection.classList.add('show');
  window.print();
}

function resetAll() {
  loads.length = 0;
  renderLoads();
  renderBeam();
}

updateBeamTypeUI();
updateMovingLoadUI();
renderLoads();
renderBeam();
