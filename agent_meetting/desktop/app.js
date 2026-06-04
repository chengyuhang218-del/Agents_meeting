import * as THREE from "/assets/vendor/three.module.js";

const state = {
  projects: [],
  jobsTimer: null,
  seenEventKeys: new Set(),
  activeAgent: "",
  activeMessage: "",
  taskActive: false,
  meetingDone: false,
  office: null,
  agentsData: [],
  selectedAgentId: "",
  agentChats: {},
  runQueue: [],
  selectedRunId: "",
  meeting: {
    id: "",
    isRunning: false,
    round: "",
    messages: [],
    participants: [],
    abortController: null,
    jobId: "",
    stopped: false,
  },
  briefing: {
    active: false,
    jobId: "",
    participants: [],
    startedAt: 0,
    minSeconds: 22,
  },
};

const els = {
  runtime: document.getElementById("runtime-status"),
  refresh: document.getElementById("refresh-btn"),
  agents: document.getElementById("agent-list"),
  agentCount: document.getElementById("agent-count"),
  agentForm: document.getElementById("agent-form"),
  meetingForm: document.getElementById("meeting-form"),
  jobs: document.getElementById("job-list"),
  projects: document.getElementById("project-list"),
  projectCount: document.getElementById("project-count"),
  reportTitle: document.getElementById("report-title"),
  reportMeta: document.getElementById("report-meta"),
  reportView: document.getElementById("report-view"),
  officeScene: document.getElementById("office-scene"),
  sceneStatus: document.getElementById("scene-status"),
  employeeLegend: document.getElementById("employee-legend"),
  selectedAgentTitle: document.getElementById("selected-agent-title"),
  selectedAgentStatus: document.getElementById("selected-agent-status"),
  agentChatLog: document.getElementById("agent-chat-log"),
  agentChatForm: document.getElementById("agent-chat-form"),
  agentChatInput: document.getElementById("agent-chat-input"),
  meetingLog: document.getElementById("meeting-log"),
  meetingLogStatus: document.getElementById("meeting-log-status"),
  stopMeeting: document.getElementById("stop-meeting-btn"),
};

const officeAgents = [
  { id: "literature", label: "Literature", role: "戴眼镜研究员", screen: "literature", trait: "glasses", color: 0x8bc47c, x: -3.15, z: -4.05, yaw: 0.04 },
  { id: "paper", label: "Paper", role: "学术分析师", screen: "paper", trait: "papers", color: 0xff3d24, x: 1.55, z: -4.05, yaw: -0.04 },
  { id: "bio", label: "Bio", role: "生信工程师", screen: "bio", trait: "bio", color: 0x6324f6, x: -3.15, z: -0.75, yaw: 0.04 },
  { id: "coding", label: "Coding", role: "程序员", screen: "coding", trait: "coder", color: 0x2f8cff, x: 1.55, z: -0.75, yaw: -0.04 },
  { id: "main", label: "Main", role: "主持人", screen: "main", trait: "host", color: 0xffd64d, x: -3.15, z: 2.95, yaw: 0.04 },
  { id: "vacant", label: "待入职", role: "空工位", screen: "vacant", trait: "vacant", color: 0xb9c4c1, x: 1.55, z: 2.95, yaw: -0.04, vacant: true },
];

const WORKSTATION_ANCHORS = {
  seated: new THREE.Vector3(0, 1.15, 0.74),
  sideStandX: 1.15,
  sideStandZ: 1.15,
  sideClearance: 1.75,
};

// ── Waypoint Graph ──
// All nodes at y=0.735 for character body center
const WAYPOINT_Y = 0.735;
function wp(x, z) { return new THREE.Vector3(x, WAYPOINT_Y, z); }
const WAYPOINTS = [
  // Corridor (z=0 main walkway, left to right)
  wp(-10.0, 0),    // 0:  meeting room entrance
  wp(-7.0, 0),     // 1
  wp(-5.5, 0),     // 2:  connects to meeting room
  wp(-3.0, 0),     // 3
  wp(0, 0),        // 4
  wp(2.0, 0),      // 5
  wp(4.0, 0),      // 6
  wp(6.0, 0),      // 7
  wp(8.0, 0),      // 8
  wp(10.75, 0),    // 9:  corridor end near door
  wp(11.8, 1.2),   // 10: outside, aligned with the real office door
  // Left desk column (x=-3.15)
  wp(-1.55, -4.05), // 11: safe approach for literature desk
  wp(-1.55, -0.75), // 12: safe approach for bio desk
  wp(-1.55, 2.95),  // 13: safe approach for main desk
  // Right desk column (x=1.55)
  wp(0.10, -4.05),  // 14: safe approach for paper desk
  wp(0.10, -0.75),  // 15: safe approach for coding desk
  wp(0.10, 2.95),   // 16: safe approach for vacant desk
  // Meeting room inside
  wp(-5.5, -4.0),  // 17: meeting door point
  wp(-8.25, -4.5), // 18: main seat (head of table)
  wp(-9.0, -2.25), // 19: literature
  wp(-7.5, -2.25), // 20: guest1
  wp(-9.0, -0.75), // 21: paper
  wp(-7.5, -0.75), // 22: guest2
  wp(-9.0, 0.75),  // 23: bio
  wp(-7.5, 0.75),  // 24: guest3
  wp(-9.0, 2.25),  // 25: coding
  wp(-7.5, 2.25),  // 26: guest4
  // Smoking room
  wp(9.15, -2.46), // 27: smoking room entrance
  wp(9.15, -4.5),  // 28: inside smoking room
  wp(8.2, -4.65),  // 29: smoking spot
  wp(9.05, -4.95), // 30: smoking spot
  wp(10.0, -4.75), // 31: smoking spot
  wp(8.8, -3.8),   // 32: smoking spot
  wp(10.25, -3.55),// 33: smoking spot
  // Door inner (transition between corridor and door leaf)
  wp(9.85, 1.2),   // 34: door inner point
  wp(10.75, 1.2),  // 35: door point
  // Clear office navigation aisle between workstation columns
  wp(-0.75, -4.75), // 36: north aisle
  wp(-0.75, -3.05), // 37: upper desk aisle
  wp(-0.75, -1.25), // 38: middle desk aisle
  wp(-0.75, 1.20),  // 39: lower desk aisle
  wp(-0.75, 3.75),  // 40: south aisle / Main patrol
  // Explicit meeting-room door approach, outside the glass wall
  wp(-4.55, -4.0),  // 41: meeting door approach from office
  // Wider Main patrol route points
  wp(3.4, 2.95),    // 42: east patrol point
  wp(7.7, 1.4),     // 43: near entry patrol point
  wp(6.8, -1.9),    // 44: smoking-room side patrol point
];
const C = WAYPOINTS; // shorthand
// Define edges (undirected) — each entry is [indexA, indexB]
const EDGES = [
  // Corridor chain
  [0,1],[1,2],[2,3],[3,4],[4,5],[5,6],[6,7],[7,8],[8,9],
  // Clear desk aisle, kept between the two workstation columns
  [3,38],[4,38],[5,38],
  [36,37],[37,38],[38,39],[39,40],
  [36,11],[38,12],[40,13],
  [36,14],[38,15],[40,16],
  // Corridor to meeting room through the actual door opening
  [2,41],[3,41],[41,17],
  // Meeting room interior: enter via right-side aisle, then move into fixed seats.
  [17,20],
  // Meeting room table chain (left side)
  [19,21],[21,23],[23,25],
  // Meeting room table chain (right side)
  [20,22],[22,24],[24,26],
  // Meeting room table cross connects at each row
  [18,20],[19,20],[21,22],[23,24],[25,26],
  // Corridor to smoking room
  [8,27],
  // Smoking room interior (entrance to inside)
  [27,28],
  // Smoking room spots
  [28,29],[28,30],[28,31],[28,32],[28,33],
  // Smoking spots chain
  [29,30],[30,31],[31,33],[33,32],[32,29],
  // Door transition (corridor to door inner)
  [9,34],
  // Door inner to door point
  [34,35],
  // Door point to outside
  [35,10],
  // Main patrol loop, away from desks and glass
  [39,42],[42,43],[43,44],[44,8],[42,6],
];

// Build adjacency list
function buildGraph() {
  const adj = Array.from({ length: WAYPOINTS.length }, () => []);
  for (const [a, b] of EDGES) {
    const dist = WAYPOINTS[a].distanceTo(WAYPOINTS[b]);
    adj[a].push({ to: b, dist });
    adj[b].push({ to: a, dist });
  }
  return adj;
}
const ADJ = buildGraph();

// Dijkstra shortest path
function dijkstra(startIdx, endIdx) {
  const n = WAYPOINTS.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const visited = new Uint8Array(n);
  dist[startIdx] = 0;
  for (let i = 0; i < n; i++) {
    let u = -1;
    let best = Infinity;
    for (let j = 0; j < n; j++) {
      if (!visited[j] && dist[j] < best) { best = dist[j]; u = j; }
    }
    if (u === -1 || u === endIdx) break;
    visited[u] = 1;
    for (const { to, dist: w } of ADJ[u]) {
      const nd = dist[u] + w;
      if (nd < dist[to]) { dist[to] = nd; prev[to] = u; }
    }
  }
  // Reconstruct path
  const path = [];
  let cur = endIdx;
  while (cur !== -1) {
    path.push(cur);
    cur = prev[cur];
  }
  path.reverse();
  if (path.length < 2 || path[0] !== startIdx) return null;
  return path;
}

// Find nearest waypoint index to a position
function nearestWaypoint(pos) {
  let bestIdx = 0;
  let bestDist = Infinity;
  for (let i = 0; i < WAYPOINTS.length; i++) {
    const d = pos.distanceToSquared(WAYPOINTS[i]);
    if (d < bestDist) { bestDist = d; bestIdx = i; }
  }
  return bestIdx;
}

// Find path from start to end using Dijkstra
function findPath(startPos, endPos) {
  const startIdx = nearestWaypoint(startPos);
  const endIdx = nearestWaypoint(endPos);
  const idxPath = dijkstra(startIdx, endIdx);
  if (!idxPath || idxPath.length < 2) {
    // Fallback: direct connection
    return [startPos.clone(), endPos.clone()];
  }
  return idxPath.map(i => WAYPOINTS[i].clone());
}

function buildDirectPath(fromPos, toPos) {
  const path = [fromPos.clone()];
  const graphPath = findPath(fromPos, toPos);
  if (graphPath.length >= 2) {
    const firstPoint = graphPath[0];
    if (firstPoint.distanceToSquared(fromPos) < 1.0) {
      for (let i = 1; i < graphPath.length; i += 1) path.push(graphPath[i]);
    } else {
      for (const point of graphPath) path.push(point);
    }
  } else {
    path.push(toPos.clone());
  }
  return path;
}

function safePathToDesk(group, fromPos) {
  if (group?.pathFromDoor && fromPos.distanceToSquared(OUTSIDE_POINT) < 1.2) {
    return group.pathFromDoor.map(p => p.clone());
  }
  const approach = C[DESK_TO_WAYPOINT[group?.agent?.id] ?? 38];
  const graphPath = findPath(fromPos, approach);
  return [fromPos.clone(), ...graphPath.slice(1).map(p => p.clone()), group.standingPos.clone()];
}

function safePathFromCurrent(group, fromPos, toPos) {
  const graphPath = findPath(fromPos, toPos);
  return [fromPos.clone(), ...graphPath.slice(1).map(p => p.clone())];
}

// Check if a path goes through a door
function pathHasEntryDoor(path) {
  return path.some(p => p.distanceToSquared(C[34]) < 0.5 || p.distanceToSquared(C[35]) < 0.5);
}

// Find the door-waypoint index in the path (where character should trigger door)
function findDoorWpIdx(path, doorWp) {
  for (let i = 0; i < path.length; i++) {
    if (path[i].distanceToSquared(doorWp) < 0.5) return i;
  }
  return -1;
}

// ── Door Animation System ──
const DOOR_CONFIG = {
  entry: {
    pivotPos: new THREE.Vector3(10.72, 0, 0.58),
    leafOffset: new THREE.Vector3(0, 0, 0.04),
    maxAngle: -1.2,
    speed: 0.03,
    swingDir: -1,
    triggerPos: C[34], // door inner point
  },
  meeting: {
    pivotPos: new THREE.Vector3(-5.50, 0, -4.5),
    leafOffset: new THREE.Vector3(0, 0, 0.04),
    maxAngle: -1.2,
    speed: 0.03,
    swingDir: -1,
    triggerPos: C[17], // meeting room door point
  },
};

// Runtime door state (populated when doors are created)
const doorState = {
  entry: { group: null, angle: 0, target: 0, state: 'closed' },
  meeting: { group: null, angle: 0, target: 0, state: 'closed' },
};

// Desk id to nearest desk-column waypoint index (front of desk)
const DESK_TO_WAYPOINT = {
  literature: 11,
  paper: 14,
  bio: 12,
  coding: 15,
  main: 13,
  vacant: 16,
};

// Door waypoint indices for detection during walking
const ENTRY_DOOR_WP_IDX = 34; // door inner point
const MEETING_DOOR_WP_IDX = 17; // meeting room door point

const meetingSlots = {
  main: new THREE.Vector3(-8.25, 0.735, -3.5),
  literature: new THREE.Vector3(-9.0, 0.735, -2.25),
  paper: new THREE.Vector3(-9.0, 0.735, -0.75),
  bio: new THREE.Vector3(-9.0, 0.735, 0.75),
  coding: new THREE.Vector3(-9.0, 0.735, 2.25),
  guest1: new THREE.Vector3(-7.5, 0.735, -2.25),
  guest2: new THREE.Vector3(-7.5, 0.735, -0.75),
  guest3: new THREE.Vector3(-7.5, 0.735, 0.75),
  guest4: new THREE.Vector3(-7.5, 0.735, 2.25),
};

const MEETING_ROOM_ENTRANCE = new THREE.Vector3(-5.5, 0.735, -4.0);
const MEETING_ROOM_CENTER = new THREE.Vector3(-8.25, 0.735, 0);
const SMOKING_ROOM_ENTRANCE = new THREE.Vector3(9.15, 0.735, -2.46);
const DOOR_INNER_POINT = new THREE.Vector3(9.85, 0.735, 1.2);
const DOOR_POINT = new THREE.Vector3(10.75, 0.735, 1.2);
const OUTSIDE_POINT = new THREE.Vector3(11.8, 0.735, 1.2);
const smokingSpots = [
  new THREE.Vector3(8.2, 0.735, -4.65),
  new THREE.Vector3(9.05, 0.735, -4.95),
  new THREE.Vector3(10.0, 0.735, -4.75),
  new THREE.Vector3(8.8, 0.735, -3.8),
  new THREE.Vector3(10.25, 0.735, -3.55),
];
const mainPatrolSpots = [
  C[40].clone(),
  C[42].clone(),
  C[43].clone(),
  C[44].clone(),
  C[8].clone(),
];

// ── 24h AI Office Behavior System ──
let _mainPositionForBio = null;
const OFFICE_BEHAVIOR_STATES = Object.freeze({
  WORKING: "working",
  MEETING: "meeting",
  BREAK: "break",
  SMOKING: "smoking",
  GAMING: "gaming",
  AWAY: "away",
  RETURNING: "returning",
});

const CROWDING_PHASES = new Set([
  "standingUp",
  "goingDesk",
  "goingDoor",
  "comingBack",
  "goingMeeting",
  "returnFromMeeting",
  "goingSmoke",
  "returnFromSmoke",
  "goingPatrol",
  "atPatrol",
  "returnFromPatrol",
]);
const WALKING_PHASES = new Set([
  "goingDesk",
  "goingDoor",
  "comingBack",
  "goingMeeting",
  "returnFromMeeting",
  "goingSmoke",
  "returnFromSmoke",
  "goingPatrol",
  "returnFromPatrol",
]);

const AGENT_BEHAVIOR_CONFIG = Object.freeze({
  main: {
    persona: "主管，永远不离开办公室，主要在工位盯 Dashboard",
    screens: ["Dashboard", "Agent 状态", "任务进度"],
    neverAway: true,
    minSmokeSeconds: 26,
    probabilities: {
      day: { working: 0.78, smoking: 0.12, break: 0.07, meeting: 0.03 },
      evening: { working: 0.76, smoking: 0.14, break: 0.08, meeting: 0.02 },
      night: { working: 0.78, smoking: 0.10, break: 0.12 },
    },
  },
  literature: {
    persona: "文献员，大部分时间查文献",
    screens: ["PubMed", "arXiv", "PDF", "Search"],
    probabilities: {
      day: { working: 0.90, break: 0.04, smoking: 0.02, meeting: 0.03, away: 0.01 },
      evening: { working: 0.68, break: 0.04, smoking: 0.02, away: 0.26 },
      night: { away: 0.86, working: 0.12, break: 0.02 },
    },
  },
  paper: {
    persona: "论文分析员，看 PDF 和做批注",
    screens: ["PDF", "Review", "Annotating"],
    probabilities: {
      day: { working: 0.91, break: 0.03, smoking: 0.02, meeting: 0.03, away: 0.01 },
      evening: { working: 0.64, break: 0.04, smoking: 0.02, away: 0.30 },
      night: { away: 0.88, working: 0.10, break: 0.02 },
    },
  },
  bio: {
    persona: "摸鱼型生信员，Main 靠近时自动切回 RStudio",
    screens: ["RStudio", "Seurat", "CellChat"],
    gameScreens: ["Steam", "Minecraft", "LOL", "Bilibili"],
    probabilities: {
      day: { working: 0.70, gaming: 0.17, break: 0.03, smoking: 0.02, meeting: 0.03, away: 0.05 },
      evening: { working: 0.52, gaming: 0.20, break: 0.03, smoking: 0.02, away: 0.23 },
      night: { away: 0.76, gaming: 0.12, working: 0.10, break: 0.02 },
    },
  },
  coding: {
    persona: "程序员，晚上更活跃",
    screens: ["VS Code", "Terminal", "GitHub", "Error", "Fix"],
    probabilities: {
      day: { working: 0.84, break: 0.04, smoking: 0.02, meeting: 0.02, away: 0.08 },
      evening: { working: 0.86, break: 0.04, smoking: 0.03, away: 0.07 },
      night: { working: 0.50, break: 0.03, smoking: 0.02, away: 0.45 },
    },
  },
});

