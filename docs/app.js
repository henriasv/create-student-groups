// Simple PRNG for deterministic shuffles
function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  }
}

// Generate distinct colors for study programs
function getProgramColors(programs) {
  // ColorBrewer qualitative palette - colorblind safe
  const colors = [
    '#E69F00', '#56B4E9', '#009E73', '#F0E442', '#0072B2', 
    '#D55E00', '#CC79A7', '#999999', '#E69F00', '#56B4E9', 
    '#009E73', '#F0E442', '#0072B2', '#D55E00', '#CC79A7', 
    '#999999', '#E69F00', '#56B4E9', '#009E73', '#F0E442'
  ];
  
  const programColors = {};
  programs.forEach((program, index) => {
    programColors[program] = colors[index % colors.length];
  });
  return programColors;
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
  const headerRaw = lines[0].split(',');
  const header = headerRaw.map(s => s.trim().toLowerCase());
  const nameAliases = new Set(['name','student','student_name','student name']);
  const programAliases = new Set(['program','programme','study_program','study programme','studyprogram','major']);
  let nameIdx = -1, progIdx = -1;
  for (let i = 0; i < header.length; i++) {
    if (nameAliases.has(header[i])) nameIdx = i;
    if (programAliases.has(header[i])) progIdx = i;
  }
  // Fallback: if exactly two columns and unknown headers, assume order: name, program
  if (nameIdx === -1 || progIdx === -1) {
    if (header.length >= 2) {
      nameIdx = 0;
      progIdx = 1;
    } else {
      throw new Error("Missing 'name' or 'program' header");
    }
  }
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
    // Append to the current smallest group without reordering the groups array
    let minIdx = 0;
    let minLen = result[0] ? result[0].length : 0;
    for (let i = 1; i < result.length; i++) {
      if (result[i].length < minLen) { minLen = result[i].length; minIdx = i; }
    }
    if (result[minIdx].length < groupSize) {
      result[minIdx].push({ ...s, locked: false });
    }
  }

  return result.map((students, i) => ({ index: i + 1, students }));
}

function reshuffleRespectingLocksToGroupSize(groups, programs, groupSize, seed) {
  const rng = (typeof seed === 'number') ? mulberry32(seed) : undefined;
  const totalStudents = groups.reduce((acc, g) => acc + g.students.length, 0);
  const targetNumGroups = Math.max(1, Math.ceil(totalStudents / groupSize));

  // Collect locked and unlocked
  const lockedAll = [];
  const unlockedPool = [];
  for (const g of groups) {
    for (const s of g.students) {
      if (s.locked) lockedAll.push({ ...s }); else unlockedPool.push({ name: s.name, program: s.program, locked: false });
    }
  }

  // Build program counts for feasibility
  const counts = {};
  for (const s of lockedAll) counts[s.program] = (counts[s.program] || 0) + 1;
  for (const s of unlockedPool) counts[s.program] = (counts[s.program] || 0) + 1;

  const numPrograms = programs.length;
  if (numPrograms > groupSize) throw new Error(`group_size (${groupSize}) smaller than number of programs (${numPrograms})`);
  for (const p of programs) {
    if ((counts[p] || 0) < targetNumGroups) throw new Error(`Not enough '${p}' students to cover ${targetNumGroups} groups`);
  }

  // Initialize target groups and present programs
  const result = Array.from({ length: targetNumGroups }, () => []);
  const presentPerGroup = Array.from({ length: targetNumGroups }, () => new Set());

  // Place locked students. Keep within original group index if possible; overflow round-robin
  let rr = 0;
  for (let gi = 0; gi < groups.length; gi++) {
    const lockedHere = groups[gi].students.filter(s => s.locked).map(s => ({ ...s, locked: true }));
    for (const s of lockedHere) {
      let targetIdx = gi < targetNumGroups ? gi : (rr++ % targetNumGroups);
      if (result[targetIdx].length >= groupSize) {
        // find next with space
        let found = false;
        for (let j = 0; j < targetNumGroups; j++) {
          if (result[j].length < groupSize) { targetIdx = j; found = true; break; }
        }
        if (!found) throw new Error('Capacity full with locked students');
      }
      result[targetIdx].push({ name: s.name, program: s.program, locked: true });
      presentPerGroup[targetIdx].add(s.program);
    }
  }

  // Build queues for unlocked and shuffle
  const queues = {};
  for (const s of unlockedPool) (queues[s.program] ||= []).push(s);
  for (const p of Object.keys(queues)) shuffleInPlace(queues[p], rng);

  // Fill missing programs per group first
  for (let i = 0; i < targetNumGroups; i++) {
    const missing = programs.filter(p => !presentPerGroup[i].has(p));
    if (result[i].length + missing.length > groupSize) throw new Error(`Group ${i+1} would exceed size when adding required programs`);
    for (const p of missing) {
      const q = queues[p];
      if (!q || q.length === 0) throw new Error(`Program queue empty for ${p}`);
      const s = q.pop();
      result[i].push({ ...s, locked: false });
      presentPerGroup[i].add(s.program);
    }
  }

  // Distribute any leftover
  const leftover = [];
  for (const p in queues) leftover.push(...queues[p]);
  shuffleInPlace(leftover, rng);
  for (const s of leftover) {
    let minIdx = 0;
    let minLen = result[0] ? result[0].length : 0;
    for (let i = 1; i < result.length; i++) {
      if (result[i].length < minLen) { minLen = result[i].length; minIdx = i; }
    }
    if (result[minIdx].length < groupSize) result[minIdx].push({ ...s, locked: false });
  }

  return result.map((students, i) => ({ index: i + 1, students }));
}

