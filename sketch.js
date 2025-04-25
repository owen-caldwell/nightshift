/**
 * Night Shift
 * Owen Caldwell
 * April 25, 2025
 *
 * Night Shift uses a Frame Differencing technique commonly used in surveillance technology to plot the movements of people in an exhibition space. A camera takes a photo of the empty environment and a p5.js program calculates the difference between the original image and the latest updated frame. Positions are plotted live on a digital screen, higher speeds are represented with red coloring and decaying trails are drawn to show movement.
 *
 * Sources:
 * - Based on p5.js library for webcam capture and rendering
 * - Inspired by Sovit Ranjan Rath's article on Frame Differencing (https://debuggercafe.com/moving-object-detection-using-frame-differencing-with-opencv/)
 * - Inspired by Aaron Koblin's Flight Patterns (https://www.aaronkoblin.com/project/flight-patterns/)
 * - Incorporates an efficient grid-based blob detection by dgrantham01 (https://editor.p5js.org/dgrantham01/sketches/K5rX9oPHl)
 */

let video, prevFrame, diffImage;
let motionTrails = {};

// Detection parameters
const MOTION_THRESHOLD = 20;
const GRID_SIZE = 10;
const MIN_GRIDS_FOR_BLOB = 1;
const MAX_BLOBS = 100;

// Motion smoothing
const POSITION_SMOOTH_FACTOR = 0.8;
const VELOCITY_SMOOTH_FACTOR = 0.5;

// Trail parameters
const MAX_TRAIL_LENGTH = 50;
const TRAIL_DECAY = 8;
const MAX_MATCH_DISTANCE = 100;
const MAX_SPEED_FOR_COLOR = 50;

function setup() {
  createCanvas(windowWidth, windowHeight);
  video = createCapture(VIDEO);
  video.size(width / 2, height / 2); // Lower resolution for performance
  video.hide();

  prevFrame = createImage(video.width, video.height);
  diffImage = createImage(video.width, video.height);

  pixelDensity(1);
  frameRate(30);
  background(0);
}

function draw() {
  // Fade background for trails
  background(0, 30);

  if (!video.loadedmetadata) return;

  // Apply transformations for horizontal flip
  push();
  translate(width, 0);
  scale(-1, 1);

  // Get and process current frame
  let currFrame = createImage(video.width, video.height);
  currFrame.copy(
    video,
    0,
    0,
    video.width,
    video.height,
    0,
    0,
    video.width,
    video.height,
  );
  currFrame.filter(BLUR, 1);

  // Process motion
  diffImage = createDifferenceImage(currFrame, prevFrame);
  const blobs = findMotionBlobs();
  trackBlobs(blobs);

  // Render
  drawTrails();
  drawBlobs();

  // Store current frame for next comparison
  prevFrame.copy(
    currFrame,
    0,
    0,
    video.width,
    video.height,
    0,
    0,
    video.width,
    video.height,
  );
  pop();
}

function createDifferenceImage(currFrame, prevFrame) {
  let diff = createImage(currFrame.width, currFrame.height);

  currFrame.loadPixels();
  prevFrame.loadPixels();
  diff.loadPixels();

  for (let i = 0; i < currFrame.pixels.length; i += 4) {
    const b1 = getBrightness(i, currFrame);
    const b2 = getBrightness(i, prevFrame);

    // Set white with alpha based on difference
    diff.pixels[i] = diff.pixels[i + 1] = diff.pixels[i + 2] = 255;
    diff.pixels[i + 3] = abs(b1 - b2);
  }

  diff.updatePixels();
  return diff;
}

function getBrightness(index, image) {
  return (
    image.pixels[index] * 0.212 +
    image.pixels[index + 1] * 0.715 +
    image.pixels[index + 2] * 0.072
  );
}