const OFFICE_TIME_ZONE = "Asia/Shanghai";
const OFFICE_TIME_FORMATTER = new Intl.DateTimeFormat("en-US", {
  timeZone: OFFICE_TIME_ZONE,
  hour12: false,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

function getBeijingTimeParts(date = new Date()) {
  const parts = Object.fromEntries(
    OFFICE_TIME_FORMATTER.formatToParts(date).map((part) => [part.type, part.value])
  );
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  const second = Number(parts.second);
  return {
    hour,
    minute,
    second,
    hourFloat: hour + minute / 60 + second / 3600,
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    blockKey: `${parts.year}-${parts.month}-${parts.day}:${String(hour).padStart(2, "0")}:${Math.floor(minute / 30)}`,
    label: `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")}`,
  };
}

function getOfficeHour(timeParts = getBeijingTimeParts()) {
  return timeParts.hourFloat;
}

function getTimePeriod(officeHour) {
  if (officeHour >= 8 && officeHour < 18) return "day";
  if (officeHour >= 18 && officeHour < 24) return "evening";
  return "night";
}

function hashNoise(text) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 100000) / 100000;
}

function weightedChoice(weights, seed) {
  const entries = Object.entries(weights || {});
  if (!entries.length) return OFFICE_BEHAVIOR_STATES.WORKING;
  const total = entries.reduce((sum, [, value]) => sum + Math.max(0, value), 0) || 1;
  let r = hashNoise(seed) * total;
  for (const [stateName, rawWeight] of entries) {
    r -= Math.max(0, rawWeight);
    if (r <= 0) return stateName;
  }
  return entries[entries.length - 1][0];
}

function getAgentBehavior(agentId) {
  return AGENT_BEHAVIOR_CONFIG[agentId] || {
    persona: "通用 Agent",
    screens: ["Work"],
    probabilities: {
      day: { working: 0.8, break: 0.1, away: 0.1 },
      evening: { working: 0.45, break: 0.08, away: 0.47 },
      night: { away: 0.85, working: 0.15 },
    },
  };
}

function shouldTakeHalfDayOff(agentId, officeHour, dateKey) {
  if (agentId === "main") return false;
  if (officeHour < 8 || officeHour >= 18) return false;
  return hashNoise(`${agentId}:half-day:${dateKey}`) < 0.04;
}

function isOfficeMeetingTime(timeParts) {
  const minutes = timeParts.minute;
  const hour = timeParts.hour;
  return (hour === 10 && minutes >= 15 && minutes < 45) ||
    (hour === 15 && minutes >= 0 && minutes < 30);
}

function isSmokingBreakTime(timeParts, agentId) {
  const minutes = timeParts.minute;
  const hour = timeParts.hour;
  const inWindow = (h, start, end) => hour === h && minutes >= start && minutes < end;
  if (agentId === "main") {
    return inWindow(9, 30, 58) || inWindow(13, 10, 38) || inWindow(17, 20, 50) || inWindow(21, 10, 38);
  }
  if (["bio", "coding"].includes(agentId)) {
    return inWindow(16, 10, 32) || inWindow(22, 20, 42);
  }
  if (["literature", "paper"].includes(agentId)) {
    return inWindow(11, 25, 45);
  }
  return false;
}

function getActivity(timeParts, agentId) {
  const behavior = getAgentBehavior(agentId);
  const officeHour = getOfficeHour(timeParts);
  const period = getTimePeriod(officeHour);
  if (!behavior.neverAway && shouldTakeHalfDayOff(agentId, officeHour, timeParts.dateKey)) {
    return OFFICE_BEHAVIOR_STATES.AWAY;
  }
  if (isSmokingBreakTime(timeParts, agentId)) {
    return OFFICE_BEHAVIOR_STATES.SMOKING;
  }
  const weights = behavior.probabilities[period] || behavior.probabilities.day;
  return weightedChoice(weights, `${agentId}:${period}:${timeParts.blockKey}`);
}

function nextPatrolSpot(group) {
  const spots = group?.patrolSpots || mainPatrolSpots;
  const index = group?.patrolIndex || 0;
  const spot = spots[index % spots.length].clone();
  if (group) group.patrolIndex = (index + 1) % spots.length;
  return spot;
}

// Meeting seat assignment (fixed after init)
const MEETING_HEAD_SLOT = "main";
const USER_MEETING_SLOT = "main";
const MAIN_MEETING_SLOT = "guest1";
const MEETING_SEAT_ASSIGNMENT = buildFixedMeetingSeatAssignment();

function buildFixedMeetingSeatAssignment() {
  const slots = ["literature", "paper", "bio", "coding", "guest2", "guest3", "guest4"];
  const agents = ["literature", "paper", "bio", "coding"];
  const shuffled = slots
    .map((slot) => ({ slot, score: hashNoise(`meeting-seat:${slot}`) }))
    .sort((a, b) => a.score - b.score)
    .map((item) => item.slot);
  const assignment = { main: MAIN_MEETING_SLOT };
  agents.forEach((agentId, index) => {
    assignment[agentId] = shuffled[index];
  });
  return assignment;
}

// Map meeting slot name to which agent sits there
function buildSeatMap() {
  const m = {};
  for (const [agentId, slotName] of Object.entries(MEETING_SEAT_ASSIGNMENT)) {
    m[slotName] = agentId;
  }
  m[USER_MEETING_SLOT] = "user";
  return m;
}
// The 'main' slot (head seat) stays empty — Main agent uses a side seat
const MEETING_HEAD_EMPTY = true;

async function api(path, options = {}) {
  const res = await fetch(path, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      ...(options.headers || {}),
    },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : {};
  if (!res.ok) {
    throw new Error(data.error || `HTTP ${res.status}`);
  }
  return data;
}

async function loadAll() {
  await Promise.all([loadHealth(), loadAgents(), loadProjects(), loadJobs()]);
}

async function loadHealth() {
  const data = await api("/api/health");
  const openclaw = data.openclaw || {};
  const status = openclaw.configured_exists || openclaw.path_executable
    ? "OpenClaw 已检测到，工作台就绪"
    : "未检测到 openclaw，可先配置 OpenClaw 后再运行会议";
  els.runtime.textContent = status;
}

async function loadAgents() {
  const data = await api("/api/agents");
  const agents = data.agents || [];
  state.agentsData = agents.map((agent) => ({
    id: agent.id || agent.agent_id,
    name: agent.name || agent.identityName || agent.agent_id || agent.id,
    role: agent.role || "",
    status: (agent.id || agent.agent_id) === state.activeAgent ? "meeting" : "idle",
    persona: agent.description || (agent.responsibilities || []).join(" / "),
    position: officeAgents.find((item) => item.id === (agent.id || agent.agent_id))
      ? { x: officeAgents.find((item) => item.id === (agent.id || agent.agent_id)).x, z: officeAgents.find((item) => item.id === (agent.id || agent.agent_id)).z }
      : null,
    chatHistory: state.agentChats[agent.id || agent.agent_id] || [],
    registered: Boolean(agent.registered),
    openclaw_exists: Boolean(agent.openclaw_exists),
    source: agent.source || "openclaw",
    model: agent.model || "",
  }));
  if (!state.selectedAgentId && state.agentsData.length) {
    state.selectedAgentId = state.agentsData.find((agent) => agent.id !== "main")?.id || state.agentsData[0].id;
  }
  els.agentCount.textContent = String(agents.length);
  renderAgentSidebar();
  renderAgentChat();
  syncOfficeLabels(agents);
}

function renderAgentSidebar() {
  els.agents.innerHTML = "";
  for (const agent of state.agentsData) {
    const inMeeting = state.meeting.isRunning && state.meeting.participants.includes(agent.id);
    const status = inMeeting ? "meeting" : agent.id === state.activeAgent ? "working" : "idle";
    const item = document.createElement("article");
    item.className = `agent-item ${agent.id === state.selectedAgentId ? "selected" : ""}`;
    item.dataset.agentId = agent.id;
    item.innerHTML = `
      <div class="agent-status-line">
        <strong>${escapeHtml(agent.name)}</strong>
        <span class="pill ${status === "meeting" ? "gold" : status === "working" ? "blue" : ""}">${escapeHtml(status)}</span>
      </div>
      <span>${escapeHtml(agent.id)} · ${escapeHtml(agent.role)}</span>
      <div class="pill-row">
        <span class="pill ${agent.registered ? "" : "gold"}">${agent.registered ? "registered" : "discovered"}</span>
        <span class="pill ${agent.openclaw_exists ? "blue" : "danger"}">${agent.openclaw_exists ? "openclaw" : "config only"}</span>
        <span class="pill ${inMeeting ? "gold" : ""}">${inMeeting ? "会议中" : "未参会"}</span>
      </div>
    `;
    item.addEventListener("click", () => selectAgent(agent.id));
    els.agents.appendChild(item);
  }
}

function selectAgent(agentId) {
  state.selectedAgentId = agentId;
  renderAgentSidebar();
  renderAgentChat();
}

function appendAgentChat(agentId, message) {
  if (!state.agentChats[agentId]) state.agentChats[agentId] = [];
  const entry = {
    role: message.role || "user",
    content: message.content || "",
    timestamp: message.timestamp || new Date().toISOString(),
    agentId,
  };
  state.agentChats[agentId].push(entry);
  state.agentChats[agentId] = state.agentChats[agentId].slice(-120);
  if (agentId === state.selectedAgentId) renderAgentChat();
}

function renderAgentChat() {
  const agent = state.agentsData.find((item) => item.id === state.selectedAgentId);
  if (!agent) {
    if (els.selectedAgentTitle) els.selectedAgentTitle.textContent = "Agent 聊天";
    if (els.selectedAgentStatus) els.selectedAgentStatus.textContent = "未选择";
    if (els.agentChatLog) els.agentChatLog.innerHTML = `<article class="chat-message system"><div class="message-content">请选择左侧 Agent。</div></article>`;
    return;
  }
  const inMeeting = state.meeting.isRunning && state.meeting.participants.includes(agent.id);
  els.selectedAgentTitle.textContent = `${agent.name} · 单独聊天`;
  els.selectedAgentStatus.textContent = inMeeting ? "会议中" : "idle";
  const messages = state.agentChats[agent.id] || [];
  els.agentChatLog.innerHTML = messages.length ? messages.map(renderChatMessage).join("") :
    `<article class="chat-message system"><div class="message-content">暂无聊天记录，可以直接给 ${escapeHtml(agent.name)} 发消息。</div></article>`;
  els.agentChatLog.scrollTop = els.agentChatLog.scrollHeight;
}

function renderChatMessage(message) {
  return `
    <article class="chat-message ${escapeHtml(message.role)}">
      <div class="message-meta">
        <strong>${escapeHtml(message.role)}</strong>
        <span>${formatTime(message.timestamp)}</span>
      </div>
      <div class="message-content">${escapeHtml(message.content)}</div>
    </article>
  `;
}

function markdownToHtml(markdown) {
  return escapeHtml(markdown || "")
    .replace(/^### (.*)$/gm, "<h4>$1</h4>")
    .replace(/^## (.*)$/gm, "<h3>$1</h3>")
    .replace(/^# (.*)$/gm, "<h2>$1</h2>")
    .replace(/\*\*(.*?)\*\*/g, "<strong>$1</strong>")
    .replace(/\n/g, "<br>");
}

function appendMeetingMessage(meetingId, agentId, content, role = "assistant", timestamp = new Date().toISOString()) {
  if (state.meeting.stopped && meetingId === state.meeting.id && role !== "system") return;
  const agent = state.agentsData.find((item) => item.id === agentId);
  const entry = {
    meetingId,
    agentId,
    agentName: agent?.name || agentId || "System",
    role,
    content,
    timestamp,
  };
  state.meeting.messages.push(entry);
  state.meeting.messages = state.meeting.messages.slice(-240);
  renderMeetingLog();
}

function renderMeetingLog() {
  if (!els.meetingLog) return;
  els.meetingLogStatus.textContent = state.meeting.isRunning
    ? `运行中 · ${state.meeting.messages.length} 条`
    : state.meeting.stopped ? "会议已终止" : `${state.meeting.messages.length} 条记录`;
  els.meetingLog.innerHTML = state.meeting.messages.length ? state.meeting.messages.map((message) => {
    const color = officeAgents.find((agent) => agent.id === message.agentId)?.color || 0x1f7a68;
    return `
      <article class="meeting-message ${escapeHtml(message.role)}" style="border-left-color:#${color.toString(16).padStart(6, "0")}">
        <div class="message-meta">
          <strong>${escapeHtml(message.agentName)}</strong>
          <span>${formatTime(message.timestamp)}</span>
        </div>
        <div class="message-content">${escapeHtml(message.content)}</div>
      </article>
    `;
  }).join("") : `<article class="meeting-message system"><div class="message-content">暂无会议记录。</div></article>`;
  els.meetingLog.scrollTop = els.meetingLog.scrollHeight;
}

function formatTime(timestamp) {
  const date = timestamp ? new Date(timestamp) : new Date();
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

async function loadProjects() {
  const data = await api("/api/projects");
  state.projects = data.projects || [];
  els.projectCount.textContent = String(state.projects.length);
  els.projects.innerHTML = "";
  for (const project of state.projects) {
    const item = document.createElement("article");
    item.className = "project-item";
    item.innerHTML = `
      <strong>${escapeHtml(project.goal || project.project_id)}</strong>
      <span>${escapeHtml(project.project_id)} · ${(project.team || []).join(", ")}</span>
      <div class="pill-row">
        <span class="pill ${project.has_report ? "blue" : "gold"}">${project.has_report ? "report" : "running"}</span>
        ${project.has_report ? `<button class="mini-action" data-report-project="${escapeHtml(project.project_id)}" type="button">查看报告</button>` : ""}
      </div>
    `;
    const reportButton = item.querySelector("[data-report-project]");
    if (reportButton) {
      reportButton.addEventListener("click", (event) => {
        event.stopPropagation();
        showProjectReport(project.project_id);
      });
    }
    item.addEventListener("click", () => showProject(project.project_id));
    els.projects.appendChild(item);
  }
}

async function loadJobs() {
  const [jobsData, queueData] = await Promise.all([api("/api/jobs"), api("/api/run-queue")]);
  const jobs = jobsData.jobs || [];
  state.runQueue = queueData.runQueue || [];
  els.jobs.innerHTML = "";
  if (!jobs.length) {
    els.jobs.innerHTML = `<article class="job-item"><span>暂无运行队列。</span></article>`;
    state.taskActive = false;
    state.meeting.isRunning = false;
    els.stopMeeting.disabled = true;
    renderAgentSidebar();
    renderMeetingLog();
    return;
  }
  for (const job of jobs) {
    const item = document.createElement("article");
    item.className = "job-item";
    const statusClass = job.status === "done" ? "blue" : job.status === "error" ? "danger" : "gold";
    const created = formatTime(job.created_at);
    item.innerHTML = `
      <strong>${escapeHtml(job.goal)}</strong>
      <span>${escapeHtml(job.job_id)} · ${created}</span>
      <div class="pill-row">
        <span class="pill ${statusClass}">${escapeHtml(job.status)}</span>
        <span class="pill">${escapeHtml(job.search_mode)}</span>
        <span class="pill">${escapeHtml(job.search_backend)}</span>
        <span class="pill">rounds ${escapeHtml(job.rounds || 1)}</span>
        ${(job.participants || []).map((agentId) => `<span class="pill">${escapeHtml(agentId)}</span>`).join("")}
        ${job.report_path && job.project_id ? `<button class="mini-action" data-report-project="${escapeHtml(job.project_id)}" type="button">查看报告</button>` : ""}
      </div>
    `;
    const reportButton = item.querySelector("[data-report-project]");
    if (reportButton) {
      reportButton.addEventListener("click", (event) => {
        event.stopPropagation();
        showProjectReport(job.project_id);
      });
    }
    if (job.project_id) {
      item.style.cursor = "pointer";
      item.addEventListener("click", () => showRunItem(job.job_id));
    } else {
      item.addEventListener("click", () => showRunItem(job.job_id));
    }
    els.jobs.appendChild(item);
  }
  syncOfficeFromJobs(jobs);
}

function showRunItem(runId) {
  const item = state.runQueue.find((run) => run.id === runId);
  if (!item) return;
  state.selectedRunId = runId;
  els.meetingLogStatus.innerHTML = `${escapeHtml(item.title)} · ${escapeHtml(item.status)} ${item.status === "running" ? `<button class="mini-action danger-mini" id="run-stop-btn" type="button">一键终止会议</button>` : ""}`;
  const logsHtml = (item.logs || []).map((log) => `
    <article class="meeting-message system">
      <div class="message-meta"><strong>${escapeHtml(log.title || log.type || "log")}</strong><span>${formatTime(log.createdAt)}</span></div>
      <div class="message-content">${escapeHtml(log.content || log.phase || "")}</div>
    </article>
  `).join("");
  const messagesHtml = (item.messages || []).map((message) => `
    <article class="meeting-message assistant">
      <div class="message-meta"><strong>${escapeHtml(message.agentId || "agent")}</strong><span>${formatTime(message.createdAt)}</span></div>
      <div class="message-content">${escapeHtml(message.content || message.title || "")}</div>
    </article>
  `).join("");
  const resultHtml = item.finalResult ? `
    <article class="meeting-message report-preview">
      <div class="message-meta">
        <strong>最终结果</strong>
        <button class="mini-action" id="copy-result-btn" type="button">复制</button>
        ${item.projectId ? `<button class="mini-action" data-popup-report="${escapeHtml(item.projectId)}" type="button">弹出 HTML 报告</button>` : ""}
      </div>
      <div class="message-content report-content">${markdownToHtml(item.finalResult)}</div>
    </article>
  ` : "";
  const errorHtml = item.error ? `<article class="meeting-message system"><div class="message-content danger-text">${escapeHtml(item.error)}</div></article>` : "";
  els.meetingLog.innerHTML = `
    <article class="meeting-message system">
      <div class="message-content">参与 agents：${escapeHtml((item.participants || []).join(", ") || "自动选择")} · 当前轮次：${escapeHtml(item.currentRound || "-")} · 创建：${formatTime(item.createdAt)}</div>
    </article>
    ${logsHtml || `<article class="meeting-message system"><div class="message-content">暂无过程日志。</div></article>`}
    ${messagesHtml}
    ${resultHtml}
    ${errorHtml}
  `;
  document.getElementById("run-stop-btn")?.addEventListener("click", stopMeeting);
  document.getElementById("copy-result-btn")?.addEventListener("click", async () => {
    await navigator.clipboard?.writeText(item.finalResult || "");
  });
  document.querySelector("[data-popup-report]")?.addEventListener("click", (event) => {
    openReportPopup(event.currentTarget.dataset.popupReport);
  });
  els.meetingLog.scrollTop = 0;
}

async function showProject(projectId) {
  const data = await api(`/api/projects/${encodeURIComponent(projectId)}`);
  const meta = data.meta || {};
  const messages = data.messages || [];
  state.meeting.id = projectId;
  state.meeting.messages = [];
  for (const msg of messages) {
    state.meeting.messages.push({
      meetingId: projectId,
      agentId: msg.sender,
      agentName: msg.sender,
      role: msg.sender === "boss" ? "user" : "assistant",
      content: msg.content,
      timestamp: msg.created_at,
    });
  }
  renderMeetingLog();
  els.meetingLogStatus.innerHTML = `${escapeHtml(meta.goal || projectId)} · 历史记录 ${data.report ? `<button class="mini-action" id="inline-report-btn" type="button">查看最终报告</button>` : ""}`;
  const reportButton = document.getElementById("inline-report-btn");
  if (reportButton) reportButton.addEventListener("click", () => showProjectReport(projectId));
}

async function showProjectReport(projectId) {
  openReportPopup(projectId);
}

function openReportPopup(projectId) {
  if (!projectId) return;
  const url = `/api/projects/${encodeURIComponent(projectId)}/report.html`;
  const popup = window.open(url, `agent-report-${projectId}`, "width=1100,height=850,menubar=no,toolbar=no,location=no");
  if (!popup) window.open(url, "_blank", "noopener");
}

async function showProjectReportInline(projectId) {
  const data = await api(`/api/projects/${encodeURIComponent(projectId)}`);
  const meta = data.meta || {};
  const report = data.report || "";
  state.meeting.id = projectId;
  if (!report) {
    state.meeting.messages = [{
      meetingId: projectId,
      agentId: "main",
      agentName: "Main",
      role: "system",
      content: "这个项目还没有生成最终报告。",
      timestamp: new Date().toISOString(),
    }];
    renderMeetingLog();
    els.meetingLogStatus.textContent = `${meta.goal || projectId} · 暂无报告`;
    return;
  }
  els.meetingLogStatus.innerHTML = `${escapeHtml(meta.goal || projectId)} · 最终报告 <a class="mini-action" href="/api/projects/${encodeURIComponent(projectId)}/report" target="_blank" rel="noopener">新标签打开</a>`;
  els.meetingLog.innerHTML = `
    <article class="meeting-message report-preview">
      <div class="message-meta">
        <strong>最终报告</strong>
        <span>${escapeHtml(projectId)}</span>
      </div>
      <div class="message-content report-content">${markdownToHtml(report)}</div>
    </article>
  `;
  els.meetingLog.scrollTop = 0;
}

els.agentForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(els.agentForm);
  const payload = Object.fromEntries(form.entries());
  await api("/api/agents", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  els.agentForm.reset();
  await loadAgents();
});

els.meetingForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = new FormData(els.meetingForm);
  const payload = Object.fromEntries(form.entries());
  payload.participants = [];
  payload.rounds = Number(payload.rounds || 1);
  const abortController = new AbortController();
  const job = await api("/api/meetings", {
    method: "POST",
    body: JSON.stringify(payload),
    signal: abortController.signal,
  });
  state.meeting = {
    id: job.job_id,
    isRunning: true,
    round: "queued",
    messages: [],
    participants: [],
    abortController,
    jobId: job.job_id,
    stopped: false,
  };
  startTaskBriefing(job.job_id, officeAgents.filter((agent) => !agent.vacant).map((agent) => agent.id));
  els.stopMeeting.disabled = false;
  appendMeetingMessage(job.job_id, "main", "会议已启动，Main Agent 正在准备。", "system");
  setActiveAgent("main", "会议启动，Main Agent 正在准备");
  await loadJobs();
  startJobPolling();
});

els.refresh.addEventListener("click", loadAll);

els.agentChatForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const agentId = state.selectedAgentId;
  const content = els.agentChatInput.value.trim();
  if (!agentId || !content) return;
  els.agentChatInput.value = "";
  appendAgentChat(agentId, { role: "user", content });
  const pending = { role: "system", content: "正在等待 Agent 回复..." };
  appendAgentChat(agentId, pending);
  try {
    const data = await api(`/api/agents/${encodeURIComponent(agentId)}/chat`, {
      method: "POST",
      body: JSON.stringify({ message: content }),
    });
    state.agentChats[agentId].pop();
    appendAgentChat(agentId, data);
  } catch (error) {
    state.agentChats[agentId].pop();
    appendAgentChat(agentId, { role: "system", content: `发送失败：${error.message}` });
  }
});

