import './style.css';
import { Input } from './game/Input.js';
import { FootballGame } from './game/FootballGame.js';
import { BALL, PITCH } from './game/constants.js';

const app = document.querySelector('#app');
const input = new Input();
const game = new FootballGame(app, input);

function enforceOwnedBallBounds() {
  if (game.phase !== 'play' || !game.ball.owner) return;
  const p = game.ball.mesh.position;

  if (Math.abs(p.x) > PITCH.halfL && Math.abs(p.z) < PITCH.goalWidth / 2 && p.y < PITCH.goalHeight) {
    game.goal(p.x > 0 ? 'home' : 'away');
    return;
  }

  if (Math.abs(p.z) > PITCH.halfW + 0.15) {
    const team = game.ball.lastTeam === 'home' ? 'away' : 'home';
    game.startRestart({
      type: 'throw',
      team,
      x: Math.max(-PITCH.halfL + 1, Math.min(PITCH.halfL - 1, p.x)),
      z: Math.sign(p.z) * PITCH.halfW,
      label: 'LATERAL',
    });
    return;
  }

  if (Math.abs(p.x) > PITCH.halfL + 0.35) {
    const rightEnd = p.x > 0;
    const defending = rightEnd ? 'away' : 'home';
    const attacking = defending === 'home' ? 'away' : 'home';
    if (game.ball.lastTeam === attacking) {
      game.startRestart({
        type: 'goalKick',
        team: defending,
        x: rightEnd ? PITCH.halfL - PITCH.sixDepth : -PITCH.halfL + PITCH.sixDepth,
        z: 0,
        label: 'TIRO DE META',
      });
    } else {
      game.startRestart({
        type: 'corner',
        team: attacking,
        x: rightEnd ? PITCH.halfL : -PITCH.halfL,
        z: Math.sign(p.z || 1) * PITCH.halfW,
        label: 'ESCANTEIO',
      });
    }
    game.ball.mesh.position.y = BALL.radius;
  }
}

let last = performance.now();
function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 30);
  last = now;
  game.update(dt);
  enforceOwnedBallBounds();
  input.endFrame();
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

window.game = game;
