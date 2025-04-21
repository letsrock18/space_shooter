const express = require('express');
const app = express();
const http = require('http');
const server = http.createServer(app);
const { Server } = require("socket.io");
const io = new Server(server);
const path = require('path');

const PORT = process.env.PORT || 3000;

// Store player states
const players = {};
const lasers = {}; // Store active lasers { laserId: { x, y, velocityX, velocityY, ownerId } }
let nextLaserId = 0;
const asteroids = {}; // Store active asteroids { asteroidId: { x, y, velocityX, velocityY, points: [], radius, stage } }
let nextAsteroidId = 0;

// Game constants (adjust as needed)
const GAME_WIDTH = 800;
const GAME_HEIGHT = 600;
const PLAYER_SPEED = 5; // Max speed
const PLAYER_ROTATION_SPEED = 0.05; // Radians per update
const PLAYER_ACCELERATION = 0.1;
const PLAYER_FRICTION = 0.98; // Multiplier applied each update
const LASER_SPEED = 5;
const SHOOT_DELAY = 250; // Milliseconds between shots
const ASTEROID_SPEED_MIN = 0.5;
const ASTEROID_SPEED_MAX = 1.5;
const ASTEROID_POINTS_MIN = 6;
const ASTEROID_POINTS_MAX = 12;
const ASTEROID_RADIUS_MIN = 20; // Size categories (large, medium, small)
const ASTEROID_RADIUS_MEDIUM = 15;
const ASTEROID_RADIUS_SMALL = 10;
const ASTEROID_START_COUNT = 5; // Initial number of asteroids
const ASTEROID_MAX_COUNT = 20;  // Max asteroids allowed
const ASTEROID_STAGE_LARGE = 3;
const ASTEROID_STAGE_MEDIUM = 2;
const ASTEROID_STAGE_SMALL = 1;
const POINTS_PER_ASTEROID_HIT = 10;
const POINTS_PER_PLAYER_HIT = 50;
const WINNING_SCORE = 500;
const PLAYER_START_LIVES = 10;
const PLAYER_INVINCIBILITY_TIME = 2000; // ms
const PLAYER_RESPAWN_DELAY = 1000; // ms
const PLAYER_RADIUS = 10; // For collision detection

// Serve static files from the 'public' directory
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

io.on('connection', (socket) => {
  console.log('a user connected:', socket.id);

  // Create a new player object with rotation, velocity, score, lives, etc.
  players[socket.id] = {
    playerId: socket.id,
    x: Math.floor(Math.random() * (GAME_WIDTH - 100)) + 50,
    y: Math.floor(Math.random() * (GAME_HEIGHT - 100)) + 50,
    rotation: 0,
    velocityX: 0,
    velocityY: 0,
    lastShotTime: 0,
    score: 0,
    lives: PLAYER_START_LIVES,
    isInvincible: false,
    invincibleUntil: 0,
    isDead: false,
    respawnTime: 0
  };

  socket.emit('currentPlayers', players); // Send current players to new client
  socket.broadcast.emit('newPlayer', players[socket.id]); // Notify others

  // Handle player movement input (Thrust from keyboard/tap, Rotation from keyboard)
  socket.on('playerInput', function (inputData) {
    const player = players[socket.id];
    if (player && !player.isDead) {
        // Handle Rotation (Keyboard Only)
        if (inputData.left) {
            player.rotation -= PLAYER_ROTATION_SPEED;
        }
        if (inputData.right) {
            player.rotation += PLAYER_ROTATION_SPEED;
        }

        // Handle Thrust (Keyboard OR Tap)
        if (inputData.up) {
            // Use the player's CURRENT rotation (set by keyboard or playerSetAngle)
            const angle = player.rotation - Math.PI / 2;
            const accelerationX = Math.cos(angle) * PLAYER_ACCELERATION;
            const accelerationY = Math.sin(angle) * PLAYER_ACCELERATION;
            player.velocityX += accelerationX;
            player.velocityY += accelerationY;
        }
    }
  });

  // Handle setting player angle directly from tap
  socket.on('playerSetAngle', (data) => {
      const player = players[socket.id];
      if (player && !player.isDead && data && typeof data.angle === 'number') {
          // Directly set rotation based on tap angle
          // Add PI/2 because Phaser's angle is 0 rad east, while ship graphic 0 rad is north
          player.rotation = data.angle + Math.PI / 2;
      }
  });

  // Handle disconnect
  socket.on('disconnect', () => {
    console.log('user disconnected:', socket.id);
    delete players[socket.id];
    io.emit('playerDisconnected', socket.id);
    console.log('Remaining players:', Object.keys(players).length);
  });

  // Handle player shooting request
  socket.on('playerShoot', () => {
    const player = players[socket.id];
    const now = Date.now();
    // Check if player exists, is alive, and cooldown has passed
    if (player && !player.isDead && now - player.lastShotTime > SHOOT_DELAY) {
        player.lastShotTime = now;
        const laserId = nextLaserId++;
        const angle = player.rotation - Math.PI / 2;
        lasers[laserId] = {
            id: laserId,
            ownerId: socket.id,
            x: player.x + Math.cos(angle) * 15,
            y: player.y + Math.sin(angle) * 15,
            velocityX: Math.cos(angle) * LASER_SPEED + player.velocityX * 0.5, // Add some ship velocity
            velocityY: Math.sin(angle) * LASER_SPEED + player.velocityY * 0.5
        };
        // Emit laser fire event for sound on client
        io.emit('laserFired', { x: lasers[laserId].x, y: lasers[laserId].y });
    }
  });
});

