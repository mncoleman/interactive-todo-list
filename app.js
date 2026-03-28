import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/vision_bundle.mjs";

// -------------------------------------------------------------------------
// DOM
// -------------------------------------------------------------------------
const cameraOverlay = document.getElementById("camera-overlay");
const enableBtn     = document.getElementById("enable-camera");
const appEl         = document.getElementById("app");
const canvas        = document.getElementById("hand-canvas");
const ctx           = canvas.getContext("2d");
const cardContainer = document.getElementById("card-container");
const editInput     = document.getElementById("edit-input");
const hudHands      = document.getElementById("hud-hands");
const hudStatus     = document.getElementById("hud-status");
const zoneSupply    = document.getElementById("zone-supply");
const zoneEdit      = document.getElementById("zone-edit");
const zoneSaved     = document.getElementById("zone-saved");
const zoneComplete  = document.getElementById("zone-complete");

// -------------------------------------------------------------------------
// State
// -------------------------------------------------------------------------
const TIPS = [4, 8, 12, 16, 20];
const BLUE  = "rgba(90,200,250,";
let handLandmarker = null;
let video = null;
let lastTimestamp = -1;

// Cards
let cards = [];       // { id, text, state: 'blank'|'editing'|'saved'|'complete', el, x, y }
let nextId = 0;

// Hands
let hands = [];       // { landmarks[], grabbing: bool, grabbedCard: card|null, prevGrab: bool }

// localStorage
const STORAGE_KEY = "gesture-todo-items";

// -------------------------------------------------------------------------
// Init
// -------------------------------------------------------------------------
enableBtn.addEventListener("click", async () => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 640, height: 480, facingMode: "user" }
    });
    video = document.createElement("video");
    video.srcObject = stream;
    video.setAttribute("playsinline", "true");
    await video.play();

    cameraOverlay.classList.add("hidden");
    appEl.classList.remove("hidden");
    resizeCanvas();

    await initHandLandmarker();
    loadSavedCards();
    spawnBlankCards();
    requestAnimationFrame(loop);
  } catch (e) {
    console.error("Camera error:", e);
    enableBtn.textContent = "Camera denied — please allow and retry";
  }
});

async function initHandLandmarker() {
  const filesetResolver = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
  );
  handLandmarker = await HandLandmarker.createFromOptions(filesetResolver, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task",
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numHands: 4,
    minHandDetectionConfidence: 0.55,
    minHandPresenceConfidence: 0.55,
    minTrackingConfidence: 0.45,
  });
}

function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeCanvas);

// -------------------------------------------------------------------------
// LocalStorage
// -------------------------------------------------------------------------
function loadSavedCards() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    const savedZone = zoneSaved.getBoundingClientRect();
    data.forEach((item, i) => {
      const card = createCard(item.text, item.state === "complete" ? "complete" : "saved");
      // Stack in saved zone
      card.x = savedZone.left + 20;
      card.y = savedZone.top + 30 + i * 60;
      positionCard(card);
    });
  } catch(e) { /* ignore corrupt data */ }
}