els.stopMeeting.addEventListener("click", stopMeeting);

async function stopMeeting() {
  const jobId = state.meeting.jobId || state.selectedRunId;
  if (!jobId || state.meeting.stopped) return;
  state.meeting.stopped = true;
  state.meeting.isRunning = false;
  state.taskActive = false;
  finishTaskBriefing();
  state.meeting.abortController?.abort();
  els.stopMeeting.disabled = true;
  appendMeetingMessage(state.meeting.id, "main", "会议已终止。正在通知后端停止模型请求。", "system");
  try {
    await api(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
    appendMeetingMessage(state.meeting.id, "main", "后端已收到终止请求，当前 OpenClaw 子进程会被停止，后续 round 不再执行。", "system");
  } catch (error) {
    appendMeetingMessage(state.meeting.id, "main", `终止请求失败：${error.message}`, "system");
  }
  await loadJobs();
  setActiveAgent("", "会议已终止");
  renderAgentSidebar();
}

function startTaskBriefing(jobId, participants) {
  const unique = [...new Set(["main", ...(participants || [])])]
    .filter((agentId) => officeAgents.some((agent) => agent.id === agentId && !agent.vacant));
  state.briefing = {
    active: true,
    jobId,
    participants: unique,
    startedAt: state.office?.clock?.getElapsedTime?.() || 0,
    minSeconds: 22,
  };
  state.meeting.participants = unique;
}

function finishTaskBriefing() {
  if (!state.briefing.active) return;
  state.briefing.active = false;
  state.briefing.participants = [];
}

function startJobPolling() {
  if (state.jobsTimer) {
    clearInterval(state.jobsTimer);
  }
  state.jobsTimer = setInterval(async () => {
    await loadJobs();
    await loadProjects();
  }, 3500);
}

function initOfficeScene() {
  const container = els.officeScene;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf8faf9);
  const camera = new THREE.PerspectiveCamera(48, 1, 0.1, 100);
  camera.position.set(0, 9.4, 15.2);
  camera.lookAt(0, 0.6, 0);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const hemi = new THREE.HemisphereLight(0xffffff, 0xd6dedb, 1.9);
  scene.add(hemi);
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(-4, 8, 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  scene.add(key);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(22, 14),
    new THREE.MeshStandardMaterial({ color: 0xf1f4f3, roughness: 0.82 })
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  const backWall = new THREE.Mesh(
    new THREE.BoxGeometry(21.6, 3.5, 0.18),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88 })
  );
  backWall.position.set(0, 1.75, -6);
  backWall.receiveShadow = true;
  scene.add(backWall);

  // Left side wall (flush with back wall edge)
  const leftWall = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 3.5, 13.8),
    new THREE.MeshStandardMaterial({ color: 0xf5f7f6, roughness: 0.82 })
  );
  leftWall.position.set(-10.82, 1.75, 0.9);
  leftWall.castShadow = true;
  leftWall.receiveShadow = true;
  scene.add(leftWall);
  const rightWallMaterial = new THREE.MeshStandardMaterial({ color: 0xf5f7f6, roughness: 0.82 });
  for (const [z, length] of [[-2.72, 6.55], [4.42, 5.16]]) {
    const rightWall = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 3.5, length),
      rightWallMaterial
    );
    rightWall.position.set(10.82, 1.75, z);
    rightWall.castShadow = true;
    rightWall.receiveShadow = true;
    scene.add(rightWall);
  }
  const entryDoorOverWall = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 1.05, 1.35),
    rightWallMaterial
  );
  entryDoorOverWall.position.set(10.82, 2.98, 1.2);
  entryDoorOverWall.castShadow = true;
  entryDoorOverWall.receiveShadow = true;
  scene.add(entryDoorOverWall);
  for (const z of [0.52, 1.88]) {
    const entrySideWall = new THREE.Mesh(
      new THREE.BoxGeometry(0.18, 3.5, 0.16),
      rightWallMaterial
    );
    entrySideWall.position.set(10.82, 1.75, z);
    entrySideWall.castShadow = true;
    entrySideWall.receiveShadow = true;
    scene.add(entrySideWall);
  }

  addOfficeProps(scene);

  const groups = {};
  // Meeting point: sit around the meeting-room table
  function meetingSpot(agent) {
    const slotName = MEETING_SEAT_ASSIGNMENT[agent.id] || agent.id;
    return (meetingSlots[slotName] || new THREE.Vector3(agent.x, 0.735, 0.9)).clone();
  }

  function buildDirectPath(fromPos, toPos) {
    const path = [fromPos.clone()];
    const graphPath = findPath(fromPos, toPos);
    if (graphPath.length >= 2) {
      const firstGp = graphPath[0];
      if (firstGp.distanceToSquared(fromPos) < 1.0) {
        for (let i = 1; i < graphPath.length; i++) path.push(graphPath[i]);
      } else {
        for (const p of graphPath) path.push(p);
      }
    } else {
      path.push(toPos.clone());
    }
    return path;
  }

  function dedupePath(points) {
    const path = [];
    for (const point of points) {
      if (!point) continue;
      const clone = point.clone();
      if (!path.length || path[path.length - 1].distanceToSquared(clone) > 0.01) {
        path.push(clone);
      }
    }
    return path;
  }

  function pathFromDesk(agentId, standingWorldPos, endQ) {
    const approach = C[DESK_TO_WAYPOINT[agentId] ?? 38];
    const graphPath = findPath(approach, endQ);
    return dedupePath([standingWorldPos, approach, ...graphPath.slice(1)]);
  }

  function pathToDesk(agentId, startQ, standingWorldPos) {
    const approach = C[DESK_TO_WAYPOINT[agentId] ?? 38];
    const graphPath = findPath(startQ, approach);
    return dedupePath([startQ, ...graphPath.slice(1), standingWorldPos]);
  }

  function leavePath(agentId, standingWorldPos) {
    const approach = C[DESK_TO_WAYPOINT[agentId] ?? 38];
    const graphPath = findPath(approach, C[9]);
    return dedupePath([
      standingWorldPos,
      approach,
      ...graphPath.slice(1),
      C[34],
      C[35],
      OUTSIDE_POINT,
    ]);
  }

  function enterPath(agentId, standingWorldPos) {
    return pathToDesk(agentId, OUTSIDE_POINT, standingWorldPos);
  }

  // Reverse a path (for return trips)
  function reversePath(path) {
    return path.slice().reverse().map(p => p.clone());
  }

  let agentIndex = 0;
  for (const agent of officeAgents) {
    const group = createWorkstation(agent);
    groups[agent.id] = group;
    scene.add(group.root);
    if (!group.vacant) {
      // Compute seated/standing anchors separately so walking never starts inside furniture.
      const sitOffset = WORKSTATION_ANCHORS.seated.clone();
      sitOffset.applyQuaternion(group.root.quaternion);
      const sittingWorldPos = new THREE.Vector3(
        group.root.position.x + sitOffset.x,
        group.root.position.y + sitOffset.y,
        group.root.position.z + sitOffset.z
      );
      const sideSign = agent.x >= 0 ? -1 : 1;
      const standOffset = new THREE.Vector3(
        sideSign * WORKSTATION_ANCHORS.sideStandX,
        0.735,
        WORKSTATION_ANCHORS.sideStandZ
      );
      standOffset.applyQuaternion(group.root.quaternion);
      const standingWorldPos = new THREE.Vector3(
        group.root.position.x + standOffset.x,
        group.root.position.y + standOffset.y,
        group.root.position.z + standOffset.z
      );
      group.sittingPos = sittingWorldPos;
      group.standingPos = standingWorldPos;
      group.deskPos = sittingWorldPos.clone();
      group.doorPoint = DOOR_POINT.clone();
      group.outsidePoint = OUTSIDE_POINT.clone();
      
      // Pre-compute paths for this agent
      group.pathToDoor = leavePath(agent.id, standingWorldPos);
      group.pathFromDoor = enterPath(agent.id, standingWorldPos);
      const smokeSpot = smokingSpots[agentIndex % smokingSpots.length].clone();
      group.smokeSpot = smokeSpot;
      group.pathToSmoke = pathFromDesk(agent.id, standingWorldPos, smokeSpot);
      group.pathFromSmoke = pathToDesk(agent.id, smokeSpot, standingWorldPos);
      group.patrolSpots = mainPatrolSpots.map(p => p.clone());
      group.patrolIndex = agentIndex % mainPatrolSpots.length;
      
      // Pre-compute meeting paths (walk to main's desk area)
      const mSpot = meetingSpot(agent);
      group.meetingSpot = mSpot;
      group.pathToMain = pathFromDesk(agent.id, standingWorldPos, mSpot);
      group.pathFromMain = pathToDesk(agent.id, mSpot, standingWorldPos);
      
      // Create a single scene-level character rig
      const characterRig = new THREE.Group();
      characterRig.position.copy(sittingWorldPos);
      const mascot = createMascot(agent);
      characterRig.add(mascot);
      characterRig.userData = { mascot };
      scene.add(characterRig);
      group.characterRig = characterRig;
      
      // Hide the old desk-level workerRig
      if (group.workerRig) {
        group.workerRig.visible = false;
      }
      agentIndex += 1;
    }
  }

  state.office = { scene, camera, renderer, groups, clock: new THREE.Clock() };
  renderEmployeeLegend();

  const resize = () => {
    const rect = container.getBoundingClientRect();
    renderer.setSize(rect.width, rect.height, false);
    camera.aspect = rect.width / Math.max(rect.height, 1);
    camera.updateProjectionMatrix();
  };
  resize();
  window.addEventListener("resize", resize);
  animateOffice();
}