function findMotionBlobs() {
  const blobs = [];
  const gridWidth = Math.ceil(diffImage.width / GRID_SIZE);
  const gridHeight = Math.ceil(diffImage.height / GRID_SIZE);

  // Initialize grid
  let grid = Array(gridHeight)
    .fill()
    .map(() =>
      Array(gridWidth)
        .fill()
        .map(() => ({ motion: false, avgDiff: 0 })),
    );

  // Calculate motion in each grid cell
  diffImage.loadPixels();
  for (let y = 0; y < diffImage.height; y++) {
    for (let x = 0; x < diffImage.width; x++) {
      const i = (y * diffImage.width + x) * 4;
      const gridX = Math.floor(x / GRID_SIZE);
      const gridY = Math.floor(y / GRID_SIZE);

      if (diffImage.pixels[i + 3] > MOTION_THRESHOLD) {
        grid[gridY][gridX].motion = true;
        grid[gridY][gridX].avgDiff += diffImage.pixels[i + 3];
      }
    }
  }

  // Normalize grid values
  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      if (grid[y][x].motion) {
        grid[y][x].avgDiff /= GRID_SIZE * GRID_SIZE;
      }
    }
  }

  // Find connected blobs
  let visited = Array(gridHeight)
    .fill()
    .map(() => Array(gridWidth).fill(false));
  const neighbors = [
    { dx: -1, dy: 0 },
    { dx: 1, dy: 0 },
    { dx: 0, dy: -1 },
    { dx: 0, dy: 1 },
  ];

  for (let y = 0; y < gridHeight; y++) {
    for (let x = 0; x < gridWidth; x++) {
      if (grid[y][x].motion && !visited[y][x]) {
        // Found a new blob
        let cellsInBlob = [];
        let totalDiff = 0;
        let centerX = 0,
          centerY = 0;

        // Use queue for connected component analysis
        let queue = [{ x, y }];
        visited[y][x] = true;

        while (queue.length > 0) {
          const cell = queue.shift();
          cellsInBlob.push(cell);
          totalDiff += grid[cell.y][cell.x].avgDiff;
          centerX += cell.x;
          centerY += cell.y;

          // Check neighbors
          for (const n of neighbors) {
            const nx = cell.x + n.dx;
            const ny = cell.y + n.dy;

            if (
              nx >= 0 &&
              nx < gridWidth &&
              ny >= 0 &&
              ny < gridHeight &&
              grid[ny][nx].motion &&
              !visited[ny][nx]
            ) {
              queue.push({ x: nx, y: ny });
              visited[ny][nx] = true;
            }
          }
        }

        // Only add blob if it's larger than minimum size
        if (cellsInBlob.length >= MIN_GRIDS_FOR_BLOB) {
          centerX = (centerX / cellsInBlob.length) * GRID_SIZE + GRID_SIZE / 2;
          centerY = (centerY / cellsInBlob.length) * GRID_SIZE + GRID_SIZE / 2;

          blobs.push({
            centerX,
            centerY,
            avgDiff: totalDiff / cellsInBlob.length,
            size: cellsInBlob.length,
          });
        }
      }
    }
  }

  // Sort by size (largest first) and limit number
  return blobs.sort((a, b) => b.size - a.size).slice(0, MAX_BLOBS);
}

function trackBlobs(blobs) {
  const matchedTrailIds = new Set();

  // Mark all trails as inactive initially
  for (const id in motionTrails) {
    motionTrails[id].active = false;
  }

  // Match blobs to existing trails
  blobs.forEach((blob) => {
    let bestMatch = null;
    let bestDistance = MAX_MATCH_DISTANCE;

    for (const id in motionTrails) {
      if (matchedTrailIds.has(id)) continue;

      const trail = motionTrails[id];
      const lastPos = trail.positions[trail.positions.length - 1];
      const dx = blob.centerX - lastPos.x;
      const dy = blob.centerY - lastPos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestMatch = id;
      }
    }

    if (bestMatch) {
      updateTrail(bestMatch, blob);
      matchedTrailIds.add(bestMatch);
    } else {
      // Create new trail
      const id = "blob_" + Date.now() + "_" + Math.floor(Math.random() * 1000);
      motionTrails[id] = {
        positions: [],
        velocity: { x: 0, y: 0 },
        smoothedPosition: { x: blob.centerX, y: blob.centerY },
        speed: 0,
        active: true,
      };
      updateTrail(id, blob);
    }
  });

  // Age inactive trails
  for (const id in motionTrails) {
    const trail = motionTrails[id];

    // Age all positions
    trail.positions.forEach((pos) => (pos.age -= TRAIL_DECAY));

    // Remove old positions
    trail.positions = trail.positions.filter((pos) => pos.age > 0);

    // Remove empty trails
    if (trail.positions.length === 0) {
      delete motionTrails[id];
    }
  }
}