function persistCards() {
  const data = cards
    .filter(c => c.state === "saved" || c.state === "complete")
    .map(c => ({ text: c.text, state: c.state }));
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

// -------------------------------------------------------------------------
// Cards
// -------------------------------------------------------------------------
function createCard(text, state) {
  const el = document.createElement("div");
  el.classList.add("todo-card");
  if (state === "blank") {
    el.classList.add("blank");
    el.textContent = "+ new task";
  } else {
    el.textContent = text || "";
    el.classList.add(state);
  }
  cardContainer.appendChild(el);

  const card = { id: nextId++, text: text || "", state, el, x: 0, y: 0 };
  cards.push(card);
  return card;
}

function positionCard(card) {
  card.el.style.left = card.x + "px";
  card.el.style.top  = card.y + "px";
}

function spawnBlankCards() {
  const zone = zoneSupply.getBoundingClientRect();
  const blankCount = cards.filter(c => c.state === "blank").length;
  for (let i = blankCount; i < 3; i++) {
    const card = createCard("", "blank");
    card.x = zone.left + 20;
    card.y = zone.top + 30 + i * 60;
    positionCard(card);
  }
}

function removeCard(card) {
  card.el.remove();
  cards = cards.filter(c => c.id !== card.id);
}

// -------------------------------------------------------------------------
// Gesture detection
// -------------------------------------------------------------------------
function isGrabbing(landmarks) {
  // Grab = fingertips close together (tight cluster)
  const tips = TIPS.map(i => landmarks[i]);
  let totalDist = 0;
  let count = 0;
  for (let i = 0; i < tips.length; i++) {
    for (let j = i + 1; j < tips.length; j++) {
      const dx = tips[i].x - tips[j].x;
      const dy = tips[i].y - tips[j].y;
      totalDist += Math.sqrt(dx * dx + dy * dy);
      count++;
    }
  }
  const avgDist = totalDist / count;
  return avgDist < 0.09;  // normalized coords — tight cluster
}

function handCenter(landmarks) {
  // Use palm center (average of wrist + MCP joints)
  const indices = [0, 5, 9, 13, 17];
  let sx = 0, sy = 0;
  for (const i of indices) {
    sx += landmarks[i].x;
    sy += landmarks[i].y;
  }
  return {
    x: (1 - sx / indices.length) * canvas.width,   // mirror
    y: (sy / indices.length) * canvas.height
  };
}

function cardAt(x, y) {
  // Find topmost card at position (excluding completing cards)
  for (let i = cards.length - 1; i >= 0; i--) {
    const c = cards[i];
    if (c.state === "complete") continue;
    const r = c.el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return c;
    }
  }
  return null;
}

function zoneAt(x, y) {
  for (const [name, el] of [["supply", zoneSupply], ["edit", zoneEdit], ["saved", zoneSaved], ["complete", zoneComplete]]) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) {
      return name;
    }
  }
  return null;
}

// -------------------------------------------------------------------------
// Main loop
// -------------------------------------------------------------------------
let editingCard = null;

function loop() {
  if (!video || video.readyState < 2) {
    requestAnimationFrame(loop);
    return;
  }

  const now = performance.now();
  if (now === lastTimestamp) {
    requestAnimationFrame(loop);
    return;
  }
  lastTimestamp = now;

  // Detect hands
  const results = handLandmarker.detectForVideo(video, now);
  const detectedHands = results.handLandmarks || [];

  // Update hand state
  const prevHands = hands;
  hands = detectedHands.map((landmarks, i) => {
    const prev = prevHands[i] || { grabbing: false, grabbedCard: null, prevGrab: false };
    const grab = isGrabbing(landmarks);
    return {
      landmarks,
      grabbing: grab,
      grabbedCard: prev.grabbedCard,
      prevGrab: prev.grabbing,
    };
  });

  // Clear old grabs for hands that disappeared
  for (let i = hands.length; i < prevHands.length; i++) {
    if (prevHands[i] && prevHands[i].grabbedCard) {
      prevHands[i].grabbedCard.el.classList.remove("grabbed");
    }
  }

  hudHands.textContent = `HANDS: ${hands.length}`;

  // --- Process each hand ---
  // First clear all hover states
  cards.forEach(c => c.el.classList.remove("hovered"));
  [zoneSupply, zoneEdit, zoneSaved, zoneComplete].forEach(z => z.classList.remove("zone-active"));

  for (const hand of hands) {
    const center = handCenter(hand.landmarks);
    const justGrabbed  = hand.grabbing && !hand.prevGrab;
    const justReleased = !hand.grabbing && hand.prevGrab;

    // Hover effect
    if (!hand.grabbing && !hand.grabbedCard) {
      const hovered = cardAt(center.x, center.y);
      if (hovered) hovered.el.classList.add("hovered");
    }

    // Highlight zone under cursor
    const zone = zoneAt(center.x, center.y);
    if (zone === "supply")   zoneSupply.classList.add("zone-active");
    if (zone === "edit")     zoneEdit.classList.add("zone-active");
    if (zone === "saved")    zoneSaved.classList.add("zone-active");
    if (zone === "complete") zoneComplete.classList.add("zone-active");

    // GRAB
    if (justGrabbed && !hand.grabbedCard) {
      const target = cardAt(center.x, center.y);
      if (target && target.state !== "complete") {
        hand.grabbedCard = target;
        target.el.classList.add("grabbed");

        // If grabbing a blank, convert to editing-ready
        if (target.state === "blank") {
          target.state = "editing";
          target.el.classList.remove("blank");
          target.el.classList.add("editing");
          target.el.textContent = target.text || "...";
        }
      }
    }

    // DRAG
    if (hand.grabbing && hand.grabbedCard) {
      const card = hand.grabbedCard;
      card.x = center.x - 90;  // center on card
      card.y = center.y - 25;
      positionCard(card);
    }

    // RELEASE
    if (justReleased && hand.grabbedCard) {
      const card = hand.grabbedCard;
      card.el.classList.remove("grabbed");
      hand.grabbedCard = null;

      const dropZone = zoneAt(center.x, center.y);
      handleDrop(card, dropZone, center);
    }
  }

  // Draw hand dots
  drawHands();

  requestAnimationFrame(loop);
}

