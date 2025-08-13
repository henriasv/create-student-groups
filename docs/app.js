// Simple PRNG for deterministic shuffles
function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}

function shuffleInPlace(arr, rng) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor((rng ? rng() : Math.random()) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

function parseCSV(text) {
  const lines = text.split(/\r?\n/).filter(l => l.trim().length > 0);
  if (lines.length === 0) throw new Error('CSV is empty');
  const header = lines[0].split(',').map(s => s.trim().toLowerCase());
  const nameIdx = header.indexOf('name');
  const progIdx = header.indexOf('program');
  if (nameIdx === -1 || progIdx === -1) throw new Error("Missing 'name' or 'program' header");
  const students = [];
  for (let i = 1; i < lines.length; i++) {
    const row = lines[i].split(',');
    const name = (row[nameIdx] || '').trim();
    const program = (row[progIdx] || '').trim();
    if (!name || !program) continue;
    students.push({ name, program });
  }
  if (students.length === 0) throw new Error('No students found in CSV');
  return students;
}

function groupStudents(students, groupSize, seed) {
  if (groupSize <= 0) throw new Error('group_size must be positive');
  const total = students.length;
  if (total === 0) throw new Error('No students');

  const programMap = new Map();
  for (const s of students) {
    if (!programMap.has(s.program)) programMap.set(s.program, []);
    programMap.get(s.program).push({ ...s });
  }
  const programs = Array.from(programMap.keys()).sort();
  const numPrograms = programs.length;
  if (numPrograms > groupSize) {
    throw new Error(`group_size (${groupSize}) smaller than number of programs (${numPrograms})`);
  }

  const rng = (typeof seed === 'number') ? mulberry32(seed) : undefined;
  for (const p of programs) shuffleInPlace(programMap.get(p), rng);

  const numGroups = Math.ceil(total / groupSize);
  // Feasibility check
  for (const p of programs) {
    if (programMap.get(p).length < numGroups) {
      throw new Error(`Not enough '${p}' students to cover ${numGroups} groups`);
    }
  }

  const groups = Array.from({ length: numGroups }, () => []);
  // Assign one of each program to every group
  for (const p of programs) {
    const bucket = programMap.get(p);
    for (let g = 0; g < numGroups; g++) {
      groups[g].push({ ...bucket.pop(), locked: false });
    }
  }

  const rest = [];
  for (const p of programs) rest.push(...programMap.get(p));
  shuffleInPlace(rest, rng);

  for (const s of rest) {
    groups.sort((a, b) => a.length - b.length);
    for (const g of groups) {
      if (g.length < groupSize) { g.push({ ...s, locked: false }); break; }
    }
  }

  return {
    groupSize,
    numGroups,
    programs,
    groups: groups.map((students, i) => ({ index: i + 1, students }))
  };
}

function reshuffleRespectingLocks(groups, programs, groupSize, seed) {
  const rng = (typeof seed === 'number') ? mulberry32(seed) : undefined;
  const numGroups = groups.length;

  const lockedPerGroup = groups.map(g => g.students.filter(s => s.locked));
  for (let i = 0; i < numGroups; i++) {
    if (lockedPerGroup[i].length > groupSize) {
      throw new Error(`Group ${i+1} exceeds size due to locked students`);
    }
  }

  // Pool unlocked
  const unlockedPool = [];
  for (const g of groups) {
    for (const s of g.students) if (!s.locked) unlockedPool.push({ name: s.name, program: s.program, locked: false });
  }

  // Present programs per group (from locked)
  const presentPerGroup = lockedPerGroup.map(list => new Set(list.map(s => s.program)));

  // Feasibility per program
  const counts = {};
  for (const s of unlockedPool) counts[s.program] = (counts[s.program] || 0) + 1;
  for (const p of programs) {
    const withP = presentPerGroup.reduce((acc, set) => acc + (set.has(p) ? 1 : 0), 0);
    const required = Math.max(0, numGroups - withP);
    if ((counts[p] || 0) < required) {
      throw new Error(`Need at least ${required} unlocked '${p}' students to cover all groups`);
    }
  }

  // Start with locked
  const result = lockedPerGroup.map(list => list.map(s => ({ ...s, locked: true })));

  // Build program queues
  const queues = {};
  for (const s of unlockedPool) {
    (queues[s.program] ||= []).push(s);
  }
  for (const p of Object.keys(queues)) shuffleInPlace(queues[p], rng);

  // Fill missing programs
  for (let i = 0; i < numGroups; i++) {
    const present = presentPerGroup[i];
    const missing = programs.filter(p => !present.has(p));
    if (result[i].length + missing.length > groupSize) {
      throw new Error(`Group ${i+1} would exceed size when adding required programs`);
    }
    for (const p of missing) {
      const q = queues[p];
      if (!q || q.length === 0) throw new Error(`Program queue empty for ${p}`);
      result[i].push({ ...q.pop(), locked: false });
    }
  }

  // Distribute remaining
  const leftover = [];
  for (const p in queues) leftover.push(...queues[p]);
  shuffleInPlace(leftover, rng);
  for (const s of leftover) {
    result.sort((a, b) => a.length - b.length);
    for (const g of result) {
      if (g.length < groupSize) { g.push({ ...s, locked: false }); break; }
    }
  }

  return result.map((students, i) => ({ index: i + 1, students }));
}

// UI logic
const els = {
  csv: document.getElementById('csv'),
  groupSize: document.getElementById('group_size'),
  seed: document.getElementById('seed'),
  setupForm: document.getElementById('setup-form'),
  groups: document.getElementById('groups'),
  placeholder: document.getElementById('placeholder'),
  validate: document.getElementById('validate'),
  reshuffle: document.getElementById('reshuffle'),
  exportCsv: document.getElementById('export-csv'),
  exportMd: document.getElementById('export-md'),
  theme: document.getElementById('theme'),
  incSize: document.getElementById('inc-size'),
  decSize: document.getElementById('dec-size'),
};

let state = {
  programs: [],
  groupSize: 0,
  groups: [],
  theme: 'numeric',
};

// Initialize state.groupSize from the current input default
state.groupSize = parseInt(els.groupSize.value || '4', 10) || 0;

function enableControls(enabled) {
  els.validate.disabled = !enabled;
  els.reshuffle.disabled = !enabled;
  els.exportCsv.disabled = !enabled;
  els.exportMd.disabled = !enabled;
  // Keep steppers usable pre-generation so users can set size first
}

function renderGroups(groups) {
  if (els.placeholder) els.placeholder.remove();
  els.groups.innerHTML = '';
  const names = themedGroupNames(groups.length, state.theme);
  for (const g of groups) {
    const section = document.createElement('section');
    section.className = 'group';
    section.dataset.groupIndex = String(g.index);
    section.innerHTML = `
      <header>
        <h2>${names[g.index - 1] || `Group ${g.index}`}</h2>
        <small><span class="count">${g.students.length}</span> / ${state.groupSize}</small>
      </header>
      <ul class="student-list" data-list="${g.index}"></ul>
    `;
    const list = section.querySelector('.student-list');
    for (const s of g.students) list.appendChild(createStudentLi(s));
    els.groups.appendChild(section);
  }
  bindDnD();
  bindLockButtons();
}

function createStudentLi(s) {
  const li = document.createElement('li');
  li.className = 'student';
  li.dataset.name = s.name;
  li.dataset.program = s.program;
  li.dataset.locked = s.locked ? 'true' : 'false';
  if (s.locked) li.classList.add('is-locked');
  const lockIcon = s.locked ? '🔒' : '🔓';
  li.innerHTML = `<span class="name">${s.name}</span><span class="actions"><span class="tag">${s.program}</span><button class="lock-btn" title="Toggle lock" aria-label="Toggle lock">${lockIcon}</button></span>`;
  li.setAttribute('draggable', 'true');
  return li;
}

function currentPayload() {
  const groups = Array.from(document.querySelectorAll('.group')).map((g, i) => {
    const students = Array.from(g.querySelectorAll('.student')).map(li => ({
      name: li.dataset.name,
      program: li.dataset.program,
      locked: li.dataset.locked === 'true'
    }));
    return { index: i + 1, students };
  });
  return { groups };
}

function bindDnD() {
  let dragged = null;
  document.querySelectorAll('.student').forEach(item => {
    item.addEventListener('dragstart', (e) => {
      if (item.dataset.locked === 'true') { e.preventDefault(); return; }
      dragged = item;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.dataset.name);
    });
  });
  document.querySelectorAll('.student-list').forEach(list => {
    list.addEventListener('dragover', (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; });
    list.addEventListener('drop', (e) => {
      e.preventDefault();
      if (dragged && dragged.dataset.locked !== 'true') {
        list.appendChild(dragged);
        updateCounts();
      }
    });
  });
}

