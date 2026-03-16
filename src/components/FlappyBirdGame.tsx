import { useRef, useEffect, useCallback, useState } from 'react';

// ─── Constants ───
const GRAVITY = 0.5;
const FLAP_VEL = -8;
const PIPE_WIDTH = 52;
const PIPE_GAP = 130;
const PIPE_SPEED = 2.5;
const GROUND_H = 80;
const BIRD_W = 34;
const BIRD_H = 24;
const BIRD_X = 60;
const ENEMY_OBSTACLES = new Set([15, 23, 30, 45]);

type GameState = 'idle' | 'playing' | 'dead';

interface Pipe {
  x: number;
  gapY: number;
  scored: boolean;
  pipeIndex: number;
}

interface EnemyBird {
  x: number;
  y: number;
  speed: number;
  sinOffset: number;
}

const FlappyBirdGame = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [score, setScore] = useState(0);
  const [bestScore, setBestScore] = useState(() => {
    const s = localStorage.getItem('flappy-best');
    return s ? parseInt(s) : 0;
  });
  const [gameState, setGameState] = useState<GameState>('idle');
  const [canvasSize, setCanvasSize] = useState({ w: 288, h: 512 });
  const [muted, setMuted] = useState(false);
  const touchHandledRef = useRef(false);

  // Audio refs
  const wingSound = useRef<HTMLAudioElement | null>(null);
  const pointSound = useRef<HTMLAudioElement | null>(null);
  const hitSound = useRef<HTMLAudioElement | null>(null);

  // Preload audio
  useEffect(() => {
    wingSound.current = new Audio('/audio/wing.ogg');
    pointSound.current = new Audio('/audio/point.ogg');
    hitSound.current = new Audio('/audio/hit.ogg');
    [wingSound, pointSound, hitSound].forEach(ref => {
      if (ref.current) ref.current.volume = 0.5;
    });
  }, []);

  const playSound = useCallback((ref: React.MutableRefObject<HTMLAudioElement | null>) => {
    if (muted || !ref.current) return;
    ref.current.currentTime = 0;
    ref.current.play().catch(() => {});
  }, [muted]);

  // Update mute on audio elements
  useEffect(() => {
    [wingSound, pointSound, hitSound].forEach(ref => {
      if (ref.current) {
        ref.current.muted = muted;
        if (muted) {
          ref.current.pause();
          ref.current.currentTime = 0;
        }
      }
    });
  }, [muted]);

  // Game state ref
  const g = useRef({
    birdY: 200,
    birdVel: 0,
    birdRot: 0,
    pipes: [] as Pipe[],
    enemies: [] as EnemyBird[],
    score: 0,
    state: 'idle' as GameState,
    groundX: 0,
    frame: 0,
    pipeCounter: 0,
    lastPipeFrame: -999,
    clouds: [] as { x: number; y: number; w: number; speed: number }[],
    bushes: [] as { x: number; w: number; h: number }[],
  });

  // Bird image
  const birdImg = useRef<HTMLImageElement | null>(null);
  useEffect(() => {
    const img = new Image();
    img.src = '/images/bird.png';
    img.onload = () => { birdImg.current = img; };
  }, []);

  // Responsive sizing
  useEffect(() => {
    const resize = () => {
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const aspectRatio = 9 / 16;
      let w: number, h: number;
      if (vw / vh < aspectRatio) {
        w = vw;
        h = vw / aspectRatio;
      } else {
        h = vh;
        w = vh * aspectRatio;
      }
      // Use full screen on mobile
      if (vw <= 768) {
        w = vw;
        h = vh;
      }
      setCanvasSize({ w: Math.floor(w), h: Math.floor(h) });
    };
    resize();
    window.addEventListener('resize', resize);
    return () => window.removeEventListener('resize', resize);
  }, []);

  const scaleX = canvasSize.w / 288;
  const scaleY = canvasSize.h / 512;

  const resetGame = useCallback(() => {
    const game = g.current;
    game.birdY = 200;
    game.birdVel = 0;
    game.birdRot = 0;
    game.pipes = [];
    game.enemies = [];
    game.score = 0;
    game.pipeCounter = 0;
    game.lastPipeFrame = -999;
    setScore(0);
  }, []);

  const flap = useCallback(() => {
    const game = g.current;
    if (game.state === 'idle') {
      resetGame();
      game.state = 'playing';
      setGameState('playing');
      game.birdVel = FLAP_VEL;
      playSound(wingSound);
    } else if (game.state === 'playing') {
      game.birdVel = FLAP_VEL;
      playSound(wingSound);
    }
  }, [resetGame, playSound]);

  const restartGame = useCallback(() => {
    resetGame();
    g.current.state = 'idle';
    setGameState('idle');
  }, [resetGame]);

  const shareScore = useCallback(() => {
    const text = `🐤 I scored ${g.current.score} in Flappy Bird! Can you beat me?\n${window.location.href}`;
    if (navigator.share) {
      navigator.share({ text }).catch(() => {
        navigator.clipboard.writeText(text);
      });
    } else {
      navigator.clipboard.writeText(text);
    }
  }, []);

  // Input handlers with double-tap prevention
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.code === 'Space' || e.code === 'ArrowUp') {
        e.preventDefault();
        if (g.current.state === 'dead') return;
        flap();
      }
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [flap]);

  // Generate initial scenery
  useEffect(() => {
    const game = g.current;
    game.clouds = Array.from({ length: 6 }, () => ({
      x: Math.random() * 288,
      y: 20 + Math.random() * 120,
      w: 40 + Math.random() * 60,
      speed: 0.2 + Math.random() * 0.3,
    }));
    game.bushes = Array.from({ length: 8 }, (_, i) => ({
      x: i * 40 + Math.random() * 20,
      w: 30 + Math.random() * 25,
      h: 15 + Math.random() * 15,
    }));
  }, []);

  // Main game loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d')!;
    let running = true;
    const game = g.current;

    const PIPE_INTERVAL = 90; // frames between pipes
    const playH = 512 - GROUND_H;

    const loop = () => {
      if (!running) return;
      game.frame++;

      // ─── UPDATE ───
      if (game.state === 'playing') {
        game.birdVel += GRAVITY;
        game.birdY += game.birdVel;
        game.birdRot = Math.min(Math.max(game.birdVel * 0.07, -0.6), Math.PI / 2);

        // Spawn pipes
        if (game.frame - game.lastPipeFrame >= PIPE_INTERVAL) {
          game.pipeCounter++;
          const minY = 60 + PIPE_GAP / 2;
          const maxY = playH - 60 - PIPE_GAP / 2;
          game.pipes.push({
            x: 288,
            gapY: minY + Math.random() * (maxY - minY),
            scored: false,
            pipeIndex: game.pipeCounter,
          });
          game.lastPipeFrame = game.frame;

          // Spawn enemies at specific intervals
          if (ENEMY_OBSTACLES.has(game.pipeCounter % 45) || (game.pipeCounter >= 45 && ENEMY_OBSTACLES.has(game.pipeCounter % 45))) {
            for (let i = 0; i < 3; i++) {
              game.enemies.push({
                x: 288 + i * 30,
                y: 60 + Math.random() * (playH - 120),
                speed: 3 + Math.random() * 1.5,
                sinOffset: Math.random() * Math.PI * 2,
              });
            }
          }
        }

        // Move pipes
        game.pipes.forEach(p => { p.x -= PIPE_SPEED; });
        game.pipes = game.pipes.filter(p => p.x > -PIPE_WIDTH - 10);

        // Move enemies
        game.enemies.forEach(e => {
          e.x -= e.speed;
          e.y += Math.sin(game.frame * 0.1 + e.sinOffset) * 1.2;
        });
        game.enemies = game.enemies.filter(e => e.x > -40);

        // Score
        game.pipes.forEach(p => {
          if (!p.scored && p.x + PIPE_WIDTH < BIRD_X) {
            p.scored = true;
            game.score++;
            setScore(game.score);
            playSound(pointSound);
          }
        });

        // Collision detection
        const bL = BIRD_X + 3, bR = BIRD_X + BIRD_W - 3;
        const bT = game.birdY + 3, bB = game.birdY + BIRD_H - 3;
        let dead = false;

        if (bB >= playH || bT <= 0) dead = true;

        for (const p of game.pipes) {
          const pL = p.x, pR = p.x + PIPE_WIDTH;
          const gapTop = p.gapY - PIPE_GAP / 2;
          const gapBot = p.gapY + PIPE_GAP / 2;
          if (bR > pL && bL < pR && (bT < gapTop || bB > gapBot)) {
            dead = true;
            break;
          }
        }

        // Enemy collision
        for (const e of game.enemies) {
          const eL = e.x, eR = e.x + 28, eT = e.y, eB = e.y + 20;
          if (bR > eL && bL < eR && bB > eT && bT < eB) {
            dead = true;
            break;
          }
        }

        if (dead) {
          game.state = 'dead';
          setGameState('dead');
          playSound(hitSound);
          if (game.score > bestScore) {
            setBestScore(game.score);
            localStorage.setItem('flappy-best', game.score.toString());
          }
        }
      }

      // Scroll ground/clouds
      if (game.state !== 'dead') {
        game.groundX = (game.groundX + PIPE_SPEED) % 24;
        game.clouds.forEach(c => {
          c.x -= c.speed;
          if (c.x < -c.w) c.x = 288 + c.w;
        });
      }

      // Idle bob
      if (game.state === 'idle') {
        game.birdY = 200 + Math.sin(game.frame * 0.06) * 10;
        game.birdRot = 0;
      }

      // ─── DRAW ───
      ctx.save();
      ctx.scale(scaleX, scaleY);

      // Sky gradient
      const skyGrad = ctx.createLinearGradient(0, 0, 0, playH);
      skyGrad.addColorStop(0, '#4EC0CA');
      skyGrad.addColorStop(1, '#70C5CE');
      ctx.fillStyle = skyGrad;
      ctx.fillRect(0, 0, 288, playH);

      // Clouds
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      game.clouds.forEach(c => {
        ctx.beginPath();
        ctx.ellipse(c.x, c.y, c.w / 2, 10, 0, 0, Math.PI * 2);
        ctx.ellipse(c.x - c.w * 0.2, c.y + 3, c.w / 3, 8, 0, 0, Math.PI * 2);
        ctx.ellipse(c.x + c.w * 0.3, c.y + 2, c.w / 3, 9, 0, 0, Math.PI * 2);
        ctx.fill();
      });

      // Bushes (background layer)
      ctx.fillStyle = '#2D8B47';
      game.bushes.forEach(b => {
        const bx = (b.x - game.groundX * 0.5 + 320) % 320 - 20;
        ctx.beginPath();
        ctx.ellipse(bx, playH - 2, b.w / 2, b.h / 2, 0, Math.PI, 0);
        ctx.fill();
      });
      ctx.fillStyle = '#3CA55C';
      game.bushes.forEach(b => {
        const bx = (b.x - game.groundX * 0.5 + 320) % 320 - 20;
        ctx.beginPath();
        ctx.ellipse(bx + 5, playH, b.w / 2.5, b.h / 2.5, 0, Math.PI, 0);
        ctx.fill();
      });

      // Pipes
      game.pipes.forEach(p => {
        const gapTop = p.gapY - PIPE_GAP / 2;
        const gapBot = p.gapY + PIPE_GAP / 2;

        // Top pipe body
        ctx.fillStyle = '#22C55E';
        ctx.fillRect(p.x, 0, PIPE_WIDTH, gapTop);
        ctx.fillStyle = '#4ADE80';
        ctx.fillRect(p.x + 3, 0, 5, gapTop - 20);
        ctx.fillStyle = '#16A34A';
        ctx.fillRect(p.x + PIPE_WIDTH - 7, 0, 5, gapTop - 20);
        // Top cap
        ctx.fillStyle = '#22C55E';
        ctx.fillRect(p.x - 3, gapTop - 22, PIPE_WIDTH + 6, 22);
        ctx.fillStyle = '#4ADE80';
        ctx.fillRect(p.x, gapTop - 22, 5, 22);
        ctx.fillStyle = '#16A34A';
        ctx.fillRect(p.x + PIPE_WIDTH - 3, gapTop - 22, 5, 22);
        // Border
        ctx.strokeStyle = '#15803D';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(p.x - 3, gapTop - 22, PIPE_WIDTH + 6, 22);
        ctx.strokeRect(p.x, 0, PIPE_WIDTH, gapTop - 22);

        // Bottom pipe body
        ctx.fillStyle = '#22C55E';
        ctx.fillRect(p.x, gapBot, PIPE_WIDTH, playH - gapBot);
        ctx.fillStyle = '#4ADE80';
        ctx.fillRect(p.x + 3, gapBot + 22, 5, playH - gapBot - 22);
        ctx.fillStyle = '#16A34A';
        ctx.fillRect(p.x + PIPE_WIDTH - 7, gapBot + 22, 5, playH - gapBot - 22);
        // Bottom cap
        ctx.fillStyle = '#22C55E';
        ctx.fillRect(p.x - 3, gapBot, PIPE_WIDTH + 6, 22);
        ctx.fillStyle = '#4ADE80';
        ctx.fillRect(p.x, gapBot, 5, 22);
        ctx.fillStyle = '#16A34A';
        ctx.fillRect(p.x + PIPE_WIDTH - 3, gapBot, 5, 22);
        ctx.strokeStyle = '#15803D';
        ctx.strokeRect(p.x - 3, gapBot, PIPE_WIDTH + 6, 22);
        ctx.strokeRect(p.x, gapBot + 22, PIPE_WIDTH, playH - gapBot - 22);
      });

      // Enemy birds
      game.enemies.forEach(e => {
        ctx.save();
        ctx.translate(e.x + 14, e.y + 10);
        // Body
        ctx.fillStyle = '#EF4444';
        ctx.beginPath();
        ctx.ellipse(0, 0, 14, 10, 0, 0, Math.PI * 2);
        ctx.fill();
        // Wing
        ctx.fillStyle = '#DC2626';
        const wingOff = Math.sin(game.frame * 0.4 + e.sinOffset) * 4;
        ctx.beginPath();
        ctx.ellipse(4, wingOff, 8, 5, 0.3, 0, Math.PI * 2);
        ctx.fill();
        // Eye
        ctx.fillStyle = '#FFF';
        ctx.beginPath();
        ctx.arc(-5, -3, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#000';
        ctx.beginPath();
        ctx.arc(-6, -3, 2, 0, Math.PI * 2);
        ctx.fill();
        // Angry brow
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(-9, -7);
        ctx.lineTo(-3, -5);
        ctx.stroke();
        // Beak
        ctx.fillStyle = '#F97316';
        ctx.beginPath();
        ctx.moveTo(-12, 0);
        ctx.lineTo(-20, 2);
        ctx.lineTo(-12, 4);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      });

      // Bird
      ctx.save();
      ctx.translate(BIRD_X + BIRD_W / 2, game.birdY + BIRD_H / 2);
      ctx.rotate(game.birdRot);
      if (birdImg.current) {
        ctx.drawImage(birdImg.current, -BIRD_W / 2, -BIRD_H / 2, BIRD_W, BIRD_H);
      } else {
        ctx.fillStyle = '#FACC15';
        ctx.beginPath();
        ctx.ellipse(0, 0, BIRD_W / 2, BIRD_H / 2, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      // Ground
      ctx.fillStyle = '#4ADE80';
      ctx.fillRect(0, playH, 288, 6);
      ctx.fillStyle = '#DED895';
      ctx.fillRect(0, playH + 6, 288, GROUND_H - 6);
      ctx.fillStyle = '#C8C078';
      for (let i = -1; i < 14; i++) {
        const sx = i * 24 - game.groundX;
        ctx.fillRect(sx, playH + 10, 12, 3);
        ctx.fillRect(sx + 12, playH + 20, 12, 3);
      }

      // ─── HUD ───
      if (game.state === 'playing') {
        ctx.font = "20px 'Press Start 2P'";
        ctx.textAlign = 'center';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 4;
        ctx.strokeText(game.score.toString(), 144, 40);
        ctx.fillStyle = '#FFF';
        ctx.fillText(game.score.toString(), 144, 40);

        ctx.font = "8px 'Press Start 2P'";
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.textAlign = 'right';
        ctx.strokeText('BEST: ' + (game.score > bestScore ? game.score : bestScore), 280, 20);
        ctx.fillStyle = '#FFD700';
        ctx.fillText('BEST: ' + (game.score > bestScore ? game.score : bestScore), 280, 20);
      }

      // ─── IDLE SCREEN ───
      if (game.state === 'idle') {
        ctx.font = "22px 'Press Start 2P'";
        ctx.textAlign = 'center';
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 5;
        ctx.strokeText('FLAPPY', 144, 100);
        ctx.strokeText('BIRD', 144, 130);
        ctx.fillStyle = '#FACC15';
        ctx.fillText('FLAPPY', 144, 100);
        ctx.fillStyle = '#FFF';
        ctx.fillText('BIRD', 144, 130);

        ctx.font = "16px 'VT323'";
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 3;
        ctx.strokeText('TAP TO START', 144, 300);
        ctx.fillStyle = '#FFF';
        ctx.fillText('TAP TO START', 144, 300);
      }

      ctx.restore();

      requestAnimationFrame(loop);
    };

    loop();
    return () => { running = false; };
  }, [scaleX, scaleY, bestScore, playSound]);

  const handleCanvasTouch = useCallback((e: React.TouchEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (g.current.state === 'dead') return;
    touchHandledRef.current = true;
    flap();
    setTimeout(() => { touchHandledRef.current = false; }, 100);
  }, [flap]);

  const handleCanvasClick = useCallback((e: React.MouseEvent) => {
    if (touchHandledRef.current) return;
    if (g.current.state === 'dead') return;
    flap();
  }, [flap]);

  return (
    <div
      ref={containerRef}
      className="relative flex items-center justify-center w-screen h-screen bg-background overflow-hidden select-none"
      style={{ touchAction: 'none' }}
    >
      <div className="relative" style={{ width: canvasSize.w, height: canvasSize.h }}>
        <canvas
          ref={canvasRef}
          width={canvasSize.w}
          height={canvasSize.h}
          onTouchStart={handleCanvasTouch}
          onClick={handleCanvasClick}
          className="block cursor-pointer"
          style={{ imageRendering: 'pixelated', width: canvasSize.w, height: canvasSize.h }}
        />

        {/* Game Over overlay */}
        {gameState === 'dead' && (
          <div
            className="absolute inset-0 flex flex-col items-center justify-center"
            style={{ background: 'rgba(0,0,0,0.45)' }}
          >
            <div
              className="flex flex-col items-center p-6 rounded-lg border-4"
              style={{
                background: 'linear-gradient(180deg, #F5E6C8 0%, #DEB887 100%)',
                borderColor: '#8B7355',
                fontFamily: "var(--font-display)",
                minWidth: Math.min(260, canvasSize.w * 0.8),
              }}
            >
              <h2
                className="text-lg mb-4"
                style={{ color: '#EF4444', textShadow: '2px 2px 0 #000', fontFamily: "var(--font-display)", fontSize: Math.max(14, canvasSize.w * 0.05) }}
              >
                GAME OVER
              </h2>

              <div className="w-full flex flex-col gap-2 mb-4" style={{ fontFamily: "var(--font-display)" }}>
                <div className="flex justify-between items-center" style={{ fontSize: Math.max(10, canvasSize.w * 0.03) }}>
                  <span style={{ color: '#8B4513' }}>SCORE</span>
                  <span style={{ color: '#333' }}>{score}</span>
                </div>
                <div className="w-full h-px" style={{ background: '#8B7355' }} />
                <div className="flex justify-between items-center" style={{ fontSize: Math.max(10, canvasSize.w * 0.03) }}>
                  <span style={{ color: '#8B4513' }}>BEST</span>
                  <span style={{ color: '#333' }}>{Math.max(score, bestScore)}</span>
                </div>
              </div>

              <div className="flex gap-3 w-full">
                <button
                  onClick={restartGame}
                  className="flex-1 py-2 rounded font-bold text-sm transition-transform active:scale-95"
                  style={{
                    background: '#22C55E',
                    color: '#FFF',
                    fontFamily: "var(--font-display)",
                    fontSize: Math.max(9, canvasSize.w * 0.025),
                    textShadow: '1px 1px 0 #000',
                    border: '2px solid #15803D',
                  }}
                >
                  RESTART
                </button>
                <button
                  onClick={shareScore}
                  className="flex-1 py-2 rounded font-bold text-sm transition-transform active:scale-95"
                  style={{
                    background: '#3B82F6',
                    color: '#FFF',
                    fontFamily: "var(--font-display)",
                    fontSize: Math.max(9, canvasSize.w * 0.025),
                    textShadow: '1px 1px 0 #000',
                    border: '2px solid #2563EB',
                  }}
                >
                  SHARE
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Mute button */}
        <button
          onClick={() => setMuted(m => !m)}
          className="absolute top-2 left-2 w-8 h-8 flex items-center justify-center rounded-full transition-transform active:scale-90"
          style={{ background: 'rgba(0,0,0,0.4)', color: '#FFF', fontSize: 14 }}
        >
          {muted ? '🔇' : '🔊'}
        </button>

        {/* Telegram icon */}
        <a
          href="https://t.me/MONARCHPY2"
          target="_blank"
          rel="noopener noreferrer"
          className="absolute bottom-2 right-2 w-10 h-10 flex items-center justify-center rounded-full transition-transform hover:scale-110 active:scale-95"
          style={{ background: '#229ED9' }}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="white">
            <path d="M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z" />
          </svg>
        </a>
      </div>
    </div>
  );
};

export default FlappyBirdGame;
