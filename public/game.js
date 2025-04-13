// Connect to the server
const socket = io();

const config = {
    type: Phaser.CANVAS, // Use Canvas rendering for the 8-bit aesthetic
    width: 800,
    height: 600,
    parent: 'phaser-example', // Optional: If you have a div with this id in index.html
    physics: {
        default: 'arcade',
        arcade: {
            // Arcade physics settings (optional for now)
            // gravity: { y: 200 }
            debug: false // Set to true for physics debugging visuals
        }
    },
    scene: {
        preload: preload,
        create: create,
        update: update
    }
};

const game = new Phaser.Game(config);

// Updated sound/music keys
const SOUND_LASER = 'sndLaser';
const SOUND_EXPLODE_S = 'sndExplodeS';
const SOUND_EXPLODE_L = 'sndExplodeL';
const SOUND_ASTEROID_HITS = [
    'sndAsteroid1', 'sndAsteroid2', 'sndAsteroid3', 'sndAsteroid4',
    'sndAsteroid5', 'sndAsteroid6', 'sndAsteroid7', 'sndAsteroid8'
];
const SOUND_PLAYER_DEATH = 'sndPlayerDeath';
const SOUND_PLAYER_RESPAWN = 'sndRespawn';
const SOUND_GAME_WIN = 'sndWin';
const MUSIC_BACKGROUND = 'musicBgm';

function preload() {
    console.log("Preloading assets...");
    // Load sounds from 'media/' folder
    // this.load.audio(SOUND_LASER, 'assets/sounds/laser.wav'); // Keep or replace if you have it
    // this.load.audio(SOUND_EXPLODE_S, 'assets/sounds/explode_small.wav'); // Keep or replace if you have it
    // this.load.audio(SOUND_EXPLODE_L, 'assets/sounds/explode_large.wav'); // Keep or replace if you have it
    
    this.load.audio(MUSIC_BACKGROUND, 'media/Pixelated.mp3');
    this.load.audio(SOUND_GAME_WIN, 'media/win.mp3');
    this.load.audio(SOUND_PLAYER_DEATH, 'media/ship_dies.mp3');
    this.load.audio(SOUND_PLAYER_RESPAWN, 'media/respawn.mp3');
    
    // Load numbered asteroid hit sounds
    for (let i = 0; i < 8; i++) {
        this.load.audio(SOUND_ASTEROID_HITS[i], `media/${i + 1}.mp3`);
    }

    // Load heart image if you have one
    // this.load.image('heart', 'media/heart.png');
}

// Use a variable to hold the reference to the current player's game object
let playerGameObject = null; 
let scoreText = null; // Add variable for score text object
let livesText = null; // For displaying lives
let livesGroup = null; // For heart icons