// UI logic
const els = {
  csv: document.getElementById('csv'),
  csvText: document.getElementById('csv_text'),
  groupSize: document.getElementById('group_size'),
  seed: document.getElementById('seed'),
  setupForm: document.getElementById('setup-form'),
  groups: document.getElementById('groups'),
  placeholder: document.getElementById('placeholder'),
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
  lastCsvText: '',
};

// Initialize state.groupSize from the current input default
state.groupSize = parseInt(els.groupSize.value || '4', 10) || 0;

function enableControls(enabled) {
  els.exportCsv.disabled = !enabled;
  els.exportMd.disabled = !enabled;
  // Keep steppers usable pre-generation so users can set size first
}

function renderGroups(groups) {
  if (els.placeholder) els.placeholder.remove();
  els.groups.innerHTML = '';
  const names = themedGroupNames(groups.length, state.theme);
  
  // Generate colors for each unique program
  const uniquePrograms = [...new Set(groups.flatMap(g => g.students.map(s => s.program)))];
  const programColors = getProgramColors(uniquePrograms);
  
  // Set minHeight to match sidebar to reduce jump; will expand if content exceeds
  const sidebar = document.querySelector('.sidebar');
  const shell = document.getElementById('groups-shell');
  if (sidebar && shell) {
    const sidebarHeight = sidebar.getBoundingClientRect().height;
    shell.style.minHeight = sidebarHeight + 'px';
  }
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
    for (const s of g.students) list.appendChild(createStudentLi(s, programColors));
    els.groups.appendChild(section);
  }
  bindDnD();
  bindLockButtons();
}

