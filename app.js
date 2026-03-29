// -------------------------------------------------------------------------
// DOM
// -------------------------------------------------------------------------
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
let video = null;

// Cards
let cards = [];
let nextId = 0;

// Hands (on window so game.js can access)
var hands = window.hands = [];

// localStorage
const STORAGE_KEY = "gesture-todo-items";

// -------------------------------------------------------------------------
// Init
// -------------------------------------------------------------------------
async function start() {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices.filter(d => d.kind === "videoinput");
    console.log("[GestureTodo] cameras:", cameras.map(c => c.label || c.deviceId));

    let constraints = { video: { width: 640, height: 480, facingMode: "user" } };
    if (cameras.length > 1) {
      const builtin = cameras.find(c => c.label.toLowerCase().includes("macbook") || c.label.toLowerCase().includes("facetime"));
      if (builtin) {
        constraints = { video: { deviceId: { exact: builtin.deviceId }, width: 640, height: 480 } };
        console.log("[GestureTodo] using camera:", builtin.label);
      }
    }

    const stream = await navigator.mediaDevices.getUserMedia(constraints);
    video = document.createElement("video");
    video.srcObject = stream;
    video.setAttribute("playsinline", "true");
    await video.play();
    console.log(`[GestureTodo] video: ${video.videoWidth}x${video.videoHeight}`);

    resizeCanvas();
    loadSavedCards();
    spawnBlankCards();

    // Init MediaPipe Hands (legacy API — proven reliable)
    const mpHands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/${file}`
    });
    mpHands.setOptions({
      maxNumHands: 4,
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });
    mpHands.onResults(onResults);

    // Use Camera utility for frame pumping
    const camera = new Camera(video, {
      onFrame: async () => {
        await mpHands.send({ image: video });
      },
      width: 640,
      height: 480,
    });
    camera.start();
    console.log("[GestureTodo] camera loop started");

  } catch (e) {
    console.error("[GestureTodo] startup error:", e);
  }
}

function resizeCanvas() {
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeCanvas);

// -------------------------------------------------------------------------
// MediaPipe results callback
// -------------------------------------------------------------------------
function onResults(results) {
  const detectedHands = results.multiHandLandmarks || [];

  const prevHands = hands;
  hands = window.hands = detectedHands.map((landmarks, i) => {
    const prev = prevHands[i] || { grabbing: false, grabbedCard: null, prevGrab: false };
    const grab = isGrabbing(landmarks);
    return { landmarks, grabbing: grab, grabbedCard: prev.grabbedCard, prevGrab: prev.grabbing };
  });

  // Clear grabs for disappeared hands
  for (let i = hands.length; i < prevHands.length; i++) {
    if (prevHands[i] && prevHands[i].grabbedCard) {
      prevHands[i].grabbedCard.el.classList.remove("grabbed");
    }
  }

  hudHands.textContent = `HANDS: ${hands.length}`;

  // Clear hover
  cards.forEach(c => c.el.classList.remove("hovered"));
  [zoneSupply, zoneEdit, zoneSaved, zoneComplete].forEach(z => z.classList.remove("zone-active"));

  for (const hand of hands) {
    const center = handCenter(hand.landmarks);
    const justGrabbed  = hand.grabbing && !hand.prevGrab;
    const justReleased = !hand.grabbing && hand.prevGrab;

    if (!hand.grabbing && !hand.grabbedCard) {
      const hovered = cardAt(center.x, center.y);
      if (hovered) hovered.el.classList.add("hovered");
    }

    const zone = zoneAt(center.x, center.y);
    if (zone === "supply")   zoneSupply.classList.add("zone-active");
    if (zone === "edit")     zoneEdit.classList.add("zone-active");
    if (zone === "saved")    zoneSaved.classList.add("zone-active");
    if (zone === "complete") zoneComplete.classList.add("zone-active");

    if (justGrabbed && !hand.grabbedCard) {
      const target = cardAt(center.x, center.y);
      if (target && target.state !== "complete") {
        hand.grabbedCard = target;
        target.el.classList.add("grabbed");
        if (target.state === "blank") {
          target.state = "editing";
          target.el.classList.remove("blank");
          target.el.classList.add("editing");
          target.el.textContent = target.text || "...";
        }
      }
    }

    if (hand.grabbing && hand.grabbedCard) {
      const card = hand.grabbedCard;
      card.x = center.x - 90;
      card.y = center.y - 25;
      positionCard(card);
    }

    if (justReleased && hand.grabbedCard) {
      const card = hand.grabbedCard;
      card.el.classList.remove("grabbed");
      hand.grabbedCard = null;
      handleDrop(card, zoneAt(center.x, center.y), center);
    }
  }

  drawHands();
}

// -------------------------------------------------------------------------
// LocalStorage
// -------------------------------------------------------------------------
function loadSavedCards() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    const savedZone = zoneSaved.getBoundingClientRect();
    data.forEach((item, i) => {
      const card = createCard(item.text, item.state === "complete" ? "complete" : "saved");
      card.x = savedZone.left + 20;
      card.y = savedZone.top + 30 + i * 60;
      positionCard(card);
    });
  } catch(e) {}
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
  const tips = TIPS.map(i => landmarks[i]);
  let totalDist = 0, count = 0;
  for (let i = 0; i < tips.length; i++) {
    for (let j = i + 1; j < tips.length; j++) {
      totalDist += Math.hypot(tips[i].x - tips[j].x, tips[i].y - tips[j].y);
      count++;
    }
  }
  return (totalDist / count) < 0.09;
}

function handCenter(landmarks) {
  const indices = [0, 5, 9, 13, 17];
  let sx = 0, sy = 0;
  for (const i of indices) { sx += landmarks[i].x; sy += landmarks[i].y; }
  return {
    x: (1 - sx / indices.length) * canvas.width,
    y: (sy / indices.length) * canvas.height
  };
}

function cardAt(x, y) {
  for (let i = cards.length - 1; i >= 0; i--) {
    const c = cards[i];
    if (c.state === "complete") continue;
    const r = c.el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return c;
  }
  return null;
}

function zoneAt(x, y) {
  for (const [name, el] of [["supply", zoneSupply], ["edit", zoneEdit], ["saved", zoneSaved], ["complete", zoneComplete]]) {
    const r = el.getBoundingClientRect();
    if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return name;
  }
  return null;
}

// -------------------------------------------------------------------------
// Drop handling
// -------------------------------------------------------------------------
let editingCard = null;

function handleDrop(card, dropZone, pos) {
  if (dropZone === "edit" && (card.state === "editing" || card.state === "blank")) {
    card.state = "editing";
    card.el.className = "todo-card editing";
    editingCard = card;
    editInput.classList.remove("hidden");
    editInput.value = card.text;
    editInput.focus();
    hudStatus.textContent = "TYPE → ENTER TO CONFIRM";
  } else if (dropZone === "saved" && card.state === "editing" && card.text.trim()) {
    card.state = "saved";
    card.el.className = "todo-card saved";
    card.el.textContent = card.text;
    stopEditing();
    persistCards();
    spawnBlankCards();
    hudStatus.textContent = "SAVED";
    setTimeout(() => { if (hudStatus.textContent === "SAVED") hudStatus.textContent = ""; }, 2000);
  } else if (dropZone === "complete" && card.state === "saved") {
    card.state = "complete";
    card.el.className = "todo-card completing";
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
// Edit input
// -------------------------------------------------------------------------
editInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && editingCard) {
    editingCard.text = editInput.value.trim();
    if (editingCard.text) editingCard.el.textContent = editingCard.text;
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

    const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius + 12);
    gradient.addColorStop(0, hand.grabbing ? `${BLUE}0.5)` : `${BLUE}0.3)`);
    gradient.addColorStop(1, `${BLUE}0)`);
    ctx.beginPath();
    ctx.arc(center.x, center.y, radius + 12, 0, Math.PI * 2);
    ctx.fillStyle = gradient;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
    ctx.fillStyle = hand.grabbing ? `${BLUE}0.8)` : `${BLUE}0.5)`;
    ctx.fill();

    ctx.beginPath();
    ctx.arc(center.x, center.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
  }
}

// -------------------------------------------------------------------------
// Start
// -------------------------------------------------------------------------
start();