function create() {
    console.log("Creating game objects...");
    // 'this' refers to the Scene context
    const self = this;
    this.players = this.add.group(); // Group to manage player objects
    this.lasers = this.add.group(); // Group to manage laser visuals
    this.asteroids = this.add.group(); // Group to manage asteroid visuals

    // Add Score Text
    scoreText = this.add.text(16, 16, 'Score: 0', { fontSize: '20px', fill: '#FFF' });
    // Lives Display (Hearts)
    livesGroup = this.add.group(); // Group to hold heart icons
    // Position the lives group (adjust x, y as needed)
    // updateLivesDisplay(self, PLAYER_START_LIVES); // Initial display (needs PLAYER_START_LIVES constant)

    // Play Background Music
    if (this.cache.audio.exists(MUSIC_BACKGROUND)) {
        this.sound.play(MUSIC_BACKGROUND, { loop: true, volume: 0.4 });
    } else {
        console.warn('Background music not loaded!');
    }

    // Initialize lives display (ensure PLAYER_START_LIVES constant is available)
    if (typeof PLAYER_START_LIVES !== 'undefined') {
        updateLivesDisplay(this, PLAYER_START_LIVES); 
    }

    // --- Socket.IO Event Listeners --- 

    socket.on('currentPlayers', function (players) {
        console.log("Received currentPlayers:", players);
        Object.keys(players).forEach(function (id) {
            if (players[id].playerId === socket.id) {
                playerGameObject = addPlayer(self, players[id], true);
            } else {
                addPlayer(self, players[id], false);
            }
        });
    });

    socket.on('newPlayer', function (playerInfo) {
        console.log("Received newPlayer:", playerInfo);
        addPlayer(self, playerInfo, false);
    });

    socket.on('playerDisconnected', function (playerId) {
        console.log("Received playerDisconnected:", playerId);
        self.players.getChildren().forEach(function (player) {
            if (playerId === player.playerId) {
                player.destroy();
            }
        });
    });

    // Listen for combined game state updates
    socket.on('gameStateUpdate', function (gameState) {
        // Update Players
        const serverPlayers = gameState.players;
        const clientPlayerIds = self.players.getChildren().map(p => p.playerId);
        const serverPlayerIds = Object.keys(serverPlayers);

        serverPlayerIds.forEach(function (playerId) {
            const serverPlayer = serverPlayers[playerId];
            let playerToUpdate = null;
            self.players.getChildren().forEach(function (clientPlayer) {
                if (serverPlayer.playerId === clientPlayer.playerId) playerToUpdate = clientPlayer;
            });

            if (playerToUpdate) {
                // Handle Dead State
                if (serverPlayer.isDead) {
                    playerToUpdate.setVisible(false); // Hide dead player
                } else {
                    playerToUpdate.setVisible(true);
                    playerToUpdate.setPosition(serverPlayer.x, serverPlayer.y);
                    playerToUpdate.setRotation(serverPlayer.rotation);
                    
                    // Handle Invincibility Visuals (e.g., slight transparency or tint)
                    if (serverPlayer.isInvincible) {
                        playerToUpdate.setAlpha(0.5); // Example: make semi-transparent
                    } else {
                        playerToUpdate.setAlpha(1.0); // Fully opaque
                    }
                }
                
                // Update UI for current player
                if (serverPlayer.playerId === socket.id) {
                    scoreText.setText('Score: ' + serverPlayer.score);
                    // Update lives display using hearts
                    updateLivesDisplay(self, serverPlayer.lives); 
                }
            } else if (!serverPlayer.isDead) { // Add player only if not dead initially
                // Handle case where player exists on server but not client
                const addedPlayer = addPlayer(self, serverPlayer, serverPlayer.playerId === socket.id);
                if (serverPlayer.playerId === socket.id) {
                    playerGameObject = addedPlayer;
                    scoreText.setText('Score: ' + serverPlayer.score);
                    // Update lives display using hearts
                    updateLivesDisplay(self, serverPlayer.lives); 
                }
                 // Set initial invincibility alpha if needed
                if (serverPlayer.isInvincible) addedPlayer.setAlpha(0.5);
            }
        });
        clientPlayerIds.forEach(function (playerId) {
            if (!serverPlayerIds.includes(playerId)) {
                self.players.getChildren().forEach(function (player) {
                    if (playerId === player.playerId) player.destroy();
                });
            }
        });

        // Update Lasers
        const serverLasers = gameState.lasers;
        const clientLaserIds = self.lasers.getChildren().map(l => l.laserId);
        const serverLaserIds = Object.keys(serverLasers);

        serverLaserIds.forEach(function (laserId) {
            const serverLaser = serverLasers[laserId];
            let laserToUpdate = null;
            self.lasers.getChildren().forEach(function (clientLaser) {
                if (serverLaser.id === clientLaser.laserId) laserToUpdate = clientLaser;
            });

            if (laserToUpdate) {
                laserToUpdate.setPosition(serverLaser.x, serverLaser.y);
                // Rotation doesn't usually change after firing, so set mainly on add
            } else {
                // Add new laser visual, passing the angle
                addLaser(self, serverLaser);
            }
        });

        // Remove lasers locally that are no longer on the server
        clientLaserIds.forEach(function (laserId) {
            // Ensure laserId is treated as a string for comparison if needed, though keys should be strings
            if (!serverLaserIds.includes(String(laserId))) { 
                self.lasers.getChildren().forEach(function (laser) {
                    if (laserId === laser.laserId) {
                        laser.destroy();
                    }
                });
            }
        });

        // Update Asteroids
        const serverAsteroids = gameState.asteroids; 
        const clientAsteroidIds = self.asteroids.getChildren().map(a => a.asteroidId);
        const serverAsteroidIds = Object.keys(serverAsteroids);

        serverAsteroidIds.forEach(function (asteroidId) {
            const serverAsteroid = serverAsteroids[asteroidId];
            let asteroidToUpdate = null;
            self.asteroids.getChildren().forEach(function (clientAsteroid) {
                if (serverAsteroid.id === clientAsteroid.asteroidId) asteroidToUpdate = clientAsteroid;
            });

            if (asteroidToUpdate) {
                // Update existing asteroid position
                asteroidToUpdate.setPosition(serverAsteroid.x, serverAsteroid.y);
            } else {
                // Add new asteroid visual
                addAsteroid(self, serverAsteroid);
            }
        });

        // Remove asteroids locally that are no longer on the server
        clientAsteroidIds.forEach(function (asteroidId) {
            if (!serverAsteroidIds.includes(String(asteroidId))) {
                self.asteroids.getChildren().forEach(function (asteroid) {
                    if (asteroidId === asteroid.asteroidId) {
                        asteroid.destroy();
                    }
                });
            }
        });
    });

    // Update Sound Effect Listeners
    socket.on('laserFired', function(data) {
        // Play laser sound if you have one and it's loaded
        if (self.cache.audio.exists(SOUND_LASER)) { 
            self.sound.play(SOUND_LASER, { volume: 0.3 });
        }
    });

    socket.on('asteroidDestroyed', function(data) {
        // Play a random asteroid hit sound
        const randomIndex = Math.floor(Math.random() * SOUND_ASTEROID_HITS.length);
        const randomSoundKey = SOUND_ASTEROID_HITS[randomIndex];
        if (self.cache.audio.exists(randomSoundKey)) {
             self.sound.play(randomSoundKey, { volume: 0.5 });
        } else {
            console.warn(`Asteroid sound not loaded: ${randomSoundKey}`);
        }
        // TODO: Add explosion particle effect at data.x, data.y
    });

    socket.on('playerHit', function(data) {
        // Play player death sound
         if (self.cache.audio.exists(SOUND_PLAYER_DEATH)) {
            self.sound.play(SOUND_PLAYER_DEATH, { volume: 0.7 });
         } else {
             console.warn('Player death sound not loaded!');
         }
         // TODO: Add player explosion particle effect at data.x, data.y
         // If the hit player is the current player, maybe add screen shake?
         if (data.playerId === socket.id) {
             // self.cameras.main.shake(100, 0.01); // Example screen shake
         }
    });

    // Listen for player respawn sound event
    socket.on('playerRespawned', function(data) {
        // Optional: Only play for the respawning player or everyone?
        // if (data.playerId === socket.id) { ... }
        if (self.cache.audio.exists(SOUND_PLAYER_RESPAWN)) {
            self.sound.play(SOUND_PLAYER_RESPAWN, { volume: 0.6 });
        } else {
            console.warn('Player respawn sound not loaded!');
        }
    });

    // Update Game Over Listener for sound
    socket.on('gameOver', function(data) {
        console.log('Game Over! Winner:', data.winnerId);
        self.input.keyboard.enabled = false;
        const winnerText = (data.winnerId === socket.id) ? 'You Win!' : 'Player ' + data.winnerId.substring(0, 4) + ' Wins!';
        self.add.text(config.width / 2, config.height / 2, winnerText, { 
            fontSize: '48px', fill: '#00ff00', backgroundColor: '#000000' 
        }).setOrigin(0.5);
        
        // Stop background music and play win sound
        self.sound.stopByKey(MUSIC_BACKGROUND);
        if (self.cache.audio.exists(SOUND_GAME_WIN)) {
            self.sound.play(SOUND_GAME_WIN, { volume: 0.8 });
        } else {
             console.warn('Win sound not loaded!');
        }
    });

    // --- Keyboard Input Setup --- 
    this.cursors = this.input.keyboard.createCursorKeys();
    // We no longer need lastSentInput like before, we send continuously while pressed

    // --- Helper function to add a player visual --- 
    function addPlayer(scene, playerInfo, isCurrentUser) {
        const playerColor = isCurrentUser ? 0x00ff00 : 0xff0000; // Green for self, Red for others
        const shipSize = 20; // Size base for the triangle
        
        // Create a triangle graphic
        const player = scene.add.graphics({ fillStyle: { color: playerColor } });
        player.fillTriangle(
            0, -shipSize / 2,       // Top point
            -shipSize / 2, shipSize / 2, // Bottom left
            shipSize / 2, shipSize / 2  // Bottom right
        );
        // Position the graphics container
        player.setPosition(playerInfo.x, playerInfo.y);
        // Set initial rotation (Phaser rotation is in radians)
        player.setRotation(playerInfo.rotation || 0); 

        player.playerId = playerInfo.playerId;
        scene.players.add(player); // Add the graphics object to the group
        console.log(`Added player ${player.playerId} at (${player.x}, ${player.y}), rot: ${player.rotation}`);

        return player;
    }

    // Helper function to add a laser visual - now accepts angle
    function addLaser(scene, laserInfo) {
        const laserWidth = 10;
        const laserHeight = 4;
        // Simple green rectangle for lasers
        const laser = scene.add.rectangle(laserInfo.x, laserInfo.y, laserWidth, laserHeight, 0x00ff00); 
        laser.laserId = laserInfo.id; // Store server ID
        
        // Calculate the angle from velocity (same as server firing angle)
        const angle = Math.atan2(laserInfo.velocityY, laserInfo.velocityX);
        laser.setRotation(angle);
        
        scene.lasers.add(laser);
        // console.log(`Added laser ${laser.laserId}`);
    }

    // Helper function to add an asteroid visual
    function addAsteroid(scene, asteroidInfo) {
        // Draw the asteroid using lines based on points from server
        const asteroid = scene.add.graphics(); // Use a Graphics object container
        asteroid.asteroidId = asteroidInfo.id; // Store server ID

        const mainColor = 0xffffff; // White
        const shadowColor = 0x888888; // Grey
        const shadowOffset = 2; // Offset for the pseudo-3D effect

        // Map server points relative to 0,0 to path points
        const pathPoints = asteroidInfo.points.map(p => new Phaser.Math.Vector2(p.x, p.y));
        
        // Draw shadow/offset layer first
        asteroid.lineStyle(2, shadowColor, 1.0);
        asteroid.translateCanvas(shadowOffset, shadowOffset);
        asteroid.strokePoints(pathPoints, true); // true to close the path
        asteroid.translateCanvas(-shadowOffset, -shadowOffset); // Reset translation

        // Draw main layer
        asteroid.lineStyle(2, mainColor, 1.0);
        asteroid.strokePoints(pathPoints, true); // true to close the path

        // Position the graphics container
        asteroid.setPosition(asteroidInfo.x, asteroidInfo.y);

        scene.asteroids.add(asteroid); // Add the graphics object to the group
        // console.log(`Added asteroid ${asteroid.asteroidId}`);
    }

    // Helper function to update lives display with hearts
    function updateLivesDisplay(scene, currentLives) {
        if (!livesGroup) return; // Safety check
        livesGroup.clear(true, true); // Remove existing hearts

        const heartSpacing = 25; // Spacing between hearts
        const startX = config.width - 30; // Starting X position (top-right)
        const startY = 25; // Starting Y position

        for (let i = 0; i < currentLives; i++) {
            // Use a simple red rectangle if image not loaded
            let heart;
            if (scene.textures.exists('heart')) {
                 heart = scene.add.image(startX - i * heartSpacing, startY, 'heart');
                 heart.setScale(0.8); // Adjust scale if needed
            } else { // Fallback to rectangle
                 heart = scene.add.rectangle(startX - i * heartSpacing, startY, 15, 15, 0xff0000); // width, height, color
            }
            livesGroup.add(heart);
        }
    }
}

function update() {
    if (playerGameObject && this.cursors) {
        const input = {
            left: this.cursors.left.isDown,
            right: this.cursors.right.isDown,
            up: this.cursors.up.isDown,
            // We can add down key for braking/reverse later if needed
        };
        // Emit the input state continuously while keys are pressed
        socket.emit('playerInput', input);
    }
} 

// Add constants needed by client-side logic (copied from server)
const ASTEROID_STAGE_SMALL = 1;
const PLAYER_START_LIVES = 10; // Add this constant for initial display 