function createWorkstation(agent) {
  const root = new THREE.Group();
  root.position.set(agent.x, 0, agent.z);
  root.rotation.y = agent.yaw;

  const desk = new THREE.Mesh(
    new THREE.BoxGeometry(2.35, 0.18, 1.15),
    new THREE.MeshStandardMaterial({ color: 0xf5f7f6, roughness: 0.76 })
  );
  desk.position.set(0, 0.86, -0.15);
  desk.castShadow = true;
  desk.receiveShadow = true;
  root.add(desk);

  const drawer = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.72, 0.62),
    new THREE.MeshStandardMaterial({ color: 0xe8eceb, roughness: 0.78 })
  );
  drawer.position.set(0.78, 0.42, 0.16);
  drawer.castShadow = true;
  drawer.receiveShadow = true;
  root.add(drawer);

  for (const x of [-0.9, 0.9]) {
    const leg = new THREE.Mesh(
      new THREE.CylinderGeometry(0.035, 0.035, 0.86, 12),
      new THREE.MeshStandardMaterial({ color: 0xd5dcda, roughness: 0.7 })
    );
    leg.position.set(x, 0.43, -0.56);
    leg.castShadow = true;
    root.add(leg);
  }

  const chair = createOfficeChair();
  chair.position.set(0, 0.08, 0.9);
  root.add(chair);

  let monitor = null;
  let screenContent = null;
  let workerRig = null;
  let mascot = null;
  let coffeeCup = null;

  if (agent.vacant) {
    const sign = createDeskSign("待入职", agent.color);
    sign.position.set(0, 1.03, -0.12);
    root.add(sign);
  } else {
    const monitorStand = new THREE.Mesh(
      new THREE.BoxGeometry(0.12, 0.4, 0.1),
      new THREE.MeshStandardMaterial({ color: 0xcfd8d5 })
    );
    monitorStand.position.set(0, 1.22, -0.48);
    root.add(monitorStand);

    monitor = new THREE.Mesh(
      new THREE.BoxGeometry(1.28, 0.72, 0.06),
      new THREE.MeshStandardMaterial({ color: 0x202a33, roughness: 0.42, metalness: 0.08 })
    );
    monitor.position.set(0, 1.65, -0.5);
    monitor.castShadow = true;
    root.add(monitor);

    screenContent = createScreenContent(agent);
    screenContent.position.set(0, 1.65, -0.455);
    root.add(screenContent);

    // Keyboard on desk
    const keyboard = new THREE.Mesh(
      new THREE.BoxGeometry(0.60, 0.03, 0.22),
      new THREE.MeshStandardMaterial({ color: 0x2d3438, roughness: 0.6 })
    );
    keyboard.position.set(0, 0.96, 0.08);
    keyboard.castShadow = true;
    root.add(keyboard);
    // Key rows
    for (let r = 0; r < 4; r++) {
      for (let c = 0; c < 10; c++) {
        const key = new THREE.Mesh(
          new THREE.BoxGeometry(0.035, 0.012, 0.03),
          new THREE.MeshStandardMaterial({ color: 0x49545c, roughness: 0.5 })
        );
        key.position.set(-0.24 + c * 0.055, 0.98, 0.00 + r * 0.048);
        root.add(key);
      }
    }

    workerRig = new THREE.Group();
    workerRig.position.set(0, 1.02, 0.72);
    mascot = createMascot(agent);
    workerRig.add(mascot);
    root.add(workerRig);

    coffeeCup = createCoffeeCup();
    coffeeCup.position.set(-0.78, 0.99, -0.12);
    root.add(coffeeCup);
  }

  const plaque = new THREE.Mesh(
    new THREE.BoxGeometry(0.95, 0.22, 0.06),
    new THREE.MeshStandardMaterial({ color: agent.color, emissive: agent.color, emissiveIntensity: 0.08 })
  );
  plaque.position.set(0, 1.06, 0.82);
  root.add(plaque);



  const nameLabel = createBillboard(`${agent.label}\n${agent.role}`, {
    width: 1.55,
    height: 0.44,
    fontSize: 30,
    color: "#1b2428",
    background: "rgba(255,255,255,0.94)",
    accent: agent.color,
  });
  nameLabel.position.set(0, 2.33, 0.34);
  nameLabel.visible = false;
  root.add(nameLabel);

  const speechBubble = createBillboard("Thinking...", {
    width: 1.7,
    height: 0.72,
    fontSize: 28,
    color: "#122025",
    background: "rgba(255,255,255,0.96)",
    accent: agent.color,
  });
  speechBubble.position.set(0.1, 2.66, 0.1);
  speechBubble.scale.setScalar(0.01);
  speechBubble.visible = false;
  root.add(speechBubble);

  return {
    root,
    workerRig,
    mascot,
    monitor,
    plaque,

    screenContent,
    nameLabel,
    speechBubble,
    coffeeCup,
    baseY: root.position.y,
    baseX: root.position.x,
    baseZ: root.position.z,
    baseYaw: agent.yaw,
    workerBaseY: workerRig ? workerRig.position.y : 0,
    workerBaseX: workerRig ? workerRig.position.x : 0,
    workerBaseZ: workerRig ? workerRig.position.z : 0,
    idlePhase: Math.random() * 100,
    lastScreenUpdate: 0,
    vacant: Boolean(agent.vacant),
    agent,
    // === Smooth movement state ===
    move: {
      // Visual scale target and current (interpolated)
      scaleTarget: 1,
      scaleCurrent: 1,
      scaleSpeed: 0.08,
      // Ring glow intensity

      // Walk progress (0=at desk, 1=at gym)
      walkTarget: 0,
      walkProgress: 0,
      walkSpeed: 0.012,
      // Away walk offset (lerped)
      awayOffsetTarget: 0,
      awayOffsetCurrent: 0,
      awayOffsetSpeed: 0.035,
      // Last idle mode for detecting transitions
      prevIdleMode: null,
      // Monitor emissive
      monitorEmissiveTarget: 0,
      monitorEmissiveCurrent: 0,
      monitorEmissiveSpeed: 0.04,
      // Plaque glow
      plaqueGlowTarget: 0.08,
      plaqueGlowCurrent: 0.08,
      plaqueGlowSpeed: 0.06,
      // === Activity state machine ===
      // 'atDesk' | 'standingUp' | 'goingDesk' | 'sittingDown'
      // | 'goingDoor' | 'atOuting' | 'comingBack' | 'goingMeeting' | 'atMeeting'
      // | 'returnFromMeeting' | 'goingSmoke' | 'atSmoke' | 'returnFromSmoke'
      // | 'goingPatrol' | 'atPatrol' | 'returnFromPatrol'
      phase: 'atDesk',
      behaviorState: OFFICE_BEHAVIOR_STATES.WORKING,
      requestedState: OFFICE_BEHAVIOR_STATES.WORKING,
      // 0→1 for stand-up or sit-down animation progress
      sitAnim: 0,
      // Intended destination while standing up ('gym' or 'door')
      pendingDest: null,
      // Path waypoints (array of Vector3)
      path: [],
      pathIndex: 0,
      pathProgress: 0,
      pathSpeed: 0.0053 + hashNoise(`walk-speed:${agent.id}`) * 0.0018,
      // Timer for current activity (elapsed seconds when started)
      activityStart: 0,
      minDuration: 0,
      // Whether character is invisible (out of office)
      hidden: false,
    },
  };
}

function createOfficeChair() {
  const group = new THREE.Group();
  const frame = new THREE.MeshStandardMaterial({ color: 0xcbd4d1, roughness: 0.58 });
  const cushion = new THREE.MeshStandardMaterial({ color: 0xf7faf9, roughness: 0.78 });

  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.16, 0.68), cushion);
  seat.position.set(0, 0.48, 0);
  seat.castShadow = true;
  seat.receiveShadow = true;
  group.add(seat);

  const back = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.76, 0.12), cushion);
  back.position.set(0, 0.82, 0.34);
  back.rotation.x = 0;
  back.castShadow = true;
  group.add(back);

  for (const [x, z] of [[-0.32, -0.22], [0.32, -0.22], [-0.32, 0.24], [0.32, 0.24]]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.48, 10), frame);
    leg.position.set(x, 0.24, z);
    leg.castShadow = true;
    group.add(leg);
  }

  return group;
}

function createDeskSign(text, color) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 96;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#ffffff";
  roundRect(ctx, 8, 10, 240, 76, 14);
  ctx.fill();
  ctx.fillStyle = `#${color.toString(16).padStart(6, "0")}`;
  ctx.fillRect(20, 22, 8, 52);
  ctx.fillStyle = "#26343b";
  ctx.font = "700 28px system-ui, sans-serif";
  ctx.fillText(text, 48, 58);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const sign = new THREE.Mesh(
    new THREE.PlaneGeometry(0.82, 0.31),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, transparent: true, toneMapped: false })
  );
  sign.rotation.x = -0.18;
  return sign;
}

function createMascot(agent) {
  const group = new THREE.Group();
  const fallback = new THREE.Group();
  group.add(fallback);
  const color = agent.color;
  const palette = workerPalette(agent);
  const skin = new THREE.MeshStandardMaterial({ color: 0xf2c84b, roughness: 0.42 });
  const hair = new THREE.MeshStandardMaterial({ color: palette.hair, roughness: 0.62 });
  const shirt = new THREE.MeshStandardMaterial({ color: palette.shirt, roughness: 0.5 });
  const pants = new THREE.MeshStandardMaterial({ color: palette.pants, roughness: 0.55 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x1d252b, roughness: 0.55 });
  const accent = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.12, roughness: 0.42 });

  // Human-like torso: centered under head, proper front-to-back depth
  const chest = new THREE.Mesh(
    new THREE.BoxGeometry(0.40, 0.28, 0.24),
    shirt
  );
  chest.position.set(0, 0.16, 0.12);
  chest.castShadow = true;
  fallback.add(chest);
  
  const waist = new THREE.Mesh(
    new THREE.BoxGeometry(0.32, 0.24, 0.18),
    shirt
  );
  waist.position.set(0, -0.04, 0.08);
  waist.castShadow = true;
  fallback.add(waist);

  const collar = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.075, 18), skin);
  collar.position.set(0, 0.36, 0.08);
  collar.castShadow = true;
  fallback.add(collar);

  const head = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.34, 28), skin);
  head.position.set(0, 0.6, 0.08);
  head.castShadow = true;
  head.name = "head";
  fallback.add(head);

  const headStud = new THREE.Mesh(new THREE.CylinderGeometry(0.105, 0.105, 0.045, 24), skin);
  headStud.position.set(0, 0.795, 0.08);
  headStud.castShadow = true;
  fallback.add(headStud);

  addFace(head, palette);
  addHair(fallback, agent, hair);

  const rightArm = makeLegoArm(shirt, skin);
  rightArm.position.set(0.39, 0.12, 0.09);
  rightArm.rotation.z = -0.1;
  rightArm.name = "rightArm";
  fallback.add(rightArm);

  const leftArm = makeLegoArm(shirt, skin);
  leftArm.position.set(-0.39, 0.12, 0.09);
  leftArm.rotation.z = 0.1;
  leftArm.scale.x = -1;
  leftArm.name = "leftArm";
  fallback.add(leftArm);

  const rightLeg = makeLegoLeg(pants, dark);
  rightLeg.position.set(0.13, -0.48, 0.08);
  fallback.add(rightLeg);

  const leftLeg = makeLegoLeg(pants, dark);
  leftLeg.position.set(-0.13, -0.48, 0.08);
  fallback.add(leftLeg);

  addWorkerTrait(fallback, agent, accent, dark, head);
  group.userData = {
    fallback, head, rightArm, leftArm, rightLeg, leftLeg, avatarRoot: null,
    rightCigarette: rightArm.userData.cigaretteGroup,
  };
  return group;
}

function makeLegoArm(shirtMaterial, skinMaterial) {
  const arm = new THREE.Group();
  const sleeve = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.34, 0.13), shirtMaterial);
  sleeve.position.set(0, -0.13, 0);
  sleeve.castShadow = true;
  arm.add(sleeve);
  const hand = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.018, 8, 18, Math.PI * 1.45), skinMaterial);
  hand.position.set(0.02, -0.34, 0.04);
  hand.rotation.x = Math.PI / 2;
  hand.rotation.z = -0.5;
  hand.castShadow = true;
  arm.add(hand);
  const cigaretteGroup = new THREE.Group();
  cigaretteGroup.visible = false;
  const cigarette = new THREE.Mesh(
    new THREE.CylinderGeometry(0.009, 0.009, 0.16, 8),
    new THREE.MeshStandardMaterial({ color: 0xf6f2dd, roughness: 0.42 })
  );
  cigarette.position.set(0.035, -0.42, 0.07);
  cigarette.rotation.z = Math.PI / 2;
  cigaretteGroup.add(cigarette);
  const ember = new THREE.Mesh(
    new THREE.SphereGeometry(0.016, 8, 6),
    new THREE.MeshBasicMaterial({ color: 0xff6f3c })
  );
  ember.position.set(0.12, -0.42, 0.07);
  cigaretteGroup.add(ember);
  for (let i = 0; i < 4; i += 1) {
    const smokePuff = new THREE.Mesh(
      new THREE.TorusGeometry(0.026 + i * 0.009, 0.0035, 6, 14),
      new THREE.MeshBasicMaterial({ color: 0xb8c4c0, transparent: true, opacity: 0.38 - i * 0.055 })
    );
    smokePuff.position.set(0.14 + i * 0.035, -0.33 + i * 0.055, 0.08 + Math.sin(i) * 0.012);
    smokePuff.rotation.x = Math.PI / 2;
    smokePuff.userData.smokeIndex = i;
    cigaretteGroup.add(smokePuff);
  }
  arm.add(cigaretteGroup);
  arm.userData.cigaretteGroup = cigaretteGroup;
  return arm;
}

function makeLegoLeg(pantsMaterial, shoeMaterial) {
  const leg = new THREE.Group();
  const block = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.36, 0.18), pantsMaterial);
  block.position.set(0, 0, 0);
  block.castShadow = true;
  leg.add(block);
  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.07, 0.23), shoeMaterial);
  foot.position.set(0, -0.22, 0.04);
  foot.castShadow = true;
  leg.add(foot);
  return leg;
}

function workerPalette(agent) {
  const palettes = {
    literature: { skin: 0xf2c9a5, hair: 0x4b2f25, shirt: 0xe8f4df, pants: 0x44515a },
    paper: { skin: 0xe8b88f, hair: 0x1d1a18, shirt: 0xffece8, pants: 0x4a4e57 },
    bio: { skin: 0xd8a278, hair: 0x35261f, shirt: 0xeee9ff, pants: 0x42475c },
    coding: { skin: 0xf0c4a0, hair: 0x171b22, shirt: 0xdcecff, pants: 0x2f3b48 },
    main: { skin: 0xe8b68f, hair: 0x5a3428, shirt: 0xfff2bd, pants: 0x43413a },
  };
  return palettes[agent.id] || palettes.main;
}

function addFace(head, palette) {
  const eyeMaterial = new THREE.MeshBasicMaterial({ color: 0x1a2025 });
  for (const x of [-0.07, 0.07]) {
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.014, 10, 8), eyeMaterial);
    eye.position.set(x, 0.045, 0.222);
    head.add(eye);
  }
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.048, 0.0045, 6, 20, Math.PI), eyeMaterial);
  smile.position.set(0, -0.055, 0.224);
  smile.rotation.x = Math.PI;
  head.add(smile);
}

function addHair(group, agent, material) {
  const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.225, 0.225, 0.08, 24), material);
  cap.position.set(0, 0.785, 0.08);
  cap.castShadow = true;
  group.add(cap);

  if (agent.trait === "coder") {
    const fringe = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.065, 0.08), material);
    fringe.position.set(0.03, 0.735, 0.23);
    fringe.rotation.z = -0.16;
    group.add(fringe);
  } else if (agent.trait === "bio") {
    for (const x of [-0.17, 0.17]) {
      const side = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.12), material);
      side.position.set(x, 0.62, 0.08);
      group.add(side);
    }
  } else {
    const sweep = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.065, 0.09), material);
    sweep.position.set(0.1, 0.745, 0.235);
    sweep.rotation.z = -0.2;
    group.add(sweep);
  }
}

function addWorkerTrait(group, agent, accent, dark, head) {
  if (agent.trait === "glasses") {
    const lensMaterial = new THREE.MeshBasicMaterial({ color: 0x26343b, transparent: true, opacity: 0.88 });
    for (const x of [-0.035, 0.105]) {
      const lens = new THREE.Mesh(new THREE.TorusGeometry(0.055, 0.007, 8, 18), lensMaterial);
      lens.position.set(x - 0.04, 0.045, 0.226);
      head.add(lens);
    }
    const bridge = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.012, 0.012), lensMaterial);
    bridge.position.set(0, 0.045, 0.226);
    head.add(bridge);
  } else if (agent.trait === "coder") {
    const headsetBand = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.015, 8, 28), accent);
    headsetBand.position.set(0, 0.64, 0.08);
    headsetBand.scale.set(0.88, 0.98, 0.34);
    headsetBand.rotation.x = Math.PI / 2;
    group.add(headsetBand);
    const mic = new THREE.Mesh(new THREE.BoxGeometry(0.018, 0.16, 0.018), accent);
    mic.position.set(0.22, 0.54, 0.25);
    mic.rotation.z = -0.45;
    group.add(mic);
  } else if (agent.trait === "host") {
    const tie = new THREE.Mesh(new THREE.ConeGeometry(0.08, 0.34, 4), accent);
    tie.position.set(0.03, 0.1, 0.34);
    tie.rotation.z = Math.PI;
    group.add(tie);
  }
}

function createCoffeeCup() {
  const group = new THREE.Group();
  const cup = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.07, 0.18, 18),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 })
  );
  cup.position.y = 0.09;
  group.add(cup);
  const coffee = new THREE.Mesh(
    new THREE.CylinderGeometry(0.065, 0.065, 0.012, 18),
    new THREE.MeshBasicMaterial({ color: 0x5a3620 })
  );
  coffee.position.y = 0.185;
  group.add(coffee);
  const handle = new THREE.Mesh(
    new THREE.TorusGeometry(0.055, 0.012, 8, 18),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 })
  );
  handle.position.set(0.08, 0.1, 0);
  handle.rotation.y = Math.PI / 2;
  group.add(handle);
  return group;
}

function createScreenContent(agent) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 144;
  const ctx = canvas.getContext("2d");
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1.22, 0.68), material);
  mesh.userData = { canvas, ctx, texture, agent };
  drawAgentScreen(mesh, 0, false, OFFICE_BEHAVIOR_STATES.WORKING);
  return mesh;
}

function createBillboard(text, options = {}) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 256;
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(options.width || 1.4, options.height || 0.54, 1);
  sprite.userData = { canvas, texture, options, text: "" };
  updateBillboard(sprite, text);
  return sprite;
}

function updateBillboard(sprite, text) {
  if (!sprite || sprite.userData.text === text) return;
  const { canvas, texture, options } = sprite.userData;
  const ctx = canvas.getContext("2d");
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = options.background || "rgba(255,255,255,0.92)";
  roundRect(ctx, 12, 20, canvas.width - 24, canvas.height - 40, 28);
  ctx.fill();
  ctx.fillStyle = `#${(options.accent || 0x1f7a68).toString(16).padStart(6, "0")}`;
  roundRect(ctx, 28, 38, 16, canvas.height - 76, 8);
  ctx.fill();
  ctx.fillStyle = options.color || "#1b2428";
  ctx.font = `700 ${options.fontSize || 30}px system-ui, sans-serif`;
  ctx.textBaseline = "top";
  const lines = wrapText(ctx, String(text || ""), canvas.width - 92, 3);
  lines.forEach((line, index) => ctx.fillText(line, 62, 46 + index * ((options.fontSize || 30) + 9)));
  sprite.userData.text = text;
  texture.needsUpdate = true;
}