function createStudentLi(s, programColors) {
  const li = document.createElement('li');
  li.className = 'student';
  li.dataset.name = s.name;
  li.dataset.program = s.program;
  li.dataset.locked = s.locked ? 'true' : 'false';
  if (s.locked) li.classList.add('is-locked');
  const lockIcon = s.locked ? '🔒' : '🔓';
  const programColor = programColors[s.program] || '#666';
  li.innerHTML = `<span class="name">${s.name}</span><span class="actions"><span class="tag" style="background-color: ${programColor}">${s.program}</span><button class="lock-btn" title="Toggle lock" aria-label="Toggle lock" draggable="false">${lockIcon}</button></span>`;
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
    item.setAttribute('draggable', 'true');
    item.addEventListener('dragstart', (e) => {
      if (item.dataset.locked === 'true') { e.preventDefault(); return; }
      dragged = item;
      item.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        // Some browsers require data to be set
        e.dataTransfer.setData('text/plain', 'student');
      }
    });
    item.addEventListener('dragend', () => {
      if (dragged === item) {
        item.classList.remove('dragging');
        dragged = null;
      }
    });
  });

  document.querySelectorAll('.student-list').forEach(list => {
    list.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      list.classList.add('drag-over');
    });
    list.addEventListener('dragleave', () => {
      list.classList.remove('drag-over');
    });
    list.addEventListener('drop', (e) => {
      e.preventDefault();
      list.classList.remove('drag-over');
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
    // Prevent drag from starting on lock button
    btn.addEventListener('mousedown', (e) => { e.stopPropagation(); });
    btn.addEventListener('dragstart', (e) => { e.preventDefault(); });
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
    mathematicians: ['Gauss','Noether','Euler','Riemann','Hilbert','Poincaré','Cantor','Ramanujan','Hypatia','Archimedes','Cauchy','Fourier','Fermat','Galois','Lagrange'],
    physicists: ['Newton','Einstein','Curie','Feynman','Hawking','Maxwell','Faraday','Bohr','Heisenberg','Schrödinger','Dirac','Planck','Galileo','Kepler'],
    chemists: ['Lavoisier','Mendeleev','Dalton','Avogadro','Pauling','Kekulé','Haber','Curie','Bunsen','Priestley','Boyle','Berzelius'],
    biologists: ['Darwin','Mendel','Pasteur','Linnaeus','Haeckel','Goodall','Franklin','Watson','Crick','Huxley','Monod','Margulis'],
    philosophers: ['Plato','Aristotle','Kant','Hume','Nietzsche','Descartes','Spinoza','Kierkegaard','Wittgenstein','Confucius','Socrates','Heidegger'],
    computerscience: ['Turing','Shannon','von Neumann','Knuth','Dijkstra','Hopper','Berners-Lee','Lamport','Ritchie','Torvalds','Kay','Backus'],
    constellations: ['Orion','Lyra','Cygnus','Andromeda','Cassiopeia','Draco','Aquila','Pegasus','Phoenix','Ursa Major','Ursa Minor','Perseus'],
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
  const content = lines.join('\n');
  const url = 'data:text/plain;charset=utf-8,' + encodeURIComponent(content);
  const opened = window.open(url, '_blank', 'noopener,noreferrer');
  if (!opened) {
    // Popup blocked: fall back to creating a new tab via anchor
    const a = document.createElement('a');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    document.body.appendChild(a);
    a.click();
    a.remove();
  }
}

els.setupForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    // Always use the textarea for generation. The file input only populates the textarea on change.
    const text = (els.csvText && els.csvText.value ? els.csvText.value : '').trim();
    if (!text) {
      alert('CSV data is empty. Paste CSV into the CSV data field or select a file to populate it.');
      return;
    }
    const desiredGroupSize = parseInt(els.groupSize.value, 10);
    const seed = els.seed.value ? parseInt(els.seed.value, 10) : undefined;

    // If CSV unchanged and we already have groups, do a lock-respecting reshuffle
    if (state.groups && state.groups.length > 0 && state.lastCsvText === text) {
      state.groupSize = desiredGroupSize;
      state.theme = els.theme ? els.theme.value : state.theme;
      const payload = currentPayload();
      const reshuffled = reshuffleRespectingLocksToGroupSize(payload.groups, state.programs, state.groupSize, seed);
      state.groups = reshuffled;
      renderGroups(state.groups);
      enableControls(true);
      return;
    }

    // Otherwise, parse and generate fresh groups
    const students = parseCSV(text);
    const result = groupStudents(students, desiredGroupSize, seed);
    state.programs = result.programs;
    state.groupSize = result.groupSize;
    state.groups = result.groups;
    state.theme = els.theme ? els.theme.value : 'numeric';
    state.lastCsvText = text;
    renderGroups(state.groups);
    enableControls(true);
  } catch (err) {
    alert(String(err));
  }
});

// validate and reshuffle buttons removed; generate handles reshuffle now

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
    const groups = reshuffleRespectingLocksToGroupSize(payload.groups, state.programs, newSize, els.seed.value ? parseInt(els.seed.value, 10) : undefined);
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

// When a file is chosen, load its contents into the textarea so the user can see/edit it
if (els.csv) {
  els.csv.addEventListener('change', async () => {
    const file = els.csv.files && els.csv.files[0];
    if (!file) return;
    try {
      const text = await file.text();
      if (els.csvText) els.csvText.value = text;
    } catch (err) {
      // ignore
    }
  });
}