function bindLockButtons() {
  document.querySelectorAll('.lock-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      const li = e.currentTarget.closest('.student');
      const locked = li.dataset.locked === 'true';
      li.dataset.locked = (!locked).toString();
      li.classList.toggle('is-locked', !locked);
      e.currentTarget.textContent = (!locked) ? '🔒' : '🔓';
    });
  });
}

function updateCounts() {
  document.querySelectorAll('.group').forEach(g => {
    const count = g.querySelectorAll('.student').length;
    g.querySelector('.count').textContent = count;
  });
}

function validateConstraints(groups, programs, groupSize) {
  const errors = [];
  for (const g of groups) {
    if (g.students.length > groupSize) errors.push(`Group ${g.index} exceeds group size ${groupSize}.`);
    const present = new Set(g.students.map(s => s.program));
    const missing = programs.filter(p => !present.has(p));
    if (missing.length) errors.push(`Group ${g.index} missing programs: ${missing.join(', ')}`);
  }
  return errors;
}

function exportCSV(groups) {
  const lines = ['group,name,program'];
  for (const g of groups) for (const s of g.students) lines.push(`${g.index},${s.name},${s.program}`);
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'groups.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function themedGroupNames(numGroups, theme) {
  const lists = {
    numeric: Array.from({ length: numGroups }, (_, i) => `Group ${i + 1}`),
    greek: ['Alpha','Beta','Gamma','Delta','Epsilon','Zeta','Eta','Theta','Iota','Kappa','Lambda','Mu','Nu','Xi','Omicron','Pi','Rho','Sigma','Tau','Upsilon','Phi','Chi','Psi','Omega'],
    colors: ['Red','Blue','Green','Yellow','Purple','Orange','Teal','Cyan','Magenta','Lime','Indigo','Violet','Amber','Rose','Emerald','Sapphire','Ruby','Topaz'],
    animals: ['Lion','Tiger','Bear','Wolf','Eagle','Falcon','Dolphin','Fox','Owl','Hawk','Panther','Cheetah','Bison','Moose','Koala','Penguin','Otter','Orca'],
    planets: ['Mercury','Venus','Earth','Mars','Jupiter','Saturn','Uranus','Neptune','Pluto'],
    norse: ['Odin','Thor','Freya','Loki','Baldr','Frigg','Heimdall','Tyr','Njord','Sif','Skadi','Bragi'],
  };
  const list = lists[theme] || lists.numeric;
  const names = [];
  for (let i = 0; i < numGroups; i++) {
    names.push(list[i] ? list[i] : `Group ${i + 1}`);
  }
  return names;
}