// Helper function to generate asteroid shape
function generateAsteroidShape(radius, numPoints) {
    const points = [];
    const angleStep = (Math.PI * 2) / numPoints;
    for (let i = 0; i < numPoints; i++) {
        const angle = i * angleStep;
        const r = radius * (0.8 + Math.random() * 0.4);
        points.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
    }
    return points;
}

// Update createAsteroid for better splitting velocity
function createAsteroid(stage = ASTEROID_STAGE_LARGE, x = null, y = null, parentVelocityX = 0, parentVelocityY = 0) {
    const asteroidId = nextAsteroidId++;
    let radius;
    let pointsMin = ASTEROID_POINTS_MIN;
    let pointsMax = ASTEROID_POINTS_MAX;

    switch (stage) {
        case ASTEROID_STAGE_MEDIUM: radius = ASTEROID_RADIUS_MEDIUM; break;
        case ASTEROID_STAGE_SMALL:  radius = ASTEROID_RADIUS_SMALL; pointsMin = 5; pointsMax = 9; break; // Fewer points for smaller ones
        default:                    radius = ASTEROID_RADIUS_MIN; stage = ASTEROID_STAGE_LARGE; break;
    }
    const numPoints = Math.floor(pointsMin + Math.random() * (pointsMax - pointsMin + 1));
    const shapePoints = generateAsteroidShape(radius, numPoints);

    // Determine starting position if not provided
    if (x === null || y === null) {
        const edge = Math.floor(Math.random() * 4);
        const buffer = radius + 10;
        if (edge === 0) { x = -buffer; y = Math.random() * GAME_HEIGHT; } // Left
        else if (edge === 1) { x = GAME_WIDTH + buffer; y = Math.random() * GAME_HEIGHT; } // Right
        else if (edge === 2) { y = -buffer; x = Math.random() * GAME_WIDTH; } // Top
        else { y = GAME_HEIGHT + buffer; x = Math.random() * GAME_WIDTH; } // Bottom
    }

    let velocityX, velocityY;
    if (parentVelocityX !== 0 || parentVelocityY !== 0) { // If splitting
        const baseSpeed = Math.sqrt(parentVelocityX * parentVelocityX + parentVelocityY * parentVelocityY);
        // Ensure minimum speed to avoid stationary splits
        const effectiveSpeed = Math.max(baseSpeed, ASTEROID_SPEED_MIN * 0.8); 
        const splitAngle = Math.random() * Math.PI * 2;
        const splitSpeedFactor = 1.0 + Math.random() * 0.5; // Slightly faster than parent
        velocityX = Math.cos(splitAngle) * effectiveSpeed * splitSpeedFactor;
        velocityY = Math.sin(splitAngle) * effectiveSpeed * splitSpeedFactor;
    } else { // Initial spawn velocity
        const angle = Math.random() * Math.PI * 2;
        const speed = ASTEROID_SPEED_MIN + Math.random() * (ASTEROID_SPEED_MAX - ASTEROID_SPEED_MIN);
        velocityX = Math.cos(angle) * speed;
        velocityY = Math.sin(angle) * speed;
    }

    asteroids[asteroidId] = {
        id: asteroidId,
        x: x,
        y: y,
        velocityX: velocityX,
        velocityY: velocityY,
        points: shapePoints,
        radius: radius,
        stage: stage
    };
     // console.log(`Created asteroid ${asteroidId} stage ${stage}`);
}

