// -------------------------------------------------------------------------
// Flappy Hands — hand-tracked flappy bird
// -------------------------------------------------------------------------
const gameEl      = document.getElementById("game");
const gameCanvas  = document.getElementById("game-canvas");
const gameCtx     = gameCanvas.getContext("2d");
const gameScoreEl = document.getElementById("game-score");

// Bird colors — each hand gets a different color
const BIRD_COLORS = [
  { body: "#5ac8fa", eye: "#fff", wing: "#3aa0d8" },   // blue
  { body: "#ff6b9d", eye: "#fff", wing: "#d94a7a" },   // pink
  { body: "#26de81", eye: "#fff", wing: "#1ab866" },   // green
  { body: "#ff9f43", eye: "#fff", wing: "#d98030" },   // orange
];

// Pipe colors cycle
const PIPE_COLORS = ["#1a3a5c", "#2a1a4c", "#1a4c3a", "#4c2a1a"];

let gameActive = false;
let pipes = [];
let birds = [];        // { y, vy, alive, colorIdx, deadTime }
let score = 0;
let pipeTimer = 0;
let lastGameTime = 0;

// Settings
const PIPE_WIDTH   = 60;
const PIPE_GAP     = 220;
const PIPE_SPEED   = 3;
let nextPipeIn = 90; // frames until next pipe
const BIRD_X       = 120;
const BIRD_RADIUS  = 18;
const GRAVITY      = 0.3;
const DEAD_LINGER  = 60;  // frames before dead bird disappears

function resizeGameCanvas() {
  gameCanvas.width  = window.innerWidth;
  gameCanvas.height = window.innerHeight;
}
window.addEventListener("resize", resizeGameCanvas);

// -------------------------------------------------------------------------
// Mode switching
// -------------------------------------------------------------------------
let currentMode = "todo";

document.querySelectorAll(".mode-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    const mode = btn.dataset.mode;
    if (mode === currentMode) return;
    currentMode = mode;

    document.querySelectorAll(".mode-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");

    if (mode === "game") {
      document.getElementById("app").style.display = "none";
      gameEl.classList.remove("hidden");
      resizeGameCanvas();
      startGame();
    } else {
      gameEl.classList.add("hidden");
      document.getElementById("app").style.display = "";
      gameActive = false;
    }
  });
});

// -------------------------------------------------------------------------
// Game loop
// -------------------------------------------------------------------------
function startGame() {
  pipes = [];
  birds = [];
  score = 0;
  pipeTimer = 0;
  gameActive = true;
  gameScoreEl.textContent = "SCORE: 0";
  lastGameTime = performance.now();
  requestAnimationFrame(gameLoop);
}