function wrapText(ctx, text, maxWidth, maxLines) {
  const raw = text.split(/\s+/).filter(Boolean);
  if (!raw.length) return [""];
  const lines = [];
  let line = "";
  for (const word of raw) {
    const next = line ? `${line} ${word}` : word;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
    if (lines.length === maxLines - 1) break;
  }
  if (line) lines.push(line);
  if (lines.length > maxLines) lines.length = maxLines;
  return lines;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawAgentScreen(mesh, elapsed, active, idleMode) {
  const { canvas, ctx, texture, agent } = mesh.userData;
  const w = canvas.width;
  const h = canvas.height;
  const accent = `#${agent.color.toString(16).padStart(6, "0")}`;
  const glow = active ? 1 : 0.58 + Math.sin(elapsed * 2 + agent.x) * 0.06;
  ctx.clearRect(0, 0, w, h);
  ctx.fillStyle = active ? "#eaf4ff" : "#edf2f6";
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = glow;

  if (!active && idleMode === OFFICE_BEHAVIOR_STATES.GAMING) {
    drawGameScreen(ctx, w, h, accent, elapsed);
  } else if (agent.screen === "main") {
    drawMainDashboardScreen(ctx, w, h, accent, elapsed, active);
  } else if (agent.screen === "literature") {
    drawLiteratureScreen(ctx, w, h, accent, elapsed, active);
  } else if (agent.screen === "paper") {
    drawPaperScreen(ctx, w, h, accent, elapsed, active);
  } else if (agent.screen === "bio") {
    drawBioScreen(ctx, w, h, accent, elapsed, active);
  } else if (agent.screen === "coding") {
    drawCodingScreen(ctx, w, h, accent, elapsed, active);
  } else {
    drawMeetingScreen(ctx, w, h, accent, elapsed, active);
  }

  ctx.globalAlpha = 1;
  if (active) {
    ctx.fillStyle = "rgba(255,255,255,0.18)";
    ctx.fillRect((Math.sin(elapsed * 3) * 0.5 + 0.5) * w, 0, 8, h);
  }
  texture.needsUpdate = true;
}

function drawMainDashboardScreen(ctx, w, h, accent, t, active) {
  ctx.fillStyle = "#0f1a20";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#1f2e35";
  ctx.fillRect(0, 0, w, 20);
  ctx.fillStyle = accent;
  ctx.font = "700 10px system-ui";
  ctx.fillText("Dashboard", 14, 14);
  const labels = ["Agent 状态", "任务进度", "Queue", "OpenClaw"];
  for (let i = 0; i < labels.length; i += 1) {
    const y = 34 + i * 24;
    ctx.fillStyle = "#d8e9ee";
    ctx.font = "700 9px system-ui";
    ctx.fillText(labels[i], 18, y);
    ctx.fillStyle = "rgba(255,255,255,0.10)";
    ctx.fillRect(92, y - 8, 124, 9);
    ctx.fillStyle = i === 1 && active ? "#ffd64d" : accent;
    ctx.fillRect(92, y - 8, 34 + ((Math.sin(t * 1.3 + i) * 0.5 + 0.5) * 82), 9);
  }
  ctx.fillStyle = active ? "#78ffbd" : "#8da0a7";
  ctx.beginPath();
  ctx.arc(226, 14, 5, 0, Math.PI * 2);
  ctx.fill();
}

function drawLiteratureScreen(ctx, w, h, accent, t, active) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(18, 14, 220, 116);
  ctx.fillStyle = "#1f3555";
  ctx.font = "700 15px system-ui";
  ctx.fillText("PubMed", 30, 35);
  ctx.fillStyle = "#edf4fb";
  roundRect(ctx, 28, 45, 186, 19, 7);
  ctx.fill();
  ctx.fillStyle = accent;
  ctx.fillRect(36, 53, 42 + (Math.sin(t * 2) + 1) * 20, 4);
  const journals = ["Nature", "Cell", "Science", "NEJM"];
  for (let i = 0; i < 4; i += 1) {
    const y = 76 + i * 18 - ((t * 12) % 18);
    ctx.fillStyle = i % 2 ? "#f4f7fb" : "#ffffff";
    ctx.fillRect(28, y, 192, 14);
    ctx.fillStyle = i === Math.floor(t * 1.4) % 4 && active ? accent : "#698092";
    ctx.font = "10px system-ui";
    ctx.fillText(`${journals[i]}  search hit  ${active ? "..." : ""}`, 36, y + 10);
  }
}

function drawPaperScreen(ctx, w, h, accent, t, active) {
  ctx.fillStyle = "#f7f7f7";
  ctx.fillRect(24, 10, 160, 124);
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(34, 18, 140, 108);
  ctx.fillStyle = "#26343b";
  ctx.font = "700 12px system-ui";
  ctx.fillText("PDF", 42, 34);
  for (let i = 0; i < 8; i += 1) {
    ctx.fillStyle = i === Math.floor(t * 2.2) % 8 && active ? accent : "#d4dce3";
    ctx.fillRect(42, 46 + i * 10, 96 + (i % 3) * 15, 4);
  }
  ctx.fillStyle = "#fff0d8";
  ctx.fillRect(196, 22, 32, 88);
  ctx.fillStyle = "#1f3555";
  ctx.font = "9px system-ui";
  ctx.fillText("DOI", 202, 38);
  ctx.fillStyle = accent;
  ctx.fillRect(202, 48 + (Math.sin(t * 3) * 0.5 + 0.5) * 48, 18, 4);
}