function updateTrail(id, blob) {
  const trail = motionTrails[id];
  trail.active = true;

  // Calculate raw velocity
  let vx = 0,
    vy = 0;
  if (trail.positions.length > 0) {
    const lastPos = trail.positions[trail.positions.length - 1];
    vx = blob.centerX - lastPos.x;
    vy = blob.centerY - lastPos.y;
  }

  // Smooth velocity and position
  trail.velocity.x =
    trail.velocity.x * VELOCITY_SMOOTH_FACTOR +
    vx * (1 - VELOCITY_SMOOTH_FACTOR);
  trail.velocity.y =
    trail.velocity.y * VELOCITY_SMOOTH_FACTOR +
    vy * (1 - VELOCITY_SMOOTH_FACTOR);
  trail.speed = Math.sqrt(
    trail.velocity.x * trail.velocity.x + trail.velocity.y * trail.velocity.y,
  );

  trail.smoothedPosition.x =
    trail.smoothedPosition.x * POSITION_SMOOTH_FACTOR +
    blob.centerX * (1 - POSITION_SMOOTH_FACTOR);
  trail.smoothedPosition.y =
    trail.smoothedPosition.y * POSITION_SMOOTH_FACTOR +
    blob.centerY * (1 - POSITION_SMOOTH_FACTOR);

  // Add to positions
  trail.positions.push({
    x: trail.smoothedPosition.x,
    y: trail.smoothedPosition.y,
    speed: trail.speed,
    diff: blob.avgDiff,
    age: 255,
  });

  // Limit trail length
  if (trail.positions.length > MAX_TRAIL_LENGTH) {
    trail.positions.shift();
  }
}

function drawTrails() {
  const scaleX = width / video.width;
  const scaleY = height / video.height;

  for (const id in motionTrails) {
    const trail = motionTrails[id];
    if (trail.positions.length <= 1) continue;

    for (let i = 0; i < trail.positions.length - 1; i++) {
      const pos = trail.positions[i];
      const nextPos = trail.positions[i + 1];

      // Scale positions to match canvas
      const x1 = pos.x * scaleX;
      const y1 = pos.y * scaleY;
      const x2 = nextPos.x * scaleX;
      const y2 = nextPos.y * scaleY;

      // Calculate color based on speed
      const green = (blue = Math.max(
        0,
        255 - (pos.speed / MAX_SPEED_FOR_COLOR) * 255,
      ));

      stroke(255, green, blue, pos.age);
      strokeWeight(3);
      line(x1, y1, x2, y2);
    }
  }
}

function drawBlobs() {
  const scaleX = width / video.width;
  const scaleY = height / video.height;

  for (const id in motionTrails) {
    const trail = motionTrails[id];

    if (trail.active && trail.positions.length > 0) {
      const lastPos = trail.positions[trail.positions.length - 1];
      const x = lastPos.x * scaleX;
      const y = lastPos.y * scaleY;

      // Color based on speed
      const green = (blue = Math.max(
        0,
        255 - (trail.speed / MAX_SPEED_FOR_COLOR) * 255,
      ));

      fill(255, green, blue);
      noStroke();
      ellipse(x, y, 15, 15);
    }
  }
}