function gameLoop(timestamp) {
  if (!gameActive) return;

  const W = gameCanvas.width;
  const H = gameCanvas.height;

  // --- Update birds from hand tracking ---
  // `hands` is the global array from app.js
  const detectedHands = (typeof hands !== "undefined") ? hands : [];

  // Match birds to hands
  while (birds.length < detectedHands.length) {
    birds.push({
      x: BIRD_X,
      y: H / 2,
      vy: 0,
      alive: true,
      colorIdx: birds.length % BIRD_COLORS.length,
      deadTime: 0,
    });
  }

  // Update each bird
  for (let i = 0; i < birds.length; i++) {
    const bird = birds[i];

    if (i < detectedHands.length && bird.alive) {
      const hand = detectedHands[i];
      const indices = [0, 5, 9, 13, 17];
      let sx = 0, sy = 0;
      for (const idx of indices) {
        sx += hand.landmarks[idx].x;
        sy += hand.landmarks[idx].y;
      }
      // Mirror X, map both axes to screen
      const targetX = (1 - sx / indices.length) * W;
      const targetY = (sy / indices.length) * H;

      bird.x += (targetX - bird.x) * 0.25;
      bird.y += (targetY - bird.y) * 0.25;
      bird.vy = 0;
    } else if (bird.alive) {
      bird.alive = false;
      bird.vy = -2;
    }

    if (!bird.alive) {
      bird.vy += GRAVITY;
      bird.y += bird.vy;
      bird.deadTime++;
    }
  }

  // Remove dead birds that have lingered or fallen off screen
  birds = birds.filter(b => b.alive || (b.deadTime < DEAD_LINGER && b.y < H + 50));

  // --- Pipes ---
  pipeTimer++;
  if (pipeTimer >= nextPipeIn) {
    pipeTimer = 0;
    nextPipeIn = 70 + Math.floor(Math.random() * 163); // ~210px to ~700px apart at 3px/frame
    const gapY = 80 + Math.random() * (H - 160 - PIPE_GAP);
    pipes.push({
      x: W + PIPE_WIDTH,
      gapY,
      gap: PIPE_GAP,
      scored: false,
      colorIdx: pipes.length % PIPE_COLORS.length,
    });
  }

  for (const pipe of pipes) {
    pipe.x -= PIPE_SPEED;

    // Score when any alive bird passes pipe
    if (!pipe.scored) {
      const passed = birds.some(b => b.alive && b.x - BIRD_RADIUS > pipe.x + PIPE_WIDTH);
      if (passed) {
        score++;
        gameScoreEl.textContent = `SCORE: ${score}`;
        pipe.scored = true;
      }
    }
  }

  // Remove off-screen pipes
  pipes = pipes.filter(p => p.x + PIPE_WIDTH > -10);

  // --- Collision: birds are solid, walls are solid ---
  for (const bird of birds) {
    if (!bird.alive) continue;

    // Floor / ceiling kill
    if (bird.y - BIRD_RADIUS < 0 || bird.y + BIRD_RADIUS > H) {
      bird.alive = false;
      bird.vy = 0;
      continue;
    }

    for (const pipe of pipes) {
      const overlapX = bird.x + BIRD_RADIUS > pipe.x && bird.x - BIRD_RADIUS < pipe.x + PIPE_WIDTH;
      if (!overlapX) continue;

      const inGap = bird.y - BIRD_RADIUS >= pipe.gapY && bird.y + BIRD_RADIUS <= pipe.gapY + pipe.gap;
      if (inGap) {
        // Bird is in the gap — clamp Y so it can't escape through top/bottom walls
        if (bird.y - BIRD_RADIUS < pipe.gapY) {
          bird.y = pipe.gapY + BIRD_RADIUS;
        }
        if (bird.y + BIRD_RADIUS > pipe.gapY + pipe.gap) {
          bird.y = pipe.gapY + pipe.gap - BIRD_RADIUS;
        }
        continue;
      }

      // Bird is overlapping a pipe wall — figure out where it hit
      const birdCenterInGapY = bird.y > pipe.gapY && bird.y < pipe.gapY + pipe.gap;

      if (birdCenterInGapY) {
        // Bird center is in the gap zone but edges clip top or bottom wall
        // Clamp into the gap
        if (bird.y - BIRD_RADIUS < pipe.gapY) {
          bird.y = pipe.gapY + BIRD_RADIUS;
        }
        if (bird.y + BIRD_RADIUS > pipe.gapY + pipe.gap) {
          bird.y = pipe.gapY + pipe.gap - BIRD_RADIUS;
        }
      } else {
        // Bird hit the solid part of the pipe — die and fall in place
        bird.alive = false;
        bird.vy = 0;
        // Clamp X inside the pipe column so it falls within the valley
        if (bird.x < pipe.x) {
          bird.x = pipe.x - BIRD_RADIUS;
        } else if (bird.x > pipe.x + PIPE_WIDTH) {
          bird.x = pipe.x + PIPE_WIDTH + BIRD_RADIUS;
        }
        break;
      }
    }
  }

  // --- Draw ---
  // Background gradient
  const bgGrad = gameCtx.createLinearGradient(0, 0, 0, H);
  bgGrad.addColorStop(0, "#0a0e14");
  bgGrad.addColorStop(1, "#0f1923");
  gameCtx.fillStyle = bgGrad;
  gameCtx.fillRect(0, 0, W, H);

  // Grid lines (subtle)
  gameCtx.strokeStyle = "rgba(90, 200, 250, 0.03)";
  gameCtx.lineWidth = 1;
  for (let y = 0; y < H; y += 40) {
    gameCtx.beginPath();
    gameCtx.moveTo(0, y);
    gameCtx.lineTo(W, y);
    gameCtx.stroke();
  }

  // Pipes
  for (const pipe of pipes) {
    const pipeColor = PIPE_COLORS[pipe.colorIdx];
    const borderColor = "rgba(90, 200, 250, 0.2)";

    // Top pipe
    gameCtx.fillStyle = pipeColor;
    gameCtx.fillRect(pipe.x, 0, PIPE_WIDTH, pipe.gapY);
    gameCtx.strokeStyle = borderColor;
    gameCtx.lineWidth = 1.5;
    gameCtx.strokeRect(pipe.x, 0, PIPE_WIDTH, pipe.gapY);

    // Top pipe cap
    gameCtx.fillStyle = pipeColor;
    gameCtx.fillRect(pipe.x - 4, pipe.gapY - 16, PIPE_WIDTH + 8, 16);
    gameCtx.strokeRect(pipe.x - 4, pipe.gapY - 16, PIPE_WIDTH + 8, 16);

    // Bottom pipe
    const bottomY = pipe.gapY + pipe.gap;
    gameCtx.fillStyle = pipeColor;
    gameCtx.fillRect(pipe.x, bottomY, PIPE_WIDTH, H - bottomY);
    gameCtx.strokeRect(pipe.x, bottomY, PIPE_WIDTH, H - bottomY);

    // Bottom pipe cap
    gameCtx.fillRect(pipe.x - 4, bottomY, PIPE_WIDTH + 8, 16);
    gameCtx.strokeRect(pipe.x - 4, bottomY, PIPE_WIDTH + 8, 16);

    // Glow on pipe edges
    gameCtx.shadowColor = "rgba(90, 200, 250, 0.15)";
    gameCtx.shadowBlur = 8;
    gameCtx.strokeRect(pipe.x, 0, PIPE_WIDTH, pipe.gapY);
    gameCtx.strokeRect(pipe.x, bottomY, PIPE_WIDTH, H - bottomY);
    gameCtx.shadowBlur = 0;
  }

  // Birds
  for (const bird of birds) {
    const colors = BIRD_COLORS[bird.colorIdx];
    const alpha = bird.alive ? 1.0 : Math.max(0, 1 - bird.deadTime / DEAD_LINGER);

    gameCtx.save();
    gameCtx.globalAlpha = alpha;
    gameCtx.translate(bird.x, bird.y);

    // Rotation based on velocity
    const angle = bird.alive ? 0 : Math.min(bird.vy * 3, 90) * Math.PI / 180;
    gameCtx.rotate(angle);

    // Body glow
    gameCtx.shadowColor = colors.body;
    gameCtx.shadowBlur = bird.alive ? 15 : 5;

    // Body
    gameCtx.fillStyle = colors.body;
    gameCtx.beginPath();
    gameCtx.ellipse(0, 0, BIRD_RADIUS, BIRD_RADIUS * 0.8, 0, 0, Math.PI * 2);
    gameCtx.fill();

    // Wing
    gameCtx.fillStyle = colors.wing;
    const wingFlap = bird.alive ? Math.sin(performance.now() / 80) * 5 : 6;
    gameCtx.beginPath();
    gameCtx.ellipse(-4, wingFlap, BIRD_RADIUS * 0.55, BIRD_RADIUS * 0.35, -0.2, 0, Math.PI * 2);
    gameCtx.fill();

    // Eye
    gameCtx.shadowBlur = 0;
    gameCtx.fillStyle = colors.eye;
    gameCtx.beginPath();
    gameCtx.arc(8, -4, 4, 0, Math.PI * 2);
    gameCtx.fill();

    // Pupil
    gameCtx.fillStyle = "#0a0e14";
    gameCtx.beginPath();
    gameCtx.arc(9, -4, 2, 0, Math.PI * 2);
    gameCtx.fill();

    // Beak
    gameCtx.fillStyle = "#ffb347";
    gameCtx.beginPath();
    gameCtx.moveTo(BIRD_RADIUS - 2, -3);
    gameCtx.lineTo(BIRD_RADIUS + 10, 0);
    gameCtx.lineTo(BIRD_RADIUS - 2, 4);
    gameCtx.closePath();
    gameCtx.fill();

    gameCtx.restore();
  }

  // "No hands" prompt
  if (birds.filter(b => b.alive).length === 0 && detectedHands.length === 0) {
    gameCtx.fillStyle = "rgba(200, 220, 232, 0.5)";
    gameCtx.font = "16px -apple-system, sans-serif";
    gameCtx.textAlign = "center";
    gameCtx.fillText("Show your hand to spawn a bird", W / 2, H / 2);
  }

  requestAnimationFrame(gameLoop);
}