function drawBioScreen(ctx, w, h, accent, t, active) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(13, 12, 232, 120);
  ctx.fillStyle = "#26343b";
  ctx.font = "700 11px system-ui";
  const labels = ["RStudio", "Seurat", "CellChat"];
  ctx.fillText(`${labels[Math.floor(t / 2.5) % labels.length]} / UMAP`, 24, 29);
  for (let i = 0; i < 46; i += 1) {
    const x = 44 + Math.sin(i * 9.1 + t * 0.8) * 28 + (i % 2) * 12;
    const y = 72 + Math.cos(i * 5.3 + t) * 24;
    ctx.fillStyle = i % 3 === 0 ? accent : i % 3 === 1 ? "#315f9d" : "#ff6f61";
    ctx.globalAlpha = active ? 0.9 : 0.58;
    ctx.beginPath();
    ctx.arc(x, y, 2.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  ctx.strokeStyle = "#b9c7cf";
  ctx.strokeRect(128, 45, 62, 56);
  for (let i = 0; i < 16; i += 1) {
    ctx.fillStyle = i % 2 ? "#e65f5c" : "#4bb4a8";
    ctx.globalAlpha = 0.36 + ((i + Math.floor(t * 4)) % 5) * 0.12;
    ctx.fillRect(204 + (i % 4) * 9, 46 + Math.floor(i / 4) * 9, 8, 8);
  }
  ctx.globalAlpha = 1;
}

function drawCodingScreen(ctx, w, h, accent, t, active) {
  ctx.fillStyle = "#111820";
  ctx.fillRect(0, 0, w, h);
  ctx.fillStyle = "#263241";
  ctx.fillRect(0, 0, w, 18);
  ctx.fillStyle = accent;
  ctx.font = "700 10px Menlo, monospace";
  ctx.fillText("VSCode", 14, 13);
  const lines = ["import pandas as pd", "def run_agent(task):", "  refs = search(query)", "  return report", "$ python meeting.py"];
  for (let i = 0; i < 9; i += 1) {
    const y = 34 + i * 12 - ((t * 16) % 12);
    ctx.fillStyle = i % 5 === 0 ? accent : "#a9c2d1";
    ctx.font = "9px Menlo, monospace";
    ctx.fillText(lines[(i + Math.floor(t * 1.2)) % lines.length], 18, y);
  }
  ctx.fillStyle = active && Math.floor(t * 4) % 2 ? "#ffffff" : "#6f8797";
  ctx.fillRect(112, 118, 38, 3);
}

function drawMeetingScreen(ctx, w, h, accent, t, active) {
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(24, 18, 208, 108);
  ctx.fillStyle = "#1f3555";
  ctx.font = "700 13px system-ui";
  ctx.fillText(active ? "Meeting Live" : "Office Sync", 38, 38);
  for (let i = 0; i < 5; i += 1) {
    ctx.fillStyle = i === Math.floor(t * 1.5) % 5 && active ? accent : "#dce5eb";
    ctx.fillRect(38, 54 + i * 14, 122 + Math.sin(t + i) * 22, 6);
  }
  ctx.strokeStyle = accent;
  ctx.strokeRect(180, 50, 24, 54);
}

function drawGameScreen(ctx, w, h, accent, t) {
  const gameScreens = ["Steam", "Minecraft", "LOL", "Bilibili"];
  const gameName = gameScreens[Math.floor(t / 2.6) % gameScreens.length];
  ctx.fillStyle = "#10162a";
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = "#c6a85a";
  ctx.lineWidth = 2;
  ctx.strokeRect(28, 20, 200, 104);
  ctx.strokeStyle = "rgba(198,168,90,0.45)";
  ctx.beginPath();
  ctx.moveTo(36, 108);
  ctx.lineTo(118, 32);
  ctx.lineTo(212, 106);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, 17, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = "#f1d58a";
  ctx.font = "700 16px system-ui";
  ctx.fillText(gameName, 22, 24);
  ctx.fillStyle = "#8cc8ff";
  ctx.font = "700 9px system-ui";
  ctx.fillText(gameName === "LOL" ? "Summoner's Rift" : "摸鱼中", 150, 24);
  ctx.fillStyle = accent;
  ctx.beginPath();
  ctx.arc(62 + (Math.sin(t * 2) * 0.5 + 0.5) * 130, 76, 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = "#e85d75";
  ctx.beginPath();
  ctx.arc(195 - (Math.sin(t * 1.7) * 0.5 + 0.5) * 98, 56, 4, 0, Math.PI * 2);
  ctx.fill();
}

function animateOffice() {
  const office = state.office;
  if (!office) return;
  const elapsed = office.clock.getElapsedTime();
  window.__officeElapsed = elapsed;
  const officeTime = getBeijingTimeParts();
  window.__officeTimeParts = officeTime;
  const activeGroup = state.activeAgent ? office.groups[state.activeAgent] : null;
  const officeMeetingActive = !state.taskActive && isOfficeMeetingTime(officeTime);
  // Wall clock follows real Beijing time exactly.
  if (office.scene.userData.clock) {
    const wallClock = office.scene.userData.clock;
    const min = officeTime.minute + officeTime.second / 60;
    const hrs = (officeTime.hour % 12) + min / 60;
    wallClock.userData.minute.rotation.z = -min * Math.PI / 30;
    wallClock.userData.hour.rotation.z = -hrs * Math.PI / 6;
  }
  if (els.sceneStatus) {
    els.sceneStatus.textContent = `北京时间 ${officeTime.label} · 24h AI办公室`;
  }
  if (office.scene.userData.roomSmokePuffs) {
    for (const puff of office.scene.userData.roomSmokePuffs) {
      const i = puff.userData.roomSmokeIndex || 0;
      const lift = (elapsed * 0.18 + i * 0.14) % 1;
      puff.position.set(
        9.15 + Math.sin(elapsed * 0.9 + i) * 0.28 + lift * 0.22,
        0.72 + lift * 1.35,
        -4.05 + Math.cos(elapsed * 0.7 + i) * 0.24 - lift * 0.18
      );
      puff.rotation.z = elapsed * 0.35 + i;
      puff.scale.setScalar(0.55 + lift * 1.75);
      puff.material.opacity = (1 - lift) * 0.34;
    }
  }
  // ── Door animation ──
  for (const [doorName, door] of Object.entries(doorState)) {
    if (!door.group) continue;
    const diff = door.target - door.angle;
    if (Math.abs(diff) > 0.001) {
      const step = Math.sign(diff) * (DOOR_CONFIG[doorName]?.speed || DOOR_CONFIG.entry.speed);
      door.angle += step;
      if (Math.abs(door.angle - door.target) < 0.005) door.angle = door.target;
      door.group.rotation.y = door.angle;
    }
  }
  // ── Door proximity detection ──
  // Each frame, check agents near doors; count agents in walking phases near each door trigger
  function doorTriggerTimer() { return 0; } // placeholder — computed below
  // Track which agents are near doors
  const entryDoorAgentCount = { count: 0, triggered: false };
  const meetingDoorAgentCount = { count: 0, triggered: false };
  const walkingPhases = ['goingDoor', 'comingBack', 'goingMeeting', 'returnFromMeeting', 'goingSmoke', 'returnFromSmoke', 'goingPatrol', 'returnFromPatrol'];
  for (const [agentId, group] of Object.entries(office.groups)) {
    if (group.vacant || !group.characterRig) continue;
    const m = group.move;
    if (!walkingPhases.includes(m.phase)) continue;
    if (!group.characterRig.visible) continue;
    const pos = group.characterRig.position;
    // Check entry door (trigger at C[34] = door inner point)
    if (pos.distanceToSquared(C[34]) < 3.0) entryDoorAgentCount.count++;
    if (pos.distanceToSquared(C[34]) < 1.5) entryDoorAgentCount.triggered = true;
    // Check meeting room door (trigger at C[17] = meeting door point)
    if (pos.distanceToSquared(C[17]) < 3.0) meetingDoorAgentCount.count++;
    if (pos.distanceToSquared(C[17]) < 1.5) meetingDoorAgentCount.triggered = true;
  }
  // Update door targets based on agent proximity
  if (entryDoorAgentCount.triggered || entryDoorAgentCount.count > 0) {
    doorState.entry.target = DOOR_CONFIG.entry.maxAngle * DOOR_CONFIG.entry.swingDir;
    doorState.entry.state = 'opening';
  } else {
    doorState.entry.target = 0;
    doorState.entry.state = 'closing';
  }
  if (meetingDoorAgentCount.triggered || meetingDoorAgentCount.count > 0) {
    doorState.meeting.target = DOOR_CONFIG.meeting.maxAngle * DOOR_CONFIG.meeting.swingDir;
    doorState.meeting.state = 'opening';
  } else {
    doorState.meeting.target = 0;
    doorState.meeting.state = 'closing';
  }
  for (const [agentId, group] of Object.entries(office.groups)) {
    if (group.vacant) continue;
    const active = agentId === state.activeAgent;
    const phase = elapsed + group.idlePhase;
    const briefingActive = state.briefing.active && state.briefing.participants.includes(agentId);
    const rawIdleMode = state.taskActive
      ? (briefingActive ? OFFICE_BEHAVIOR_STATES.MEETING : OFFICE_BEHAVIOR_STATES.WORKING)
      : (officeMeetingActive ? OFFICE_BEHAVIOR_STATES.MEETING : getIdleMode(phase, group.agent.id));
    const m = group.move;
    let idleMode = rawIdleMode;

    // Track Main position for Bio gaming detection before Bio decides whether to hide the game.
    if (group.agent && group.agent.id === "main" && group.characterRig) {
      setMainPosition(group.characterRig.position.clone());
    }
    if (group.agent && group.agent.id === "bio" && idleMode === OFFICE_BEHAVIOR_STATES.GAMING) {
      const mainPos = getMainPosition();
      const mainNearby = mainPos && group.characterRig ? mainPos.distanceTo(group.characterRig.position) < 5 : false;
      if (mainNearby || state.taskActive) idleMode = OFFICE_BEHAVIOR_STATES.WORKING;
    }
    m.requestedState = idleMode;
    m.behaviorState = state.taskActive && !briefingActive && m.phase !== "atDesk" ? OFFICE_BEHAVIOR_STATES.RETURNING : idleMode;

    // === State machine phase transitions ===
    if (briefingActive && !['goingMeeting', 'atMeeting'].includes(m.phase)) {
      m.prevIdleMode = OFFICE_BEHAVIOR_STATES.MEETING;
      m.hidden = false;
      if (group.characterRig) group.characterRig.visible = true;
      if (m.phase === 'atDesk' || m.phase === 'sittingDown') {
        m.sitAnim = 0;
        m.phase = 'standingUp';
        m.pendingDest = OFFICE_BEHAVIOR_STATES.MEETING;
      } else if (m.phase === 'standingUp') {
        m.pendingDest = OFFICE_BEHAVIOR_STATES.MEETING;
      } else {
        const curBriefPos = group.characterRig ? group.characterRig.position.clone() : group.standingPos.clone();
        curBriefPos.y = 0.735;
        if (m.phase === 'atOuting') curBriefPos.copy(OUTSIDE_POINT);
        m.path = safePathFromCurrent(group, curBriefPos, group.meetingSpot);
        m.pathIndex = 0;
        m.pathProgress = 0;
        m.phase = 'goingMeeting';
      }
    } else if (state.taskActive && m.phase !== 'atDesk' && m.phase !== 'sittingDown') {
      m.prevIdleMode = OFFICE_BEHAVIOR_STATES.WORKING;
      m.pendingDest = null;
      m.hidden = false;
      if (group.characterRig) group.characterRig.visible = true;
      if (m.phase === 'standingUp') {
        m.sitAnim = Math.max(m.sitAnim, 0.35);
        m.pendingDest = 'desk';
      } else if (!['comingBack', 'returnFromMeeting', 'returnFromSmoke', 'returnFromPatrol'].includes(m.phase)) {
        const curPos = group.characterRig ? group.characterRig.position.clone() : group.standingPos.clone();
        curPos.y = 0.735;
        if (m.phase === 'atOuting') curPos.copy(OUTSIDE_POINT);
        m.path = safePathToDesk(group, curPos);
        m.pathIndex = 0;
        m.pathProgress = 0;
        m.phase = 'comingBack';
      }
    } else if (!state.taskActive && officeMeetingActive &&
        !['goingMeeting', 'atMeeting'].includes(m.phase)) {
      m.prevIdleMode = OFFICE_BEHAVIOR_STATES.MEETING;
      m.hidden = false;
      if (group.characterRig) group.characterRig.visible = true;
      if (m.phase === 'atDesk' || m.phase === 'sittingDown') {
        m.sitAnim = 0;
        m.phase = 'standingUp';
        m.pendingDest = OFFICE_BEHAVIOR_STATES.MEETING;
      } else if (m.phase === 'standingUp') {
        m.pendingDest = OFFICE_BEHAVIOR_STATES.MEETING;
      } else {
        const curPos = group.characterRig ? group.characterRig.position.clone() : group.standingPos.clone();
        curPos.y = 0.735;
        if (m.phase === 'atOuting') curPos.copy(OUTSIDE_POINT);
        m.path = safePathFromCurrent(group, curPos, group.meetingSpot);
        m.pathIndex = 0;
        m.pathProgress = 0;
        m.phase = 'goingMeeting';
      }
    } else if (!state.taskActive && m.prevIdleMode !== idleMode) {
      m.prevIdleMode = idleMode;
      // Only initiate new activities when at desk
        if (m.phase === 'atDesk') {
        if ((group.agent.id === "main" && idleMode === OFFICE_BEHAVIOR_STATES.BREAK) ||
            idleMode === OFFICE_BEHAVIOR_STATES.AWAY ||
            idleMode === OFFICE_BEHAVIOR_STATES.SMOKING ||
            idleMode === OFFICE_BEHAVIOR_STATES.MEETING) {
          // Stand up first
          m.sitAnim = 0;
          m.phase = 'standingUp';
          m.pendingDest = idleMode;
          m.awayOffsetTarget = 0;
        } else {
          m.awayOffsetTarget = idleMode === OFFICE_BEHAVIOR_STATES.AWAY ? 1 : 0;
        }
      }
    }
    
    // Stand up animation progress (runs every frame, not only on transition)
    if (m.phase === 'standingUp') {
      m.sitAnim += 0.035;
      if (m.sitAnim >= 1) {
        m.sitAnim = 0;
        const dest = m.pendingDest || OFFICE_BEHAVIOR_STATES.AWAY;
        m.pendingDest = null;
        if (dest === 'desk' || dest === OFFICE_BEHAVIOR_STATES.WORKING) {
          m.sitAnim = 0;
          m.phase = 'sittingDown';
        } else if (dest === OFFICE_BEHAVIOR_STATES.AWAY) {
          m.path = group.pathToDoor.map(p => p.clone());
          m.pathIndex = 0;
          m.pathProgress = 0;
          m.phase = 'goingDoor';
        } else if (dest === OFFICE_BEHAVIOR_STATES.MEETING) {
          m.path = group.pathToMain.map(p => p.clone());
          m.pathIndex = 0;
          m.pathProgress = 0;
          m.phase = 'goingMeeting';
        } else if (dest === OFFICE_BEHAVIOR_STATES.SMOKING) {
          m.path = group.pathToSmoke.map(p => p.clone());
          m.pathIndex = 0;
          m.pathProgress = 0;
          m.phase = 'goingSmoke';
        } else if (dest === OFFICE_BEHAVIOR_STATES.BREAK && group.agent.id === "main") {
          const patrolSpot = nextPatrolSpot(group);
          m.path = safePathFromCurrent(group, group.standingPos, patrolSpot);
          m.pathIndex = 0;
          m.pathProgress = 0;
          m.phase = 'goingPatrol';
        }
      }
    }

    if (m.phase === 'atMeeting') {
      // Check if minimum meeting duration has passed
      const meetingElapsed = elapsed - m.activityStart;
      if (meetingElapsed > m.minDuration && !briefingActive && idleMode !== OFFICE_BEHAVIOR_STATES.MEETING) {
        const curPos2 = group.characterRig ? group.characterRig.position.clone() : group.standingPos.clone();
        curPos2.y = 0.735;
        m.path = safePathToDesk(group, curPos2);
        m.pathIndex = 0;
        m.pathProgress = 0;
        m.phase = 'returnFromMeeting';
      }
    } else if (!state.taskActive && m.phase === 'goingSmoke' && idleMode !== OFFICE_BEHAVIOR_STATES.SMOKING) {
      const curPos3 = group.characterRig ? group.characterRig.position.clone() : group.standingPos.clone();
      curPos3.y = 0.735;
      m.path = safePathToDesk(group, curPos3);
      m.pathIndex = 0;
      m.pathProgress = 0;
      m.phase = 'returnFromSmoke';
    } else if (!state.taskActive && m.phase === 'goingPatrol' && idleMode !== OFFICE_BEHAVIOR_STATES.BREAK) {
      const curPos4 = group.characterRig ? group.characterRig.position.clone() : group.standingPos.clone();
      curPos4.y = 0.735;
      m.path = safePathToDesk(group, curPos4);
      m.pathIndex = 0;
      m.pathProgress = 0;
      m.phase = 'returnFromPatrol';
    }

    if (['comingBack', 'returnFromMeeting', 'returnFromSmoke', 'returnFromPatrol'].includes(m.phase)) {
      m.behaviorState = OFFICE_BEHAVIOR_STATES.RETURNING;
    } else if (m.phase === 'atMeeting' || m.phase === 'goingMeeting') {
      m.behaviorState = OFFICE_BEHAVIOR_STATES.MEETING;
    } else if (m.phase === 'atSmoke' || m.phase === 'goingSmoke') {
      m.behaviorState = OFFICE_BEHAVIOR_STATES.SMOKING;
    } else if (m.phase === 'atPatrol' || m.phase === 'goingPatrol') {
      m.behaviorState = OFFICE_BEHAVIOR_STATES.BREAK;
    } else if (m.phase === 'atOuting' || m.phase === 'goingDoor') {
      m.behaviorState = OFFICE_BEHAVIOR_STATES.AWAY;
    } else if (m.phase === 'atDesk') {
      m.behaviorState = idleMode;
    }

    // === Active state targets ===
    m.scaleTarget = active ? 1.08 : 1;
    m.scaleCurrent = THREE.MathUtils.lerp(m.scaleCurrent, m.scaleTarget, m.scaleSpeed);
    m.monitorEmissiveTarget = active ? 0.18 : 0;
    m.monitorEmissiveCurrent = THREE.MathUtils.lerp(m.monitorEmissiveCurrent, m.monitorEmissiveTarget, m.monitorEmissiveSpeed);
    m.plaqueGlowTarget = active ? 0.68 : 0.08;
    m.plaqueGlowCurrent = THREE.MathUtils.lerp(m.plaqueGlowCurrent, m.plaqueGlowTarget, m.plaqueGlowSpeed);

    // === Process path walking ===
    if (group.characterRig) {
      const character = group.characterRig;
      const walkingPhases = ['goingDesk', 'goingDoor', 'comingBack', 'goingMeeting', 'returnFromMeeting', 'goingSmoke', 'returnFromSmoke', 'goingPatrol', 'returnFromPatrol'];
      const isWalking = walkingPhases.includes(m.phase);
      
      if (isWalking && m.path.length >= 2) {
        // Advance along path
        m.pathProgress += m.pathSpeed;
        if (m.pathProgress >= 1) {
          m.pathProgress = 0;
          m.pathIndex += 1;
        }
        
        if (m.pathIndex >= m.path.length - 1 || m.pathIndex < 0) {
          // Arrived at destination (clamp)
          m.pathIndex = Math.max(0, Math.min(m.pathIndex, m.path.length - 1));
          character.position.copy(m.path[m.path.length - 1]);
          character.position.y += Math.sin(phase * 12) * 0.01;
          
          if (m.phase === 'goingDoor') {
            m.hidden = true;
            character.visible = false;
            m.phase = 'atOuting';
            m.activityStart = elapsed;
            m.minDuration = 90 + Math.random() * 90;
          } else if (m.phase === 'goingDesk' || m.phase === 'comingBack') {
            // Arrived at desk — start sitting down
            m.sitAnim = 0;
            m.phase = 'sittingDown';
          } else if (m.phase === 'goingMeeting') {
            // Arrived at meeting spot — face main and show bubble
            m.phase = 'atMeeting';
            m.activityStart = elapsed;
            m.minDuration = 6 + Math.random() * 12; // stay 6-18 seconds
          } else if (m.phase === 'returnFromMeeting') {
            // Arrived back at desk — sit down
            m.sitAnim = 0;
            m.phase = 'sittingDown';
          } else if (m.phase === 'goingSmoke') {
            m.phase = 'atSmoke';
            m.activityStart = elapsed;
            const behavior = getAgentBehavior(group.agent.id);
            m.minDuration = behavior.minSmokeSeconds || (16 + Math.random() * 18);
          } else if (m.phase === 'returnFromSmoke') {
            m.sitAnim = 0;
            m.phase = 'sittingDown';
          } else if (m.phase === 'goingPatrol') {
            m.phase = 'atPatrol';
            m.activityStart = elapsed;
            m.minDuration = 8 + Math.random() * 10;
          } else if (m.phase === 'returnFromPatrol') {
            m.sitAnim = 0;
            m.phase = 'sittingDown';
          }
        } else {
          // Walk along current segment
          const segFrom = m.path[m.pathIndex];
          const segTo = m.path[m.pathIndex + 1];
          character.position.lerpVectors(segFrom, segTo, m.pathProgress);
          // Standing bob while walking
          character.position.y += Math.sin(phase * 12) * 0.028;
          // Face travel direction
          const dir = new THREE.Vector3().subVectors(segTo, segFrom);
          if (dir.lengthSq() > 0.001) {
            const angle = Math.atan2(dir.x, dir.z);
            character.rotation.y = THREE.MathUtils.lerp(character.rotation.y, angle, 0.08);
          }
        }
      } else if (m.phase === 'atOuting') {
        const outElapsed = elapsed - m.activityStart;
        if (outElapsed > m.minDuration && !active) {
          m.hidden = false;
          character.visible = true;
          character.position.copy(OUTSIDE_POINT);
          const curPos6 = OUTSIDE_POINT.clone();
          curPos6.y = 0.735;
          m.path = safePathToDesk(group, curPos6);
          m.pathIndex = 0;
          m.pathProgress = 0;
          m.phase = 'comingBack';
        }
      } else if (m.phase === 'atSmoke') {
        const smokeElapsed = elapsed - m.activityStart;
        if (smokeElapsed > m.minDuration && !state.taskActive) {
          const currentMode = getIdleMode(phase, group.agent.id);
          if (currentMode !== OFFICE_BEHAVIOR_STATES.SMOKING) {
            const curPos5 = character.position.clone();
            curPos5.y = 0.735;
            m.path = safePathToDesk(group, curPos5);
            m.pathIndex = 0;
            m.pathProgress = 0;
            m.phase = 'returnFromSmoke';
          }
        }
        character.position.copy(group.smokeSpot);
        character.position.y = 0.735 + Math.sin(phase * 1.4) * 0.012;
        character.rotation.y = THREE.MathUtils.lerp(character.rotation.y, -Math.PI / 2 + Math.sin(phase * 0.5) * 0.15, 0.06);
      } else if (m.phase === 'atPatrol') {
        const patrolElapsed = elapsed - m.activityStart;
        if (patrolElapsed > m.minDuration && idleMode === OFFICE_BEHAVIOR_STATES.BREAK && !state.taskActive) {
          const curPatrolPos = character.position.clone();
          curPatrolPos.y = 0.735;
          m.path = safePathFromCurrent(group, curPatrolPos, nextPatrolSpot(group));
          m.pathIndex = 0;
          m.pathProgress = 0;
          m.phase = 'goingPatrol';
        } else if ((patrolElapsed > m.minDuration && idleMode !== OFFICE_BEHAVIOR_STATES.BREAK) || state.taskActive) {
          const curPos7 = character.position.clone();
          curPos7.y = 0.735;
          m.path = safePathToDesk(group, curPos7);
          m.pathIndex = 0;
          m.pathProgress = 0;
          m.phase = 'returnFromPatrol';
        }
        character.position.y = 0.735 + Math.sin(phase * 1.1) * 0.012;
        character.rotation.y = THREE.MathUtils.lerp(character.rotation.y, Math.sin(phase * 0.45) * 0.4, 0.035);
      } else if (m.phase === 'atMeeting') {
        // Seated in the meeting room, facing the long table.
        character.position.copy(group.meetingSpot);
        character.position.y = 1.12;
        const lookDir = new THREE.Vector3().subVectors(MEETING_ROOM_CENTER, group.meetingSpot);
        const meetingYaw = Math.atan2(lookDir.x, lookDir.z);
        character.rotation.y = THREE.MathUtils.lerp(character.rotation.y, meetingYaw, 0.08);
        const mascotSt = character.userData.mascot;
        if (mascotSt) applySeatedPose(mascotSt, 1);
      } else if (m.phase === 'standingUp') {
        // Standing up animation: move from seated pose to a clear standing anchor.
        const t = m.sitAnim;
        character.position.lerpVectors(group.sittingPos, group.standingPos, t);
        // Lean forward slightly while standing
        character.rotation.y = THREE.MathUtils.lerp(group.baseYaw + Math.PI, group.baseYaw, t * 0.5);
        character.rotation.x = 0;
        // Body tilt
        character.rotation.z = Math.sin(t * Math.PI) * 0.04;
        const mascotSt = character.userData.mascot;
        if (mascotSt) {
          applySeatedPose(mascotSt, 1 - t);
          const p = mascotSt.userData;
          if (p.rightArm) { p.rightArm.rotation.z = -0.2 - t * 0.2; p.leftArm.rotation.z = 0.2 + t * 0.2; }
        }
      } else if (m.phase === 'sittingDown') {
        // Sitting down animation: lower body, step back into chair
        m.sitAnim += 0.05;
        const t = m.sitAnim;
        if (t >= 1) {
          m.phase = 'atDesk';
          character.position.copy(group.sittingPos);
          character.rotation.y = group.baseYaw + Math.PI;
          character.rotation.x = 0;
          character.rotation.z = 0;
          const mascotSt = character.userData.mascot;
          if (mascotSt) applySeatedPose(mascotSt, 1);
        } else {
          // Sit down from the clear standing anchor into the chair.
          const t = m.sitAnim;
          character.position.lerpVectors(group.standingPos, group.sittingPos, t);
          character.position.y += Math.sin(t * Math.PI) * 0.02;
          // Rotate from corridor-facing to desk-facing
          character.rotation.y = THREE.MathUtils.lerp(group.baseYaw, group.baseYaw + Math.PI, t);
          character.rotation.x = 0;
          character.rotation.z = Math.sin((1 - t) * Math.PI) * 0.04;
          const mascotSt = character.userData.mascot;
          if (mascotSt) {
            applySeatedPose(mascotSt, t);
            const p = mascotSt.userData;
            if (p.rightArm) {
              p.rightArm.rotation.z = -0.2 - (1 - t) * 0.2;
              p.leftArm.rotation.z = 0.2 + (1 - t) * 0.2;
            }
          }
        }
      } else {
        // atDesk — sitting in chair facing monitor
        character.position.copy(group.sittingPos);
        const facingMonitor = group.baseYaw + Math.PI;
        character.rotation.y = THREE.MathUtils.lerp(character.rotation.y, facingMonitor, 0.06);
        character.rotation.x = 0;
        const mascotSt = character.userData.mascot;
        if (mascotSt) applySeatedPose(mascotSt, 1);
        m.awayOffsetCurrent = THREE.MathUtils.lerp(m.awayOffsetCurrent, m.awayOffsetTarget, m.awayOffsetSpeed);
        if (idleMode === OFFICE_BEHAVIOR_STATES.AWAY) {
          const sway = Math.sin(phase * 0.7) * 0.16;
          character.position.x = group.sittingPos.x + sway * m.awayOffsetCurrent;
        }
      }

      // === Character animation ===
      {
        const mascot = character.userData.mascot;
        if (mascot) {
          const parts = mascot.userData;
          const walkingPhases = ['goingDesk', 'goingDoor', 'comingBack', 'goingMeeting', 'returnFromMeeting', 'goingSmoke', 'returnFromSmoke', 'goingPatrol', 'returnFromPatrol'];
          const walkingState = walkingPhases.includes(m.phase);
          
          if (parts.rightCigarette) parts.rightCigarette.visible = m.phase === 'atSmoke';

          if (walkingState) {
            const stepRight = Math.sin(phase * 9.5) * 0.48;
            const stepLeft = Math.sin(phase * 9.5 + Math.PI) * 0.48;
            parts.rightLeg.rotation.x = stepRight;
            parts.leftLeg.rotation.x = stepLeft;
            parts.rightLeg.rotation.z = -0.04 + Math.max(0, -stepRight) * 0.16;
            parts.leftLeg.rotation.z = 0.04 - Math.max(0, -stepLeft) * 0.16;
            // Arms: opposite to legs
            parts.rightArm.rotation.x = 0;
            parts.leftArm.rotation.x = 0;
            parts.rightArm.rotation.z = -0.25 - stepLeft * 0.55;
            parts.leftArm.rotation.z = 0.25 + stepRight * 0.55;
            character.rotation.x = 0;
            character.rotation.z = Math.sin(phase * 10) * 0.02;
          } else if (m.phase === 'atSmoke') {
            animateSmokingBreak(parts, character, phase);
          } else if (m.phase === 'atMeeting') {
            // Meeting-room seated pose
            if (parts.rightLeg) {
              parts.rightLeg.rotation.x = -1.05;
              parts.leftLeg.rotation.x = -1.05;
            }
            if (parts.rightArm) {
              parts.rightArm.rotation.z = -0.18 + Math.sin(phase * 2.4) * 0.04;
              parts.leftArm.rotation.z = 0.18 + Math.cos(phase * 2.1) * 0.04;
            }
            character.rotation.z = 0;
          } else if (m.phase === 'atDesk') {
            character.rotation.z = 0;
          }
        }
      }
      
      // Scale for active highlight
      character.scale.setScalar(m.scaleCurrent);
    }

    // Plaque glow
    group.plaque.material.emissiveIntensity = m.plaqueGlowCurrent;

    // Monitor emissive
    group.monitor.material.emissive = new THREE.Color(m.monitorEmissiveTarget > 0.1 ? 0xffffff : 0x000000);
    group.monitor.material.emissiveIntensity = m.monitorEmissiveCurrent;

    animateWorker(group, active, idleMode, phase, activeGroup);
    animateSpeech(group, active, elapsed);
    if (elapsed - group.lastScreenUpdate > 0.08) {
      drawAgentScreen(group.screenContent, elapsed + group.idlePhase * 0.05, active, idleMode);
      group.lastScreenUpdate = elapsed;
    }
  }
  resolveAgentCrowding(office.groups);
  for (const [agentId, group] of Object.entries(office.groups)) {
    if (group.vacant) continue;
    animateSpeech(group, agentId === state.activeAgent, elapsed);
  }
  office.camera.position.x = Math.sin(elapsed * 0.18) * 0.2;
  office.camera.position.y = 9.4 + Math.sin(elapsed * 0.11) * 0.05;
  office.camera.position.z = 15.2;
  office.camera.lookAt(0, 1.05, 0.15);
  office.renderer.render(office.scene, office.camera);
  requestAnimationFrame(animateOffice);
}

function getIdleMode(phase, agentId) {
  const officeTime = window.__officeTimeParts || getBeijingTimeParts();
  const activity = getActivity(officeTime, agentId);
  if (Object.values(OFFICE_BEHAVIOR_STATES).includes(activity)) return activity;
  return OFFICE_BEHAVIOR_STATES.WORKING;
}

// Rough check if Main character is within 5 units (for Bio's gaming detection)
function getMainPosition() { return _mainPositionForBio; }
function setMainPosition(pos) { _mainPositionForBio = pos; }

function applySeatedPose(mascot, amount = 1) {
  const parts = mascot.userData;
  if (!parts?.rightLeg || !parts?.leftLeg) return;
  const seatedBend = -1.05 * amount;
  parts.rightLeg.rotation.x = seatedBend;
  parts.leftLeg.rotation.x = seatedBend;
  parts.rightLeg.rotation.z = 0;
  parts.leftLeg.rotation.z = 0;
}

function resolveAgentCrowding(groups) {
  const movable = Object.values(groups)
    .filter((group) => {
      const rig = group?.characterRig;
      const phase = group?.move?.phase;
      return rig && rig.visible && CROWDING_PHASES.has(phase);
    });

  for (let pass = 0; pass < 2; pass += 1) {
    for (let i = 0; i < movable.length; i += 1) {
      const a = movable[i];
      const pa = a.characterRig.position;
      for (let j = i + 1; j < movable.length; j += 1) {
        const b = movable[j];
        const pb = b.characterRig.position;
        const dx = pb.x - pa.x;
        const dz = pb.z - pa.z;
        const distSq = dx * dx + dz * dz;
        const bothWalking = WALKING_PHASES.has(a.move.phase) && WALKING_PHASES.has(b.move.phase);
        const minDist = bothWalking ? 0.74 : 0.62;
        if (distSq > minDist * minDist) continue;

        const dist = Math.sqrt(Math.max(distSq, 0.0001));
        let nx = dx / dist;
        let nz = dz / dist;
        if (distSq < 0.0001) {
          const seed = hashNoise(`${a.agent.id}:${b.agent.id}:crowding`);
          const angle = seed * Math.PI * 2;
          nx = Math.cos(angle);
          nz = Math.sin(angle);
        }
        const push = (minDist - dist) * 0.52;
        const aWalking = WALKING_PHASES.has(a.move.phase);
        const bWalking = WALKING_PHASES.has(b.move.phase);
        const aShare = bWalking && !aWalking ? 0.22 : 0.5;
        const bShare = aWalking && !bWalking ? 0.22 : 0.5;

        pa.x -= nx * push * aShare;
        pa.z -= nz * push * aShare;
        pb.x += nx * push * bShare;
        pb.z += nz * push * bShare;

        pa.x = THREE.MathUtils.clamp(pa.x, -10.15, 10.35);
        pb.x = THREE.MathUtils.clamp(pb.x, -10.15, 10.35);
        pa.z = THREE.MathUtils.clamp(pa.z, -5.35, 5.55);
        pb.z = THREE.MathUtils.clamp(pb.z, -5.35, 5.55);
      }
    }
  }
}

function animateSmokingBreak(parts, character, phase) {
  if (!parts?.rightArm || !parts?.leftArm || !parts?.head) return;
  character.rotation.x = 0;
  parts.rightLeg.rotation.x = -0.12;
  parts.leftLeg.rotation.x = -0.08;
  parts.rightLeg.rotation.z = -0.03;
  parts.leftLeg.rotation.z = 0.03;
  parts.rightArm.rotation.x = -1.05 + Math.sin(phase * 1.7) * 0.12;
  parts.rightArm.rotation.z = -0.55 + Math.sin(phase * 1.2) * 0.08;
  parts.leftArm.rotation.x = -0.25;
  parts.leftArm.rotation.z = 0.22;
  parts.head.rotation.y = Math.sin(phase * 0.8) * 0.18;
  parts.head.rotation.z = Math.sin(phase * 1.4) * 0.05;
  if (parts.rightCigarette) {
    parts.rightCigarette.rotation.y = Math.sin(phase * 2.2) * 0.25;
    parts.rightCigarette.scale.setScalar(1 + Math.sin(phase * 3.4) * 0.035);
    for (const child of parts.rightCigarette.children) {
      if (child.userData.smokeIndex === undefined) continue;
      const i = child.userData.smokeIndex;
      const lift = (phase * 0.42 + i * 0.22) % 1;
      child.position.set(
        0.14 + lift * 0.25 + Math.sin(phase * 1.6 + i) * 0.012,
        -0.34 + lift * 0.34,
        0.08 + Math.cos(phase * 1.2 + i) * 0.02
      );
      child.rotation.z = phase * 0.55 + i;
      child.scale.setScalar(0.55 + lift * 1.45);
      child.material.opacity = (1 - lift) * 0.34;
    }
  }
  character.rotation.z = Math.sin(phase * 0.9) * 0.015;
}

// Build a queue of waypoints from current position through corridor to destination
function buildPathWalk(queue, pathDef, progress) {
  if (pathDef.length < 2) return;
  for (let i = 0; i < pathDef.length - 1; i++) {
    queue.push({ from: pathDef[i].clone(), to: pathDef[i+1].clone(), startP: i, endP: i + 1 });
  }
}

function animateWorker(group, active, idleMode, phase, activeGroup) {
  // Uses group.characterRig.userData.mascot (scene-level rig)
  if (!group.characterRig) return;
  const mascot = group.characterRig.userData.mascot;
  if (!mascot) return;
  const parts = mascot.userData;
  if (!parts) return;
  
  const phaseM = group.move.phase;
  const skipPhases = ['goingDesk', 'goingDoor', 'comingBack', 'standingUp', 'sittingDown', 'goingMeeting', 'atMeeting', 'returnFromMeeting', 'goingSmoke', 'atSmoke', 'returnFromSmoke', 'goingPatrol', 'atPatrol', 'returnFromPatrol'];
  
  // Don't override walk/gym/stand/sit animations
  if (skipPhases.includes(phaseM)) return;
  
  // Reset — the main loop handles walk and gym, only handle at-desk here
  parts.head.rotation.y = 0;
  parts.head.rotation.z = 0;
  parts.rightArm.rotation.x = -0.82;
  parts.leftArm.rotation.x = -0.82;
  parts.rightArm.rotation.z = -0.16;
  parts.leftArm.rotation.z = 0.16;
  group.coffeeCup.rotation.z = 0;
  group.coffeeCup.position.y = 0.99;

  if (active) {
    mascot.rotation.y = THREE.MathUtils.lerp(mascot.rotation.y, 0, 0.12);
    parts.head.rotation.y = Math.sin(phase * 2.1) * 0.12;
    parts.rightArm.rotation.x = -0.9 + Math.sin(phase * 13) * 0.045;
    parts.leftArm.rotation.x = -0.9 + Math.cos(phase * 12.3) * 0.045;
    parts.rightArm.rotation.z = -0.28 + Math.sin(phase * 12) * 0.08;
    parts.leftArm.rotation.z = 0.28 + Math.cos(phase * 11.5) * 0.08;
    return;
  }

  if (idleMode === OFFICE_BEHAVIOR_STATES.WORKING) {
    parts.rightArm.rotation.x = -0.92 + Math.sin(phase * 10.5) * 0.05;
    parts.leftArm.rotation.x = -0.92 + Math.cos(phase * 9.9) * 0.05;
    parts.rightArm.rotation.z = -0.24 + Math.sin(phase * 8.5) * 0.06;
    parts.leftArm.rotation.z = 0.24 + Math.cos(phase * 7.9) * 0.06;
    parts.head.rotation.y = Math.sin(phase * 0.9) * 0.08;
  } else if (idleMode === OFFICE_BEHAVIOR_STATES.BREAK) {
    parts.rightArm.rotation.x = -0.35;
    parts.leftArm.rotation.x = -0.82;
    parts.head.rotation.z = -0.12 + Math.sin(phase * 0.9) * 0.04;
    parts.rightArm.rotation.z = -0.3 + Math.sin(phase * 1.8) * 0.04;
    parts.leftArm.rotation.z = 0.12;
  } else if (idleMode === OFFICE_BEHAVIOR_STATES.GAMING) {
    parts.rightArm.rotation.x = -0.88 + Math.sin(phase * 12) * 0.04;
    parts.leftArm.rotation.x = -0.88 + Math.cos(phase * 12.5) * 0.04;
    parts.head.rotation.y = Math.sin(phase * 1.8) * 0.22;
    parts.rightArm.rotation.z = -0.34 + Math.sin(phase * 12) * 0.08;
    parts.leftArm.rotation.z = 0.34 + Math.cos(phase * 12.5) * 0.08;
  } else if (idleMode === OFFICE_BEHAVIOR_STATES.AWAY) {
    parts.head.rotation.z = 0.18;
    group.characterRig.rotation.z = Math.sin(phase * 0.9) * 0.05;
    // position.x offset handled in main loop (unified)
  } else {
    parts.head.rotation.y = Math.sin(phase * 1.1) * 0.18;
  }

  if (activeGroup) {
    const dx = activeGroup.root.position.x - group.root.position.x;
    const dz = activeGroup.root.position.z - group.root.position.z;
    const target = Math.atan2(dx, dz) * 0.22;
    mascot.rotation.y = THREE.MathUtils.lerp(mascot.rotation.y, target, 0.04);
  } else {
    mascot.rotation.y = THREE.MathUtils.lerp(mascot.rotation.y, Math.sin(phase * 0.35) * 0.08, 0.04);
  }
}

function animateSpeech(group, active, elapsed) {
  const bubble = group.speechBubble;
  if (!bubble) return;
  const rig = group.characterRig;
  if (rig) {
    // Make speech bubble follow the character rig's x,z (bubble is child of root)
    bubble.position.x = rig.position.x - group.root.position.x;
    bubble.position.z = rig.position.z - group.root.position.z;
    // Also move name label
    group.nameLabel.position.x = rig.position.x - group.root.position.x;
    group.nameLabel.position.z = rig.position.z - group.root.position.z;
  }
  if (active) {
    bubble.visible = true;
    group.nameLabel.visible = false;
    const pulse = 1 + Math.sin(elapsed * 5) * 0.025;
    bubble.scale.set(1.7 * pulse, 0.72 * pulse, 1);
    updateBillboard(bubble, state.activeMessage || "Thinking...");
    return;
  }
  if (group.move?.phase === "atMeeting") {
    bubble.visible = true;
    group.nameLabel.visible = false;
    const pulse = 1 + Math.sin(elapsed * 3.2 + group.idlePhase) * 0.018;
    bubble.scale.set(1.45 * pulse, 0.58 * pulse, 1);
    const lines = ["方案怎么收敛？", "证据链够吗？", "我补一个角度", "这里需要验证"];
    updateBillboard(bubble, lines[Math.floor((elapsed + group.idlePhase) / 3) % lines.length]);
    return;
  }
  bubble.scale.lerp(new THREE.Vector3(0.01, 0.01, 1), 0.18);
  if (bubble.scale.x < 0.04) bubble.visible = false;
  group.nameLabel.visible = false;
  group.nameLabel.scale.lerp(new THREE.Vector3(1.55, 0.44, 1), 0.08);
}

// ── Simple transparent glass panel with a clean frame ──
function addGlassPanel(w, h, glassMat, frameMat) {
  // Returns one transparent panel plus a perimeter frame; no dense inner grid.
  const group = new THREE.Group();
  const panel = new THREE.Mesh(
    new THREE.BoxGeometry(w, h, 0.055),
    glassMat
  );
  panel.castShadow = false;
  panel.receiveShadow = false;
  group.add(panel);

  const barW = 0.022;
  const barD = 0.07;
  // Perimeter frame
  const perimMat = frameMat || new THREE.MeshStandardMaterial({ color: 0xbfcdc9, roughness: 0.5, metalness: 0.15 });
  const topBar = new THREE.Mesh(new THREE.BoxGeometry(w + 0.04, barW, barD), perimMat);
  topBar.position.set(0, h / 2 + barW / 2, 0);
  topBar.castShadow = false;
  topBar.receiveShadow = false;
  group.add(topBar);
  // No bottom bar (was visible as a line on the floor)
  const leftBar = new THREE.Mesh(new THREE.BoxGeometry(barW, h + 0.04, barD), perimMat);
  leftBar.position.set(-w / 2 - barW / 2, 0, 0);
  leftBar.castShadow = false;
  leftBar.receiveShadow = false;
  group.add(leftBar);
  const rightBar = new THREE.Mesh(new THREE.BoxGeometry(barW, h + 0.04, barD), perimMat);
  rightBar.position.set(w / 2 + barW / 2, 0, 0);
  rightBar.castShadow = false;
  rightBar.receiveShadow = false;
  group.add(rightBar);

  return group;
}

function addOfficeProps(scene) {
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(3.2, 1.15, 0.08),
    new THREE.MeshStandardMaterial({ color: 0xf8fbfa, roughness: 0.72 })
  );
  board.position.set(-3.5, 2.2, -5.88);
  board.castShadow = true;
  scene.add(board);

  const boardLine = new THREE.Mesh(
    new THREE.BoxGeometry(2.45, 0.035, 0.03),
    new THREE.MeshStandardMaterial({ color: 0x77a99b, emissive: 0x77a99b, emissiveIntensity: 0.08 })
  );
  boardLine.position.set(-3.5, 2.35, -5.8);
  scene.add(boardLine);

  const shelf = new THREE.Group();
  for (let row = 0; row < 2; row += 1) {
    const plank = new THREE.Mesh(
      new THREE.BoxGeometry(2.35, 0.08, 0.35),
      new THREE.MeshStandardMaterial({ color: 0xd9e0dd, roughness: 0.74 })
    );
    plank.position.set(0, row * 0.62, 0);
    shelf.add(plank);
    for (let i = 0; i < 8; i += 1) {
      const book = new THREE.Mesh(
        new THREE.BoxGeometry(0.16, 0.42 + (i % 3) * 0.05, 0.22),
        new THREE.MeshStandardMaterial({ color: [0x2f8cff, 0x8bc47c, 0xffd64d, 0xff6f61][i % 4], roughness: 0.6 })
      );
      book.position.set(-0.92 + i * 0.25, row * 0.62 + 0.24, -0.04);
      shelf.add(book);
    }
  }
  shelf.position.set(5.3, 1.26, -5.88);
  scene.add(shelf);

  // ── Entry door with swinging leaf ──
  const doorFrameMaterial = new THREE.MeshStandardMaterial({ color: 0xd5dfdc, roughness: 0.68 });
  const entryDoor = new THREE.Group();
  // Frame jambs (static, not part of pivot)
  for (const z of [0.58, 1.82]) {
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.45, 0.08), doorFrameMaterial);
    jamb.position.set(10.72, 1.22, z);
    entryDoor.add(jamb);
  }
  const lintel = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.08, 1.32), doorFrameMaterial);
  lintel.position.set(10.72, 2.42, 1.2);
  entryDoor.add(lintel);
  // Door pivot at hinge side (z=0.58)
  const entryDoorPivot = new THREE.Group();
  entryDoorPivot.position.set(10.72, 0, 0.58);
  // Door leaf: extends from z=0 to z=1.16 relative to pivot
  const doorLeaf = new THREE.Group();
  doorLeaf.position.set(0, 0, 0.04);
  const doorPanel = new THREE.Mesh(
    new THREE.BoxGeometry(0.09, 2.25, 1.16),
    new THREE.MeshStandardMaterial({ color: 0xe8efec, roughness: 0.7 })
  );
  doorPanel.position.set(0, 1.12, 0.58);
  doorLeaf.add(doorPanel);
  const doorWindow = new THREE.Mesh(
    new THREE.BoxGeometry(0.095, 0.55, 0.62),
    new THREE.MeshStandardMaterial({ color: 0xd5dfdc, roughness: 0.55 })
  );
  doorWindow.position.set(-0.01, 1.62, 0.58);
  doorLeaf.add(doorWindow);
  const handle = new THREE.Mesh(
    new THREE.SphereGeometry(0.045, 14, 10),
    new THREE.MeshStandardMaterial({ color: 0x95a09c, roughness: 0.45, metalness: 0.2 })
  );
  handle.position.set(-0.07, 1.02, 1.05);
  doorLeaf.add(handle);
  entryDoorPivot.add(doorLeaf);
  entryDoor.add(entryDoorPivot);
  scene.add(entryDoor);
  // Store pivot reference for animation
  doorState.entry.group = entryDoorPivot;

  const glassMat = new THREE.MeshStandardMaterial({
    color: 0xd8edf0,
    transparent: true,
    opacity: 0.24,
    roughness: 0.2,
    metalness: 0.05,
  });
  const frameMat = new THREE.MeshStandardMaterial({ color: 0xbfcdc9, roughness: 0.5, metalness: 0.15 });
  const darkFrameMat = new THREE.MeshStandardMaterial({ color: 0xa5b5b1, roughness: 0.5, metalness: 0.18 });

  const GLASS_WALL_H = 3.45;
  const GLASS_ROOM_X_LEFT = -10.80;
  const GLASS_ROOM_X_RIGHT = -5.50;
  const GLASS_ROOM_W = GLASS_ROOM_X_RIGHT - GLASS_ROOM_X_LEFT;  // 5.3
  const roomCenterX = (GLASS_ROOM_X_LEFT + GLASS_ROOM_X_RIGHT) / 2; // -8.15

  // ── Meeting Room (bottom-left, z=-1.2~5.9) ──
  const meetingRoom = new THREE.Group();
  const meetingFloor = new THREE.Mesh(
    new THREE.BoxGeometry(5.3, 0.035, 11.8),
    new THREE.MeshStandardMaterial({ color: 0xeef3f1, roughness: 0.84 })
  );
  meetingFloor.position.set(roomCenterX, 0.025, 0);
  meetingRoom.add(meetingFloor);

  // Meeting room glass wall (right side, corridor-facing) — full wall with door near back
  // Back section: from z=-5.9 to door start (z=-4.5)
  const meetingBackGlass = addGlassPanel(1.4, GLASS_WALL_H, glassMat, darkFrameMat);
  meetingBackGlass.position.set(GLASS_ROOM_X_RIGHT, 1.75, -5.2);
  meetingBackGlass.rotation.y = Math.PI / 2;
  meetingBackGlass.visible = true;
  meetingRoom.add(meetingBackGlass);
  // Main section: from door end (z=-3.5) to z=5.9
  const meetingMainGlass = addGlassPanel(9.4, GLASS_WALL_H, glassMat, darkFrameMat);
  meetingMainGlass.position.set(GLASS_ROOM_X_RIGHT, 1.75, 1.2);
  meetingMainGlass.rotation.y = Math.PI / 2;
  meetingMainGlass.visible = true;
  meetingRoom.add(meetingMainGlass);

  // Meeting room front glass wall (z=5.9, facing viewer)
  const meetingFrontWallG = addGlassPanel(5.3, GLASS_WALL_H, glassMat, darkFrameMat);
  meetingFrontWallG.position.set(roomCenterX, 1.75, 5.9);
  meetingFrontWallG.visible = true;
  meetingRoom.add(meetingFrontWallG);

  // Meeting room right-side door (near back wall, opening outward toward corridor)
  // Door gap: z=-4.5 to z=-3.5 (width 1.0), center z=-4.0
  const doorZ = -4.0;
  const doorWidth = 1.0;
  const doorHalf = doorWidth / 2;
  // Door frame header (static)
  const doorHeader = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.08, doorWidth + 0.08),
    darkFrameMat
  );
  doorHeader.position.set(-5.50, 2.2, doorZ);
  meetingRoom.add(doorHeader);
  // Door jambs (static)
  for (const zJ of [doorZ - doorHalf, doorZ + doorHalf]) {
    const jamb = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 2.2, 0.08),
      darkFrameMat
    );
    jamb.position.set(-5.50, 1.1, zJ);
    meetingRoom.add(jamb);
  }
  // Door transom (glass above door, static)
  const doorTransom = addGlassPanel(doorWidth + 0.08, GLASS_WALL_H - 2.2, glassMat, darkFrameMat);
  doorTransom.position.set(GLASS_ROOM_X_RIGHT, 2.2 + (GLASS_WALL_H - 2.2) / 2, doorZ);
  doorTransom.rotation.y = Math.PI / 2;
  doorTransom.visible = true;
  meetingRoom.add(doorTransom);
  // Door pivot at hinge jamb (back side, z=-4.5)
  const meetingDoorPivot = new THREE.Group();
  meetingDoorPivot.position.set(-5.50, 0, doorZ - doorHalf);
  // Door leaf group (panel extends from z=0 to z=1.0 relative to pivot)
  const meetingDoorLeaf = new THREE.Group();
  meetingDoorLeaf.position.set(0.02, 1.1, doorHalf);
  const meetingDoorPanel = new THREE.Mesh(
    new THREE.BoxGeometry(0.04, 2.2, doorWidth),
    new THREE.MeshStandardMaterial({ color: 0xbfcdc9, roughness: 0.55, metalness: 0.12 })
  );
  meetingDoorPanel.position.set(0, 0, 0);
  meetingDoorLeaf.add(meetingDoorPanel);
  // Door pull handle on the leaf
  const doorPull = new THREE.Mesh(
    new THREE.CylinderGeometry(0.015, 0.015, 0.06, 6),
    new THREE.MeshStandardMaterial({ color: 0xd4cbaa, roughness: 0.3, metalness: 0.4 })
  );
  doorPull.position.set(0.06, 0, 0.45);
  doorPull.rotation.x = Math.PI / 2;
  meetingDoorLeaf.add(doorPull);
  meetingDoorPivot.add(meetingDoorLeaf);
  meetingRoom.add(meetingDoorPivot);
  // Store pivot reference for animation
  doorState.meeting.group = meetingDoorPivot;

  // Conference table and chairs
  const conferenceTable = new THREE.Mesh(
    new THREE.BoxGeometry(1.42, 0.2, 6.0),
    new THREE.MeshStandardMaterial({ color: 0xf7faf9, roughness: 0.74 })
  );
  conferenceTable.position.set(-8.25, 0.86, 0);
  conferenceTable.castShadow = true;
  conferenceTable.receiveShadow = true;
  meetingRoom.add(conferenceTable);
  for (const [x, z] of [[-9.0, -2.25], [-9.0, -0.75], [-9.0, 0.75], [-9.0, 2.25], [-7.5, -2.25], [-7.5, -0.75], [-7.5, 0.75], [-7.5, 2.25]]) {
    const mic = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.34, 10),
      new THREE.MeshStandardMaterial({ color: 0x596762, roughness: 0.45 }));
    mic.position.set(x, 1.05, z);
    mic.rotation.x = 0.75;
    meetingRoom.add(mic);
  }

  for (const [agentId, spot] of Object.entries(meetingSlots)) {
    const chair = createOfficeChair();
    chair.position.set(spot.x, 0.08, spot.z);
    // Straight rotations: left side faces right; right side faces left; head faces down the table
    if (spot.x < -8.0) {
      chair.rotation.y = agentId === "main" ? Math.PI : -Math.PI / 2;
    } else {
      chair.rotation.y = Math.PI / 2;
    }
    chair.scale.setScalar(agentId === "main" ? 1.08 : 0.95);
    meetingRoom.add(chair);
  }

  const wallScreen = new THREE.Mesh(
    new THREE.BoxGeometry(2.25, 1.05, 0.06),
    new THREE.MeshStandardMaterial({ color: 0x1b2b33, emissive: 0x15342e, emissiveIntensity: 0.02, roughness: 0.48 })
  );
  wallScreen.position.set(-8.15, 1.85, -5.88);
  wallScreen.rotation.y = Math.PI;
  scene.add(wallScreen);
  const screenLine = new THREE.Mesh(
    new THREE.BoxGeometry(1.7, 0.7, 0.04),
    new THREE.MeshBasicMaterial({ color: 0x78958c })
  );
  screenLine.position.set(-8.15, 2.0, -5.82);
  scene.add(screenLine);

  scene.add(meetingRoom);

  const smokingRoom = new THREE.Group();
  const smokingFloor = new THREE.Mesh(
    new THREE.BoxGeometry(3.55, 0.035, 3.05),
    new THREE.MeshStandardMaterial({ color: 0xf0f2ef, roughness: 0.86 })
  );
  smokingFloor.position.set(9.15, 0.025, -4.0);
  smokingRoom.add(smokingFloor);
  // Smoking room glass walls with frame grids
  const smokeBackWallG = addGlassPanel(3.55, GLASS_WALL_H, glassMat, darkFrameMat);
  smokeBackWallG.position.set(9.15, 1.75, -5.52);
  smokingRoom.add(smokeBackWallG);
  // Solid right wall with small window
  const smokeRightWall = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, GLASS_WALL_H, 3.05),
    new THREE.MeshStandardMaterial({ color: 0xc4d0cc, roughness: 0.6 })
  );
  smokeRightWall.position.set(10.92, 1.75, -4.0);
  smokingRoom.add(smokeRightWall);
  const smokeWindow = addGlassPanel(1.0, 1.0, glassMat, darkFrameMat);
  smokeWindow.position.set(10.96, 1.75, -4.0);
  smokeWindow.rotation.y = Math.PI / 2;
  smokeWindow.visible = true;
  smokingRoom.add(smokeWindow);
  const smokeLeftWallG = addGlassPanel(3.05, GLASS_WALL_H, glassMat, darkFrameMat);
  smokeLeftWallG.position.set(7.38, 1.75, -4.0);
  smokeLeftWallG.rotation.y = Math.PI / 2;
  smokingRoom.add(smokeLeftWallG);
  const smokeFrontA = addGlassPanel(1.18, GLASS_WALL_H, glassMat, darkFrameMat);
  smokeFrontA.position.set(7.97, 1.75, -2.48);
  smokingRoom.add(smokeFrontA);
  const smokeFrontB = addGlassPanel(1.18, GLASS_WALL_H, glassMat, darkFrameMat);
  smokeFrontB.position.set(10.33, 1.75, -2.48);
  smokingRoom.add(smokeFrontB);
  const smokeDoorHeader = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.08, 0.07),
    new THREE.MeshStandardMaterial({ color: 0xcad9d5, roughness: 0.5, metalness: 0.08 })
  );
  smokeDoorHeader.position.set(9.15, 2.58, -2.46);
  smokingRoom.add(smokeDoorHeader);
  for (const x of [8.57, 9.73]) {
    const jamb = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.55, 0.07), smokeDoorHeader.material);
    jamb.position.set(x, 1.28, -2.46);
    smokingRoom.add(jamb);
  }
  const smokeTransom = new THREE.Mesh(
    new THREE.BoxGeometry(1.14, 0.82, 0.055),
    glassMat
  );
  smokeTransom.position.set(9.15, 3.02, -2.48);
  smokingRoom.add(smokeTransom);
  const sofaMat = new THREE.MeshStandardMaterial({ color: 0xdfe7e4, roughness: 0.78 });
  const sofaSeat = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.18, 0.48), sofaMat);
  sofaSeat.position.set(9.05, 0.48, -5.02);
  smokingRoom.add(sofaSeat);
  const sofaBack = new THREE.Mesh(new THREE.BoxGeometry(1.45, 0.58, 0.12), sofaMat);
  sofaBack.position.set(9.05, 0.78, -5.31);
  smokingRoom.add(sofaBack);
  const ashtray = new THREE.Mesh(
    new THREE.CylinderGeometry(0.16, 0.18, 0.08, 20),
    new THREE.MeshStandardMaterial({ color: 0x88928e, roughness: 0.5, metalness: 0.15 })
  );
  ashtray.position.set(9.15, 0.54, -4.05);
  smokingRoom.add(ashtray);
  const roomSmokePuffs = [];
  for (let i = 0; i < 7; i += 1) {
    const smoke = new THREE.Mesh(
      new THREE.TorusGeometry(0.055 + i * 0.012, 0.006, 8, 18),
      new THREE.MeshBasicMaterial({ color: 0xb8c4c0, transparent: true, opacity: 0.36 - i * 0.03 })
    );
    smoke.position.set(9.15 + Math.sin(i) * 0.35, 0.78 + i * 0.16, -4.05 + Math.cos(i) * 0.24);
    smoke.rotation.x = Math.PI / 2;
    smoke.userData.roomSmokeIndex = i;
    roomSmokePuffs.push(smoke);
    smokingRoom.add(smoke);
  }
  scene.userData.roomSmokePuffs = roomSmokePuffs;
  const vent = new THREE.Mesh(
    new THREE.BoxGeometry(0.65, 0.08, 0.42),
    new THREE.MeshStandardMaterial({ color: 0xcfd8d5, roughness: 0.55 })
  );
  vent.position.set(9.15, 2.88, -5.42);
  smokingRoom.add(vent);

  scene.add(smokingRoom);

  const clock = new THREE.Group();
  // Dark rim ring so clock is visible against white wall
  const rim = new THREE.Mesh(
    new THREE.TorusGeometry(0.34, 0.04, 16, 32),
    new THREE.MeshStandardMaterial({ color: 0x233036, roughness: 0.6 })
  );
  rim.position.z = 0.02;
  clock.add(rim);
  const face = new THREE.Mesh(
    new THREE.CylinderGeometry(0.32, 0.32, 0.035, 32),
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.55 })
  );
  face.rotation.x = Math.PI / 2;
  clock.add(face);
  const hour = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.22, 0.025), new THREE.MeshBasicMaterial({ color: 0x233036 }));
  hour.position.set(0, 0.05, 0.035);
  hour.name = "hourHand";
  clock.add(hour);
  const minute = new THREE.Mesh(new THREE.BoxGeometry(0.026, 0.29, 0.025), new THREE.MeshBasicMaterial({ color: 0x233036 }));
  minute.position.set(0, 0.08, 0.04);
  minute.name = "minuteHand";
  clock.add(minute);
  clock.position.set(0, 2.85, -5.82);
  clock.userData = { hour, minute };
  scene.add(clock);
  scene.userData.clock = clock;
}