// --- Server-side Game Loop ---
let gameLoopInterval = null; // Store interval ID to potentially stop it

gameLoopInterval = setInterval(() => {
    const now = Date.now();
    let gameOver = false;
    let winnerId = null;
    const playersToRespawn = [];

    // Handle player respawn and invincibility timing
    Object.keys(players).forEach((id) => {
        const player = players[id];
        if (player.isDead && now >= player.respawnTime) {
            playersToRespawn.push(id);
        }
        if (player.isInvincible && now >= player.invincibleUntil) {
            player.isInvincible = false;
            // console.log(`Player ${id} invincibility ended`);
        }
    });
    playersToRespawn.forEach(id => {
        const player = players[id];
        if (!player) return; // Guard against disconnected player during loop
        player.isDead = false;
        player.isInvincible = true;
        player.invincibleUntil = now + PLAYER_INVINCIBILITY_TIME;
        player.x = Math.random() * (GAME_WIDTH - 200) + 100; // Respawn in center area
        player.y = Math.random() * (GAME_HEIGHT - 200) + 100;
        player.velocityX = 0;
        player.velocityY = 0;
        player.rotation = 0;
        console.log(`Player ${id} respawned`);
        // Emit event for client sound/effect
        io.emit('playerRespawned', { playerId: id });
    });

    // Spawn initial/new asteroids if needed
    if (Object.keys(asteroids).length < ASTEROID_START_COUNT) {
       if(Object.keys(asteroids).length < ASTEROID_MAX_COUNT) {
            createAsteroid();
       }
    }

    // Update Players
    Object.keys(players).forEach((id) => {
        const player = players[id];
        if (player.isDead) return; // Skip updates if dead

        // Apply friction
        player.velocityX *= PLAYER_FRICTION;
        player.velocityY *= PLAYER_FRICTION;

        // Update position based on velocity
        player.x += player.velocityX;
        player.y += player.velocityY;

        // Boundary checks (wrapping)
        if (player.x < 0) player.x = GAME_WIDTH;
        if (player.x > GAME_WIDTH) player.x = 0;
        if (player.y < 0) player.y = GAME_HEIGHT;
        if (player.y > GAME_HEIGHT) player.y = 0;

        // Rotation is now handled by 'playerInput' (keyboard) or 'playerSetAngle' (touch)
    });

    // Update Lasers
    Object.keys(lasers).forEach((laserId) => {
        const laser = lasers[laserId];
        laser.x += laser.velocityX;
        laser.y += laser.velocityY;
        // Remove lasers that go off-screen
        if (laser.x < -10 || laser.x > GAME_WIDTH + 10 || laser.y < -10 || laser.y > GAME_HEIGHT + 10) {
            delete lasers[laserId];
        }
    });

    // Update Asteroids
    Object.keys(asteroids).forEach((asteroidId) => {
        const asteroid = asteroids[asteroidId];
        asteroid.x += asteroid.velocityX;
        asteroid.y += asteroid.velocityY;
        // Asteroid screen wrapping
        const buffer = asteroid.radius;
        if (asteroid.x < -buffer) asteroid.x = GAME_WIDTH + buffer;
        if (asteroid.x > GAME_WIDTH + buffer) asteroid.x = -buffer;
        if (asteroid.y < -buffer) asteroid.y = GAME_HEIGHT + buffer;
        if (asteroid.y > GAME_HEIGHT + buffer) asteroid.y = -buffer;
    });

    // --- Collision Detection ---
    const lasersToRemove = new Set();
    const asteroidsToRemove = new Set();
    const playersHitThisFrame = new Set();

    // 1. Lasers vs Asteroids
    Object.keys(lasers).forEach((laserId) => {
        if (lasersToRemove.has(laserId)) return; // Already marked
        const laser = lasers[laserId];
        Object.keys(asteroids).forEach((asteroidId) => {
            if (asteroidsToRemove.has(asteroidId)) return; // Already marked
            const asteroid = asteroids[asteroidId];
            const dx = laser.x - asteroid.x;
            const dy = laser.y - asteroid.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < asteroid.radius) { // Collision!
                lasersToRemove.add(laserId);
                asteroidsToRemove.add(asteroidId);

                if (players[laser.ownerId]) {
                    players[laser.ownerId].score += POINTS_PER_ASTEROID_HIT;
                    if (players[laser.ownerId].score >= WINNING_SCORE) {
                        gameOver = true;
                        winnerId = laser.ownerId;
                    }
                }
                // Emit destruction event for client effects/sound
                io.emit('asteroidDestroyed', { x: asteroid.x, y: asteroid.y, stage: asteroid.stage, laserOwnerId: laser.ownerId });

                // Split asteroid
                if (asteroid.stage > ASTEROID_STAGE_SMALL) {
                    const newStage = asteroid.stage - 1;
                    createAsteroid(newStage, asteroid.x, asteroid.y, asteroid.velocityX, asteroid.velocityY);
                    createAsteroid(newStage, asteroid.x, asteroid.y, asteroid.velocityX, asteroid.velocityY);
                }
                // Note: A laser might hit multiple asteroids in one frame if they overlap
            }
        });
    });

    // 2. Lasers vs Players (New Collision Check)
    Object.keys(lasers).forEach((laserId) => {
        if (lasersToRemove.has(laserId)) return; // Skip lasers already marked
        const laser = lasers[laserId];

        Object.keys(players).forEach((playerId) => {
            const player = players[playerId];
            // Cannot shoot self, cannot hit dead/invincible/already hit players
            if (laser.ownerId === playerId || player.isDead || player.isInvincible || playersHitThisFrame.has(playerId)) {
                return; 
            }

            // Circle collision check
            const dx = laser.x - player.x;
            const dy = laser.y - player.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < PLAYER_RADIUS) { // Collision!
                console.log(`Player ${playerId} hit by laser ${laserId} from Player ${laser.ownerId}`);
                lasersToRemove.add(laserId);
                playersHitThisFrame.add(playerId);

                // Apply damage
                player.lives--;
                player.isDead = true;
                player.respawnTime = now + PLAYER_RESPAWN_DELAY;
                io.emit('playerHit', { playerId: playerId, lives: player.lives, x: player.x, y: player.y, attackerId: laser.ownerId });

                // Award points to shooter
                if (players[laser.ownerId]) {
                    players[laser.ownerId].score += POINTS_PER_PLAYER_HIT;
                     if (players[laser.ownerId].score >= WINNING_SCORE) {
                        gameOver = true;
                        winnerId = laser.ownerId;
                    }
                }
                 // No need to check this laser against other players once it hits
                 // But keep checking other lasers against this player if needed later?
                 // For simplicity, let's assume one laser hit is enough per frame
            }
        });
    });

    // 3. Players vs Asteroids
    Object.keys(players).forEach((playerId) => {
        const player = players[playerId];
        if (player.isDead || player.isInvincible || playersHitThisFrame.has(playerId)) return;

        Object.keys(asteroids).forEach((asteroidId) => {
            if (asteroidsToRemove.has(asteroidId)) return; // Skip already hit asteroids
            const asteroid = asteroids[asteroidId];
            const dx = player.x - asteroid.x;
            const dy = player.y - asteroid.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < asteroid.radius + PLAYER_RADIUS) { // Collision!
                asteroidsToRemove.add(asteroidId);
                playersHitThisFrame.add(playerId);
                console.log(`Player ${playerId} hit by Asteroid ${asteroidId}`);

                player.lives--;
                player.isDead = true;
                player.respawnTime = now + PLAYER_RESPAWN_DELAY;
                // Notify clients about the hit
                io.emit('playerHit', { playerId: playerId, lives: player.lives, x: player.x, y: player.y });

                // Split asteroid if needed
                if (asteroid.stage > ASTEROID_STAGE_SMALL) {
                    const newStage = asteroid.stage - 1;
                    createAsteroid(newStage, asteroid.x, asteroid.y, asteroid.velocityX, asteroid.velocityY);
                    createAsteroid(newStage, asteroid.x, asteroid.y, asteroid.velocityX, asteroid.velocityY);
                }
                // Emit asteroid destruction for effect
                io.emit('asteroidDestroyed', { x: asteroid.x, y: asteroid.y, stage: asteroid.stage });
                return; // Player hit, move to next asteroid check (or next player)
            }
        });
    });

    // 4. Players vs Players
    const playerIds = Object.keys(players);
    for (let i = 0; i < playerIds.length; i++) {
        const playerId1 = playerIds[i];
        const player1 = players[playerId1];
        if (player1.isDead || player1.isInvincible || playersHitThisFrame.has(playerId1)) continue;

        for (let j = i + 1; j < playerIds.length; j++) {
            const playerId2 = playerIds[j];
            const player2 = players[playerId2];
            if (player2.isDead || player2.isInvincible || playersHitThisFrame.has(playerId2)) continue;

            const dx = player1.x - player2.x;
            const dy = player1.y - player2.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            if (distance < PLAYER_RADIUS * 2) { // Collision!
                console.log(`Player ${playerId1} collided with Player ${playerId2}`);
                playersHitThisFrame.add(playerId1);
                playersHitThisFrame.add(playerId2);

                // Handle player 1 hit
                player1.lives--;
                player1.isDead = true;
                player1.respawnTime = now + PLAYER_RESPAWN_DELAY;
                io.emit('playerHit', { playerId: playerId1, lives: player1.lives, x: player1.x, y: player1.y });

                // Handle player 2 hit
                player2.lives--;
                player2.isDead = true;
                player2.respawnTime = now + PLAYER_RESPAWN_DELAY;
                io.emit('playerHit', { playerId: playerId2, lives: player2.lives, x: player2.x, y: player2.y });
            }
        }
    }

    // Remove collided objects after all checks
    lasersToRemove.forEach(id => delete lasers[id]);
    asteroidsToRemove.forEach(id => delete asteroids[id]);

    // Respawn asteroids if count drops too low
    if (Object.keys(asteroids).length < ASTEROID_START_COUNT && Object.keys(asteroids).length < ASTEROID_MAX_COUNT) {
        // Maybe add a small delay or check time since last spawn?
        createAsteroid();
    }

    // Broadcast the state of all players, lasers, and asteroids
    io.emit('gameStateUpdate', { players, lasers, asteroids });

    // Check for Game Over
    if (gameOver) {
        console.log(`Game Over! Winner: ${winnerId}`);
        io.emit('gameOver', { winnerId: winnerId }); 
        // Optionally stop the loop
        // clearInterval(gameLoopInterval);
        // Or implement a server state change to handle game reset/lobby
    }

}, 1000 / 60);

server.listen(PORT, () => {
  console.log(`Server listening on *:${PORT}`);
}); 