function handleDrop(card, dropZone, pos) {
  if (dropZone === "edit" && (card.state === "editing" || card.state === "blank")) {
    // Start editing
    card.state = "editing";
    card.el.className = "todo-card editing";
    editingCard = card;
    editInput.classList.remove("hidden");
    editInput.value = card.text;
    editInput.focus();
    hudStatus.textContent = "TYPE → ENTER TO CONFIRM";
  } else if (dropZone === "saved" && card.state === "editing" && card.text.trim()) {
    // Save
    card.state = "saved";
    card.el.className = "todo-card saved";
    card.el.textContent = card.text;
    stopEditing();
    persistCards();
    spawnBlankCards();
    hudStatus.textContent = "SAVED";
    setTimeout(() => { if (hudStatus.textContent === "SAVED") hudStatus.textContent = ""; }, 2000);
  } else if (dropZone === "complete" && card.state === "saved") {
    // Complete — black hole animation
    card.state = "complete";
    card.el.className = "todo-card completing";

    // Animate toward center
    const cx = window.innerWidth / 2 - 90;
    const cy = window.innerHeight / 2 - 25;
    card.el.style.left = cx + "px";
    card.el.style.top  = cy + "px";

    setTimeout(() => {
      removeCard(card);
      persistCards();
      hudStatus.textContent = "COMPLETED";
      setTimeout(() => { if (hudStatus.textContent === "COMPLETED") hudStatus.textContent = ""; }, 2000);
    }, 650);
  }
}

// -------------------------------------------------------------------------
// Edit input handler
// -------------------------------------------------------------------------
editInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && editingCard) {
    editingCard.text = editInput.value.trim();
    if (editingCard.text) {
      editingCard.el.textContent = editingCard.text;
    }
    stopEditing();
  } else if (e.key === "Escape") {
    stopEditing();
  }
});

editInput.addEventListener("input", () => {
  if (editingCard) {
    editingCard.text = editInput.value;
    editingCard.el.textContent = editInput.value || "...";
  }
});

function stopEditing() {
  editInput.classList.add("hidden");
  editInput.blur();
  editingCard = null;
  hudStatus.textContent = "";
}

// -------------------------------------------------------------------------
// Draw hand dots
// -------------------------------------------------------------------------
function drawHands() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (const hand of hands) {
    const center = handCenter(hand.landmarks);
    const radius = hand.grabbing ? 14 : 10;

    // Outer glow
    const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius + 12);
    gradient.addColorStop(0, hand.grabbing ? `${BLUE}0.5)` : `${BLUE}0.3)`);
    gradient.addColorStop(1, `${BLUE}0)`);
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius + 12, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    // Core dot
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = hand.grabbing ? `${BLUE}0.8)` : `${BLUE}0.5)`;
    ctx.fill();

    // Bright center
    ctx.beginPath();
    ctx.arc(center.x, center.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
  }
}