function exportMarkdown(groups, theme) {
  const names = themedGroupNames(groups.length, theme);
  const lines = ['# Groups'];
  for (let i = 0; i < groups.length; i++) {
    const g = groups[i];
    lines.push(`\n## ${names[i]}`);
    for (const s of g.students) {
      lines.push(`- ${s.name} (${s.program})`);
    }
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'groups.md';
  document.body.appendChild(link);
  link.click();
  link.remove();
}

els.setupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const file = els.csv.files[0];
    if (!file) throw new Error('Please choose a CSV file');
    const text = await file.text();
    const students = parseCSV(text);
    const groupSize = parseInt(els.groupSize.value, 10);
    const seed = els.seed.value ? parseInt(els.seed.value, 10) : undefined;
    const result = groupStudents(students, groupSize, seed);
    state.programs = result.programs;
    state.groupSize = result.groupSize;
    state.groups = result.groups;
    state.theme = els.theme ? els.theme.value : 'numeric';
    renderGroups(state.groups);
    enableControls(true);
  } catch (err) {
    alert(String(err));
  }
});

els.validate.addEventListener('click', () => {
  const payload = currentPayload();
  const errors = validateConstraints(payload.groups, state.programs, state.groupSize);
  if (errors.length) alert('Invalid: ' + errors.join('; '));
  else alert('Valid!');
});