function setActiveAgent(agentId, status) {
  state.activeAgent = agentId
    ? (officeAgents.some((agent) => agent.id === agentId) ? agentId : "main")
    : "";
  state.activeMessage = status || `${agentId} 发言中`;
  state.meetingDone = /完成|生成/.test(state.activeMessage);
  els.sceneStatus.textContent = status || `${agentId} 发言中`;
  updateSpeechBubble(state.activeAgent, state.activeMessage);
  updateEmployeeLegendActive();
}

function updateSpeechBubble(agentId, text) {
  if (!state.office || !state.office.groups[agentId]) return;
  updateBillboard(state.office.groups[agentId].speechBubble, text || "Thinking...");
}

function syncOfficeLabels(agents) {
  const known = new Map(agents.map((agent) => [agent.id || agent.agent_id, agent.name || agent.identityName || agent.agent_id || agent.id]));
  for (const item of officeAgents) {
    if (known.has(item.id)) {
      item.label = known.get(item.id);
    }
  }
  renderEmployeeLegend();
}

function renderEmployeeLegend() {
  if (!els.employeeLegend) return;
  els.employeeLegend.innerHTML = officeAgents.filter((agent) => !agent.vacant).map((agent) => `
    <article class="employee-card" data-agent-id="${escapeHtml(agent.id)}">
      <span class="employee-dot" style="color:#${agent.color.toString(16).padStart(6, "0")}; background:#${agent.color.toString(16).padStart(6, "0")}"></span>
      <span class="employee-text">
        <strong>${escapeHtml(agent.label)}</strong>
        <span>${escapeHtml(agent.role)}</span>
      </span>
    </article>
  `).join("");
  updateEmployeeLegendActive();
}

