const loads = [];
let sfdChart = null;
let bmdChart = null;

const beamType = document.getElementById('beamType');
const beamLength = document.getElementById('beamLength');
const loadType = document.getElementById('loadType');
const magnitude = document.getElementById('magnitude');
const position = document.getElementById('position');
const endPosition = document.getElementById('endPosition');
const endPositionGroup = document.getElementById('endPositionGroup');
const loadList = document.getElementById('loadList');

const addLoadButton = document.getElementById('addLoadButton');
const resetButton = document.getElementById('resetButton');
const beamLayoutCanvas = document.getElementById('beamLayoutCanvas');

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

loadType.addEventListener('change', () => {
  const isUDL = loadType.value === 'udl';
  endPositionGroup.style.display = isUDL ? 'block' : 'none';
  document.querySelector('#positionGroup label').innerText = isUDL ? 'Start Position (m)' : 'Position (m)';
});

beamLength.addEventListener('change', renderBeam);
addLoadButton.addEventListener('click', addLoad);
resetButton.addEventListener('click', resetAll);

function addLoad() {
  const type = loadType.value;
  const mag = parseFloat(magnitude.value);
  const pos = parseFloat(position.value);
  const len = parseFloat(beamLength.value) || 10;
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
            momentVals[i] += P * x;
          }
        }
      } else {
        const w = load.magnitude;
        const a = clamp(load.start, 0, length);
        const b = clamp(load.end, a, length);
        const totalW = w * (b - a);
        leftReaction += totalW;
        for (let i = 0; i < steps; i += 1) {
          const x = xVals[i];
          if (x <= a) {
            shearVals[i] += totalW;
            momentVals[i] += totalW * x;
          } else if (x <= b) {
            const loadedLength = x - a;
            shearVals[i] += w * (b - x);
            momentVals[i] += w * loadedLength * loadedLength / 2 + totalW * x;
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
        const Ra = P * b * b * (2 * length - a) / (length * length * length);
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
        const Ra = totalW / 2;
        const Rb = totalW / 2;
        const Ma = -w * (b - a) * (b - a) / 12;
        const Mb = -w * (b - a) * (b - a) / 12;
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
    loads.forEach(load => {
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
        const Ra = totalW * (length - b) / length;
        const Rb = totalW * a / length;
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
  }

  return { xVals, shearVals, momentVals, leftReaction, rightReaction };
}

function renderBeam() {
  const { xVals, shearVals, momentVals, leftReaction, rightReaction } = calculateBeam();

  document.getElementById('leftReaction').innerText = `${formatNumber(leftReaction)} kN`;
  document.getElementById('rightReaction').innerText = beamType.value === 'cantilever' ? '-' : `${formatNumber(rightReaction)} kN`;
  document.getElementById('maxShear').innerText = `${formatNumber(Math.max(...shearVals.map(Math.abs)))} kN`;
  document.getElementById('maxMoment').innerText = `${formatNumber(Math.max(...momentVals.map(Math.abs)))} kN.m`;

  renderBeamDiagram(xVals, shearVals, momentVals, leftReaction, rightReaction);
  updateCharts(xVals, shearVals, momentVals);
}

function renderBeamDiagram(xVals, shearVals, momentVals, leftReaction, rightReaction) {
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

  // supports
  const supportSize = 20 * scale;
  if (beamType.value === 'cantilever') {
    ctx.fillStyle = '#7c3aed';
    ctx.fillRect(beamStart - supportSize / 2, beamY - supportSize, supportSize / 1.5, supportSize * 2);
    ctx.fillStyle = '#38bdf8';
    ctx.fillRect(beamEnd - supportSize / 4, beamY - supportSize / 6, supportSize / 4, supportSize / 3);
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
  }

  // Beam length label below the beam
  ctx.fillStyle = '#cbd5e1';
  ctx.font = `${16 * scale}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText(`${formatNumber(beamLengthVal)} m`, (beamStart + beamEnd) / 2, beamY + 40 * scale);

  const drawArrow = (x, y, length) => {
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x, y + length);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - 6 * scale, y + length - 12 * scale);
    ctx.lineTo(x, y + length);
    ctx.lineTo(x + 6 * scale, y + length - 12 * scale);
    ctx.stroke();
  };

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

  // end markers
  ctx.fillStyle = '#94a3b8';
  ctx.font = `${12 * scale}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillText('0 m', beamStart, beamY + 40 * scale);
  ctx.fillText(`${beamLengthVal.toFixed(1)} m`, beamEnd, beamY + 40 * scale);
  ctx.textAlign = 'left';
  ctx.fillText(beamType.value === 'cantilever' ? 'Cantilever support' : beamType.value === 'fixed' ? 'Fixed supports' : 'Simply supported', beamStart, beamY + 70 * scale);
}

function updateCharts(xVals, shearVals, momentVals) {
  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        labels: {
          color: '#e2e8f0'
        }
      }
    },
    scales: {
      x: {
        ticks: {
          color: '#cbd5e1',
        },
        grid: {
          color: 'rgba(255,255,255,0.06)'
        }
      },
      y: {
        ticks: {
          color: '#cbd5e1'
        },
        grid: {
          color: 'rgba(255,255,255,0.06)'
        }
      }
    }
  };

  if (sfdChart) sfdChart.destroy();
  if (bmdChart) bmdChart.destroy();

  sfdChart = new Chart(document.getElementById('sfdChart'), {
    type: 'line',
    data: {
      labels: xVals,
      datasets: [{
        label: 'Shear Force (kN)',
        data: shearVals,
        borderColor: '#38bdf8',
        backgroundColor: 'rgba(56,189,248,0.2)',
        fill: true,
        tension: 0.5,
        borderWidth: .28
      }]
    },
    options: chartOptions
  });

  bmdChart = new Chart(document.getElementById('bmdChart'), {
    type: 'line',
    data: {
      labels: xVals,
      datasets: [{
        label: 'Bending Moment (kN�m)',
        data: momentVals,
        borderColor: '#c084fc',
        backgroundColor: 'rgba(192,132,252,0.2)',
        fill: true,
        tension: 0.5,
        borderWidth: 0.28
      }]
    },
    options: chartOptions
  });
}

function resetAll() {
  loads.length = 0;
  renderLoads();
  renderBeam();
}

renderLoads();
renderBeam();
