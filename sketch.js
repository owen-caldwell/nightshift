let video;
let prevFrame;
let motionPixels = [];
let motionTrails = {};

// Motion detection parameters
const motionThreshold = 30; // How much change is needed to detect motion (0-255)
const minBlobSize = 200; // Minimum blob size to track (in pixels)
const maxBlobs = 10; // Maximum number of motion areas to track

// Smoothing parameters
const smoothFactor = 0.8; // Position smoothing (0-1)
const velocitySmoothFactor = 0.7; // Velocity smoothing (0-1)

// Trail parameters
const maxTrailLength = 30;
const trailDecay = 8;

function setup() {
  createCanvas(640, 480);
  video = createCapture(VIDEO);
  video.size(width, height);
  video.hide();

  // Create initial previous frame
  prevFrame = createImage(video.width, video.height);

  // Wait a bit for camera to settle
  setTimeout(() => {
    prevFrame.copy(
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
    prevFrame.filter(BLUR, 2); // Slight blur to reduce noise
  }, 1000);

  // Prepare array for motion pixels
  for (let i = 0; i < width * height; i++) {
    motionPixels[i] = 0;
  }

  pixelDensity(1);
  background(0);
}

function draw() {
  // Semi-transparent background for trails
  background(0, 30);

  // Make sure video is loaded
  if (video.loadedmetadata) {
    // Copy current frame for processing
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
    currFrame.filter(BLUR, 2); // Slight blur to reduce noise

    // Load pixels for processing
    video.loadPixels();
    currFrame.loadPixels();
    prevFrame.loadPixels();

    // Reset motion pixels array
    for (let i = 0; i < motionPixels.length; i++) {
      motionPixels[i] = 0;
    }

    // Calculate motion pixels by comparing current and previous frame
    for (let y = 0; y < video.height; y++) {
      for (let x = 0; x < video.width; x++) {
        const i = (y * video.width + x) * 4;

        // Get pixel colors from both frames
        const currR = currFrame.pixels[i];
        const currG = currFrame.pixels[i + 1];
        const currB = currFrame.pixels[i + 2];

        const prevR = prevFrame.pixels[i];
        const prevG = prevFrame.pixels[i + 1];
        const prevB = prevFrame.pixels[i + 2];

        // Calculate color difference
        const diffR = Math.abs(currR - prevR);
        const diffG = Math.abs(currG - prevG);
        const diffB = Math.abs(currB - prevB);

        // Average difference across RGB channels
        const avgDiff = (diffR + diffG + diffB) / 3;

        // If difference exceeds threshold, mark as motion
        if (avgDiff > motionThreshold) {
          motionPixels[y * video.width + x] = avgDiff;
        }
      }
    }

    // Find motion blobs
    const blobs = findMotionBlobs();

    // Track blobs over time
    trackBlobs(blobs);

    // Draw trails
    drawTrails();

    // Draw current blobs
    drawBlobs(blobs);

    // Update previous frame
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
  }

  // Display instructions
  fill(255);
  textAlign(CENTER);
  textSize(16);
  text(
    "Move around to see dots and trails - red when moving fast, white when still",
    width / 2,
    30,
  );
  text(
    "Detected motion areas: " +
      Object.keys(motionTrails).filter((id) => motionTrails[id].active).length,
    width / 2,
    60,
  );
}

function findMotionBlobs() {
  // Use a flood fill algorithm to find connected areas of motion
  let blobs = [];
  let visited = new Array(motionPixels.length).fill(false);

  for (let i = 0; i < motionPixels.length; i++) {
    if (motionPixels[i] > 0 && !visited[i]) {
      // Found a new motion pixel, start a blob
      let blob = {
        pixels: [],
        avgDiff: 0,
        totalDiff: 0,
        centerX: 0,
        centerY: 0,
      };

      // Use queue for flood fill
      let queue = [i];
      visited[i] = true;

      while (queue.length > 0) {
        const pixelIndex = queue.shift();
        const x = pixelIndex % video.width;
        const y = Math.floor(pixelIndex / video.width);

        // Add to blob
        blob.pixels.push({ x, y, diff: motionPixels[pixelIndex] });
        blob.totalDiff += motionPixels[pixelIndex];
        blob.centerX += x;
        blob.centerY += y;

        // Check neighbors (4-connected)
        const neighbors = [
          { dx: -1, dy: 0 }, // left
          { dx: 1, dy: 0 }, // right
          { dx: 0, dy: -1 }, // up
          { dx: 0, dy: 1 }, // down
        ];

        for (const n of neighbors) {
          const nx = x + n.dx;
          const ny = y + n.dy;

          // Check if in bounds
          if (nx >= 0 && nx < video.width && ny >= 0 && ny < video.height) {
            const neighborIndex = ny * video.width + nx;

            // Check if motion pixel and not visited
            if (motionPixels[neighborIndex] > 0 && !visited[neighborIndex]) {
              queue.push(neighborIndex);
              visited[neighborIndex] = true;
            }
          }
        }
      }

      // Only add blob if it's larger than minimum size
      if (blob.pixels.length > minBlobSize) {
        // Calculate center and average difference
        blob.centerX /= blob.pixels.length;
        blob.centerY /= blob.pixels.length;
        blob.avgDiff = blob.totalDiff / blob.pixels.length;

        blobs.push(blob);
      }
    }
  }

  // Sort by size (largest first) and limit number of blobs
  blobs.sort((a, b) => b.pixels.length - a.pixels.length);
  return blobs.slice(0, maxBlobs);
}

function trackBlobs(blobs) {
  // Match current blobs with existing trails
  const matchedTrailIds = new Set();
  const matchDistance = 50; // Maximum distance to consider same blob

  // Mark all trails as inactive initially
  for (const id in motionTrails) {
    motionTrails[id].active = false;
  }

  // Try to match each blob to existing trails
  blobs.forEach((blob) => {
    let bestMatch = null;
    let bestDistance = matchDistance;

    for (const id in motionTrails) {
      // Skip already matched trails
      if (matchedTrailIds.has(id)) continue;

      const trail = motionTrails[id];
      const lastPos = trail.positions[trail.positions.length - 1];

      // Calculate distance
      const dx = blob.centerX - lastPos.x;
      const dy = blob.centerY - lastPos.y;
      const distance = Math.sqrt(dx * dx + dy * dy);

      if (distance < bestDistance) {
        bestDistance = distance;
        bestMatch = id;
      }
    }

    if (bestMatch) {
      // Update existing trail
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

    // Age all positions in trail
    trail.positions.forEach((pos) => {
      pos.age -= trailDecay;
    });

    // Remove old positions
    trail.positions = trail.positions.filter((pos) => pos.age > 0);

    // Remove trails that have no more positions
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

  // Smooth velocity
  trail.velocity.x =
    trail.velocity.x * velocitySmoothFactor + vx * (1 - velocitySmoothFactor);
  trail.velocity.y =
    trail.velocity.y * velocitySmoothFactor + vy * (1 - velocitySmoothFactor);

  // Calculate speed
  trail.speed = Math.sqrt(
    trail.velocity.x * trail.velocity.x + trail.velocity.y * trail.velocity.y,
  );

  // Smooth position
  trail.smoothedPosition.x =
    trail.smoothedPosition.x * smoothFactor + blob.centerX * (1 - smoothFactor);
  trail.smoothedPosition.y =
    trail.smoothedPosition.y * smoothFactor + blob.centerY * (1 - smoothFactor);

  // Add to positions
  trail.positions.push({
    x: trail.smoothedPosition.x,
    y: trail.smoothedPosition.y,
    speed: trail.speed,
    diff: blob.avgDiff,
    age: 255,
  });

  // Limit trail length
  if (trail.positions.length > maxTrailLength) {
    trail.positions.shift();
  }
}

function drawTrails() {
  for (const id in motionTrails) {
    const trail = motionTrails[id];

    if (trail.positions.length > 1) {
      for (let i = 0; i < trail.positions.length - 1; i++) {
        const pos = trail.positions[i];
        const nextPos = trail.positions[i + 1];

        // Calculate color based on speed
        const maxSpeedForColor = 15; // Speed threshold for full red
        const red = 255;
        const green = (blue = Math.max(
          0,
          255 - (pos.speed / maxSpeedForColor) * 255,
        ));

        // Draw line segment with transparency based on age
        stroke(red, green, blue, pos.age);
        strokeWeight(3);
        line(pos.x, pos.y, nextPos.x, nextPos.y);
      }
    }
  }
}

function drawBlobs(blobs) {
  // Draw active blobs
  for (const id in motionTrails) {
    const trail = motionTrails[id];

    if (trail.active && trail.positions.length > 0) {
      const lastPos = trail.positions[trail.positions.length - 1];

      // Calculate color based on speed
      const maxSpeedForColor = 15; // Speed threshold for full red
      const red = 255;
      const green = (blue = Math.max(
        0,
        255 - (trail.speed / maxSpeedForColor) * 255,
      ));

      // Draw dot
      fill(red, green, blue);
      noStroke();
      ellipse(lastPos.x, lastPos.y, 15, 15);

      // Draw speed text
      fill(255);
      textSize(12);
      textAlign(CENTER);
      text(`Speed: ${trail.speed.toFixed(1)}`, lastPos.x, lastPos.y - 20);
    }
  }
}