els.reshuffle.addEventListener('click', () => {
  const payload = currentPayload();
  try {
    const groups = reshuffleRespectingLocks(payload.groups, state.programs, state.groupSize, els.seed.value ? parseInt(els.seed.value, 10) : undefined);
    state.groups = groups;
    state.theme = els.theme ? els.theme.value : state.theme;
    renderGroups(groups);
  } catch (err) {
    alert(String(err));
  }
});

els.exportCsv.addEventListener('click', () => {
  const payload = currentPayload();
  exportCSV(payload.groups);
});

els.exportMd.addEventListener('click', () => {
  const payload = currentPayload();
  const theme = els.theme ? els.theme.value : 'numeric';
  exportMarkdown(payload.groups, theme);
});


// Group size + / - controls
function applyNewGroupSize(newSize) {
  const minSize = Math.max(1, state.programs.length || 0);
  if (newSize < minSize) {
    alert(`Group size cannot be less than number of programs (${state.programs.length || 0}).`);
    return;
  }
  const prev = state.groupSize || parseInt(els.groupSize.value || '4', 10);
  // If no groups yet, just set the value and return
  if (!state.groups || state.groups.length === 0) {
    state.groupSize = newSize;
    els.groupSize.value = String(newSize);
    return;
  }
  try {
    const payload = currentPayload();
    const groups = reshuffleRespectingLocks(payload.groups, state.programs, newSize, els.seed.value ? parseInt(els.seed.value, 10) : undefined);
    state.groupSize = newSize;
    els.groupSize.value = String(newSize);
    state.groups = groups;
    renderGroups(groups);
  } catch (err) {
    alert(String(err));
    state.groupSize = prev;
    els.groupSize.value = String(prev);
  }
}

if (els.incSize) {
  els.incSize.addEventListener('click', (e) => {
    e.preventDefault();
    const current = parseInt(els.groupSize.value || String(state.groupSize || 0), 10) || 0;
    applyNewGroupSize(current + 1);
  });
}
if (els.decSize) {
  els.decSize.addEventListener('click', (e) => {
    e.preventDefault();
    const current = parseInt(els.groupSize.value || String(state.groupSize || 0), 10) || 0;
    applyNewGroupSize(current - 1);
  });
}

// Keep state in sync when user types a number before generating groups
els.groupSize.addEventListener('input', () => {
  const val = parseInt(els.groupSize.value, 10);
  if (!Number.isNaN(val)) state.groupSize = val;
});

// Update theme live and re-render headers when groups exist
if (els.theme) {
  els.theme.addEventListener('change', () => {
    state.theme = els.theme.value;
    if (state.groups && state.groups.length > 0) renderGroups(state.groups);
  });
}