function updateEmployeeLegendActive() {
  if (!els.employeeLegend) return;
  for (const item of els.employeeLegend.querySelectorAll(".employee-card")) {
    item.classList.toggle("active", item.dataset.agentId === state.activeAgent);
  }
}

function syncOfficeFromJobs(jobs) {
  const activeJob = jobs.find((job) => job.status === "running") || jobs[0];
  if (!activeJob) {
    state.taskActive = false;
    state.meeting.isRunning = false;
    finishTaskBriefing();
    els.stopMeeting.disabled = true;
    setActiveAgent("", "等待开会");
    renderAgentSidebar();
    return;
  }
  state.taskActive = activeJob.status === "queued" || activeJob.status === "running";
  if (state.taskActive) {
    state.meeting.id = state.meeting.id || activeJob.job_id;
    state.meeting.jobId = activeJob.job_id;
    state.meeting.isRunning = true;
    state.meeting.stopped = false;
    state.meeting.participants = activeJob.events
      ? [...new Set(activeJob.events.map((event) => event.agent_id).filter(Boolean))]
      : [];
    if (state.briefing.active && state.briefing.jobId === activeJob.job_id) {
      state.meeting.participants = state.briefing.participants;
    }
    els.stopMeeting.disabled = false;
  } else {
    state.meeting.isRunning = false;
    finishTaskBriefing();
    els.stopMeeting.disabled = true;
  }
  for (const event of activeJob.events || []) {
    const key = `${activeJob.job_id}:${event.created_at}:${event.type}:${event.agent_id || ""}`;
    if (state.seenEventKeys.has(key)) continue;
    state.seenEventKeys.add(key);
    if (event.type === "meeting_started") {
      startTaskBriefing(activeJob.job_id, event.team || []);
      setActiveAgent("main", "Main 正在会议室布置任务");
      appendMeetingMessage(activeJob.job_id, "main", `Main 召集 ${state.briefing.participants.join(", ")} 到会议室布置任务。`, "system", event.created_at);
    } else if (event.type === "agent_started") {
      if (state.briefing.active && state.briefing.jobId === activeJob.job_id) {
        finishTaskBriefing();
        appendMeetingMessage(activeJob.job_id, "main", "任务布置完成，所有 Agent 返回工位开始执行。", "system", event.created_at);
      }
      setActiveAgent(event.agent_id, event.title || `${event.agent_id} 发言中`);
      appendMeetingMessage(activeJob.job_id, event.agent_id, event.title || "开始发言", "system", event.created_at);
    } else if (event.type === "agent_message") {
      setActiveAgent(event.agent_id, event.title || `${event.agent_id} 完成发言`);
      appendMeetingMessage(activeJob.job_id, event.agent_id, event.content || event.title || "", "assistant", event.created_at);
    } else if (event.type === "phase_changed") {
      els.sceneStatus.textContent = event.content || event.phase || "会议进行中";
      appendMeetingMessage(activeJob.job_id, "main", event.content || event.phase || "会议进行中", "system", event.created_at);
    } else if (event.type === "final_report_ready") {
      setActiveAgent("main", "最终报告已生成");
      appendMeetingMessage(activeJob.job_id, "main", "最终报告已生成", "system", event.created_at);
    } else if (event.type === "meeting_cancelled") {
      state.meeting.stopped = true;
      state.meeting.isRunning = false;
      setActiveAgent("", "会议已终止");
      appendMeetingMessage(activeJob.job_id, "main", event.content || "会议已终止", "system", event.created_at);
    }
  }
  if (activeJob.status === "queued") setActiveAgent("main", "排队中");
  if (activeJob.status === "done") setActiveAgent("main", "会议完成");
  if (activeJob.status === "cancelled") {
    state.taskActive = false;
    finishTaskBriefing();
    state.meeting.stopped = true;
    state.meeting.isRunning = false;
    els.stopMeeting.disabled = true;
    setActiveAgent("", "会议已终止");
  }
  renderAgentSidebar();
  renderMeetingLog();

  // Task override: after briefing, every visible agent is recalled to the workstation.
  const g = state.office?.groups;
  if (!g) return;
  if (!state.taskActive) return;
  if (state.briefing.active) return;
  for (const [agentId, group] of Object.entries(g)) {
    if (group.vacant) continue;
    const m = group.move;
    if (m.phase === 'atDesk' || m.phase === 'sittingDown') continue;
    m.behaviorState = OFFICE_BEHAVIOR_STATES.RETURNING;
    m.pendingDest = null;
  }
}

function appendLiveNote(title, content) {
  appendMeetingMessage(state.meeting.id || "live", title, content, "assistant");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

loadAll().catch((error) => {
  els.runtime.textContent = `连接失败：${error.message}`;
});
try {
  initOfficeScene();
} catch (e) {
  console.error('initOfficeScene FAILED:', e);
  els.runtime.textContent = '3D场景初始化失败: ' + e.message;
}
